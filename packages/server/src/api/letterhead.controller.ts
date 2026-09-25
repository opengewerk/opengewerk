import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  NotFoundException,
  PayloadTooLargeException,
  Put,
  Req,
  StreamableFile,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import {
  ibanIsValid,
  largestLogoBytes,
  type LetterheadField,
  letterheadFieldLabels,
  letterheadFields,
  logoMediaTypes,
  type LogoMediaType,
  type TenantId,
} from '@opengewerk/domain'
import { eq } from 'drizzle-orm'
import type { Request } from 'express'

import { Database, type TenantTransaction } from '../database/database.js'
import { files, letterheads, tenants } from '../database/schema/index.js'
import type { FileStorage } from '../storage/file-store.js'
import { fileRowFor } from '../storage/files.js'
import { RequiresPermission } from './authorization.js'
import { FILE_STORE } from './handed-in.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'
import { AcceptsBody } from './origin.js'

/** The longest a single field may be. A letterhead line, not a letter. */
const longestField = 300

/**
 * The media type of an image, read from its first bytes rather than from the
 * header that came with it. A header is what the sender claims; the bytes are
 * what the renderer will have to draw.
 */
function mediaTypeOf(bytes: Uint8Array): LogoMediaType | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

  if (png.every((byte, index) => bytes[index] === byte)) {
    return 'image/png'
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }

  return null
}

/**
 * Reads a letterhead from a request body, field by field.
 *
 * Every field is replaced: a field that is left out or empty becomes empty,
 * because the screen sends the whole letterhead and an empty field there
 * means "nothing here". The country is the exception and falls back to DE,
 * like everywhere else an address is kept.
 */
function letterheadFrom(body: unknown): Record<LetterheadField, string | null> {
  if (typeof body !== 'object' || body === null) {
    throw new BadRequestException('Es wurde kein Objekt übergeben.')
  }

  const source = body as Record<string, unknown>
  const read = {} as Record<LetterheadField, string | null>

  for (const field of letterheadFields) {
    const value = source[field]

    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw new BadRequestException(`„${letterheadFieldLabels[field]}“ muss ein Text sein.`)
    }

    const trimmed = typeof value === 'string' ? value.trim() : ''

    if (trimmed.length > longestField) {
      throw new BadRequestException(
        `„${letterheadFieldLabels[field]}“ ist länger als ${String(longestField)} Zeichen, für einen Briefkopf zu lang.`,
      )
    }

    read[field] = trimmed === '' ? null : trimmed
  }

  const country = (read.country ?? 'DE').toUpperCase()

  if (!/^[A-Z]{2}$/.test(country)) {
    throw new BadRequestException(
      'Das Land wird als Kürzel mit zwei Buchstaben angegeben, etwa DE oder AT.',
    )
  }

  if (read.iban !== null && !ibanIsValid(read.iban)) {
    throw new BadRequestException(
      'Die IBAN stimmt nicht, ihre Prüfziffern gehen nicht auf. Meistens ist beim Abtippen ' +
        'ein Zeichen verrutscht.',
    )
  }

  return { ...read, country }
}

/**
 * The letterhead of the business, and its logo.
 *
 * Under the settings rights and not the document ones. Reading belongs to the
 * office as well, because it writes the documents the letterhead ends up on;
 * changing it belongs to whoever answers for the business, since the tax
 * number and the bank account on every invoice come from here.
 */
@Controller('settings/letterhead')
export class LetterheadController {
  constructor(
    private readonly database: Database,
    @Inject(FILE_STORE) private readonly store: FileStorage,
  ) {}

  /**
   * The letterhead as it stands, and the name the business was set up with.
   * An empty company name prints that one, and the screen shows it as the
   * placeholder so nobody wonders what an empty field will do.
   */
  private async view(tx: TenantTransaction, tenantId: TenantId) {
    const [tenant] = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
    const [row] = await tx.select().from(letterheads).where(eq(letterheads.tenantId, tenantId))

    const fields = Object.fromEntries(
      letterheadFields.map((field) => [field, row?.[field] ?? (field === 'country' ? 'DE' : null)]),
    ) as Record<LetterheadField, string | null>

    let logo: { readonly mediaType: string; readonly sizeBytes: number } | null = null

    if (row?.logoFileId) {
      const [file] = await tx
        .select({ mediaType: files.mediaType, sizeBytes: files.sizeBytes })
        .from(files)
        .where(eq(files.id, row.logoFileId))

      logo = file ?? null
    }

    return { ...fields, setUpAs: tenant?.name ?? '', logo }
  }

