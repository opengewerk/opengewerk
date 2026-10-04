import { createHash } from 'node:crypto'

import {
  BadRequestException,
  Controller,
  Inject,
  Param,
  PayloadTooLargeException,
  type Provider,
  Put,
  Req,
  type Type,
  UnprocessableEntityException,
} from '@nestjs/common'
import { fileHashProblem, fileSizeProblem, largestFileBytes } from '@opengewerk/platform-domain'
import { and, eq } from 'drizzle-orm'
import type { Request } from 'express'

import { RequiresPermission } from '../api/authorization.js'
import { AcceptsBody } from '../api/origin.js'
import { CurrentIdentity, type RequestIdentity } from '../api/identity.js'
import type { AccessRules } from '../authentication/access.js'
import { Database } from '../database/database.js'
import { files } from '../database/schema/files.js'
import { storedMediaType } from './media-type.js'
import { fileRowFor } from './rows.js'
import { type FileStorage, noFileStorage } from './store.js'

/**
 * The content addressed file store, under which a module hands it to the
 * routes that keep and read files. An interface of its own rather than the
 * class, so that a module built without one gets a store that says so the
 * moment it is used, instead of writing into some directory nobody chose.
 */
export const FILE_STORE = Symbol('FileStore')

/** How a file travels: as bytes, with a type a form cannot send. */
export const fileUploadType = 'application/octet-stream'

const refusal =
  'Eine Datei wird als application/octet-stream geschickt, mit ihrem Typ im Kopf X-Media-Type.'

/**
 * The body of a request as bytes, read here and by nothing in front of the
 * route, or null when it is longer than the route takes.
 *
 * A parser in front of the route reads before any guard has asked who is
 * sending: megabytes went into memory for a request without a session, which
 * was then turned away (opengewerk-haustechnik#31). Read by the handler, a
 * body is read for whoever the guards let through and for nobody else.
 *
 * A body that is too long is read on and kept nowhere. Answering while the
 * sender is still sending cuts the connection under it, and what it reads
 * then is a lost connection and not the sentence about the size. Twice the
 * limit is where the reading ends whatever is still coming.
 */
function bytesOf(request: Request, most: number, announced: number): Promise<Buffer | null> {
  // An application that still reads the body in front of the route has it here.
  if (Buffer.isBuffer(request.body)) {
    return Promise.resolve(request.body.byteLength > most ? null : request.body)
  }

  if (request.readableEnded) {
    return Promise.resolve(Buffer.alloc(0))
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let length = 0
    // What the sender says the length is decides before a byte is kept.
    let tooLong = announced > most

    const finish = (result: Buffer | null) => {
      request.off('data', take)
      request.off('end', end)
      request.off('error', reject)
      resolve(result)
    }
    const take = (chunk: Buffer) => {
      length += chunk.byteLength

      if (length > most) {
        tooLong = true
        chunks.length = 0
      }

      if (!tooLong) {
        chunks.push(chunk)
      } else if (length > most * 2) {
        request.pause()
        finish(null)
      }
    }
    const end = () => {
      finish(tooLong ? null : Buffer.concat(chunks))
    }

    request.on('data', take)
    request.on('end', end)
    request.on('error', reject)
  })
}

/**
 * The route the bytes of a file are stored through, ahead of the record that
 * names them, under the right the application gives it.
 *
 * A device that took a photo without a network holds the bytes and their hash
 * and nothing else the server knows; this is where the bytes go when the
 * network is back, before the record is sent through the outbox. Addressed by
 * hash, so sending the same file again is harmless: the store keeps it once,
 * the tenant has one row for it, and a device that lost the answer to its last
 * upload simply sends it again.
 *
 * Made by a function because the right is the application's: what a file is
 * stored for, a record of its own or a photo at a defect, is what decides who
 * may store one, and the foundation knows neither.
 */
function filesController(right: string): Type<unknown> {
  @Controller('files')
  class FilesController {
    constructor(
      readonly database: Database,
      @Inject(FILE_STORE) readonly store: FileStorage,
    ) {}

    /**
     * The body is the file itself as `application/octet-stream`, a type no
     * form can send, and the type the browser gave it travels in
     * `X-Media-Type`. The hash in the address has to be the hash of the body:
     * a file damaged on its way is refused here and not stored under a name
     * that claims otherwise.
     */
    @Put(':sha256')
    @RequiresPermission(right)
    @AcceptsBody([fileUploadType], refusal)
    async upload(
      @CurrentIdentity() identity: RequestIdentity,
      @Param('sha256') sha256: string,
      @Req() request: Request,
    ) {
      const malformed = fileHashProblem(sha256)

      if (malformed) {
        throw new BadRequestException(malformed)
      }

      const announced = Number(request.header('content-length') ?? '0')
      const body = await bytesOf(
        request,
        largestFileBytes,
        Number.isFinite(announced) ? announced : 0,
      )

      if (body === null) {
        throw new PayloadTooLargeException(fileSizeProblem(largestFileBytes + 1) ?? undefined)
      }

      const empty = fileSizeProblem(body.byteLength)

      if (empty) {
        throw new BadRequestException(empty)
      }

      const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength)

      if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
        throw new UnprocessableEntityException(
          'Der Inhalt passt nicht zu seiner Prüfsumme. Die Datei ist unterwegs beschädigt ' +
            'worden; der nächste Abgleich schickt sie noch einmal.',
        )
      }

      const declared = request.header('x-media-type') ?? ''

      // Into the store first, then the row: the other order could leave a
      // row pointing at a file nobody wrote.
      const blob = await this.store.put(bytes)

      return this.database.forTenant(identity, async (tx) => {
        await fileRowFor(tx, identity.tenantId, blob, storedMediaType(bytes, declared))

        // The row that was there already keeps its type: the same bytes are
        // the same file, whatever a second upload declared.
        const [row] = await tx
          .select({ sha256: files.sha256, sizeBytes: files.sizeBytes, mediaType: files.mediaType })
          .from(files)
          .where(and(eq(files.tenantId, identity.tenantId), eq(files.sha256, blob.sha256)))

        return row
      })
    }
  }

  return FilesController
}

/** What the route of the file store is put together from. */
export interface FileParts<Right extends string> {
  /** The rights of the application, which have to hold the one named below. */
  readonly access: Pick<AccessRules<Right>, 'catalogue'>
  /** The right a person needs to store a file. */
  readonly upload: Right
  /** The store, or none: a module without one refuses every file with a sentence. */
  readonly store?: FileStorage
}

/**
 * The route of the file store and what it is handed, for the module of an
 * application. A function and not a module of its own, for the reason
 * `authenticationParts` is one: the guard, the database and the identity
 * source are the application's to register, once.
 *
 * The module has nothing to read the body with in front of the route. The
 * route reads it itself, once the guards have let the request through.
 */
export function fileParts<Right extends string>(
  parts: FileParts<Right>,
): { readonly controllers: Type<unknown>[]; readonly providers: Provider[] } {
  if (!parts.access.catalogue.isRight(parts.upload)) {
    throw new Error(`The catalogue lacks the right to store a file: ${parts.upload}`)
  }

  return {
    controllers: [filesController(parts.upload)],
    providers: [{ provide: FILE_STORE, useValue: parts.store ?? noFileStorage }],
  }
}