  @Get()
  @RequiresPermission('settings.read')
  read(@CurrentIdentity() identity: RequestIdentity) {
    return this.database.forTenant(identity, (tx) => this.view(tx, identity.tenantId))
  }

  @Put()
  @RequiresPermission('settings.write')
  async write(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const values = letterheadFrom(body)

    return this.database.forTenant(identity, async (tx) => {
      await tx
        .insert(letterheads)
        .values({ ...values, country: values.country ?? 'DE', tenantId: identity.tenantId })
        .onConflictDoUpdate({
          target: letterheads.tenantId,
          set: { ...values, country: values.country ?? 'DE', updatedAt: new Date() },
        })

      return this.view(tx, identity.tenantId)
    })
  }

  /**
   * The logo, as the image itself, for the settings screen to show. PNG or
   * JPEG and nothing that could carry script, see `logoMediaTypes`.
   */
  @Get('logo')
  @RequiresPermission('settings.read')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async logo(@CurrentIdentity() identity: RequestIdentity): Promise<StreamableFile> {
    const file = await this.database.forTenant(identity, async (tx) => {
      const [row] = await tx
        .select({ sha256: files.sha256, mediaType: files.mediaType })
        .from(letterheads)
        .innerJoin(files, eq(files.id, letterheads.logoFileId))
        .where(eq(letterheads.tenantId, identity.tenantId))

      return row
    })

    if (!file) {
      throw new NotFoundException('Für diesen Betrieb ist kein Logo hinterlegt.')
    }

    return new StreamableFile(Buffer.from(await this.store.get(file.sha256)), {
      type: file.mediaType,
      disposition: 'inline',
    })
  }

  /**
   * Replaces the logo. The body is the image itself, sent with its media
   * type; `api.module.ts` reads bodies of these two types as raw bytes on this
   * route and on no other, and it is the one route that takes a body other
   * than JSON (`AcceptsBody`).
   */
  @Put('logo')
  @RequiresPermission('settings.write')
  @AcceptsBody(
    logoMediaTypes,
    'Das Logo wird als Bild geschickt, als PNG oder JPEG, mit dem passenden Content-Type.',
  )
  async uploadLogo(@CurrentIdentity() identity: RequestIdentity, @Req() request: Request) {
    const body: unknown = request.body

    if (!Buffer.isBuffer(body) || body.byteLength === 0) {
      throw new UnsupportedMediaTypeException(
        'Das Logo wird als Bild geschickt, als PNG oder JPEG, mit dem passenden Content-Type.',
      )
    }

    if (body.byteLength > largestLogoBytes) {
      throw new PayloadTooLargeException(
        `Das Logo ist größer als ${String(largestLogoBytes / 1_000_000)} MB. Ein Logo für den ` +
          'Briefkopf kommt mit einem Bruchteil davon aus.',
      )
    }

    const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
    const mediaType = mediaTypeOf(bytes)

    if (mediaType === null) {
      throw new UnsupportedMediaTypeException('Das Logo muss ein PNG- oder JPEG-Bild sein.')
    }

    // Into the store first, then the rows, for the same reason as with a PDF:
    // the other order could leave a row pointing at a file nobody wrote.
    const blob = await this.store.put(bytes)

    return this.database.forTenant(identity, async (tx) => {
      const fileId = await fileRowFor(tx, identity.tenantId, blob, mediaType)

      await tx
        .insert(letterheads)
        .values({ tenantId: identity.tenantId, logoFileId: fileId })
        .onConflictDoUpdate({
          target: letterheads.tenantId,
          set: { logoFileId: fileId, updatedAt: new Date() },
        })

      return this.view(tx, identity.tenantId)
    })
  }

  /**
   * Takes the logo off the letterhead. The file stays in the store: a
   * document issued with it has it in its snapshot and prints it forever.
   */
  @Delete('logo')
  @RequiresPermission('settings.write')
  removeLogo(@CurrentIdentity() identity: RequestIdentity) {
    return this.database.forTenant(identity, async (tx) => {
      await tx
        .update(letterheads)
        .set({ logoFileId: null, updatedAt: new Date() })
        .where(eq(letterheads.tenantId, identity.tenantId))

      return this.view(tx, identity.tenantId)
    })
  }
}
