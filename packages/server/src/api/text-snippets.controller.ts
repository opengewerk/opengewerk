import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import {
  type MailOccasion,
  mailOccasionLabel,
  mailSnippetProblem,
  type SnippetPurpose,
  snippetPurposes,
  type TextSnippetId,
} from '@opengewerk/domain'
import {
  Database,
  isUniqueViolation,
  pick,
  requireFields,
  requireSomething,
} from '@opengewerk/platform-server'
import { asc, eq } from 'drizzle-orm'

import { textSnippets } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

const writableFields = ['purpose', 'title', 'text', 'mailOccasion'] as const

type SnippetValues = Partial<Record<(typeof writableFields)[number], unknown>>

/** What the list shows. A name, not a paragraph. */
const longestTitle = 200

/**
 * A long description of a service runs to a page, and a page is a few
 * thousand characters. Ten thousand leaves room for that and keeps somebody
 * from pasting a whole specification into one snippet.
 */
const longestText = 10_000

/**
 * The snippet as it will be stored, checked field by field and then as a
 * whole, because one rule spans two fields: a text for above or below the
 * lines is nothing but its text, while a snippet for a position may be a
 * designation alone, with no description under it.
 */
function checked(
  values: SnippetValues,
  existing?: typeof textSnippets.$inferSelect,
): Partial<Pick<typeof textSnippets.$inferInsert, 'purpose' | 'title' | 'text' | 'mailOccasion'>> {
  if (
    values.purpose !== undefined &&
    !(snippetPurposes as readonly unknown[]).includes(values.purpose)
  ) {
    throw new BadRequestException(
      `purpose muss einer von diesen Werten sein: ${snippetPurposes.join(', ')}`,
    )
  }

  if (values.title !== undefined) {
    if (typeof values.title !== 'string' || values.title.trim() === '') {
      throw new BadRequestException('Ein Textbaustein braucht einen Namen.')
    }

    if (values.title.length > longestTitle) {
      throw new BadRequestException(
        `Der Name eines Textbausteins hat höchstens ${String(longestTitle)} Zeichen.`,
      )
    }
  }

  if (values.text !== undefined) {
    if (typeof values.text !== 'string') {
      throw new BadRequestException('Der Text eines Textbausteins ist Text.')
    }

    if (values.text.length > longestText) {
      throw new BadRequestException(
        `Ein Textbaustein hat höchstens ${String(longestText)} Zeichen.`,
      )
    }
  }

  const purpose = (values.purpose ?? existing?.purpose) as SnippetPurpose
  const text = (values.text ?? existing?.text ?? '') as string

  if (purpose !== 'line' && text.trim() === '') {
    throw new BadRequestException(
      purpose === 'mail'
        ? 'Ein Textbaustein für E-Mails braucht einen Text.'
        : 'Ein Textbaustein für den Text über oder unter den Positionen braucht einen Text.',
    )
  }

  // A snippet for mails names its occasion and has its subject as its title
  // (#315); one for a document has no occasion, and loses it when its purpose
  // changes away from mails.
  const occasion =
    values.mailOccasion !== undefined
      ? values.mailOccasion
      : purpose === 'mail'
        ? (existing?.mailOccasion ?? null)
        : null
  const problem = mailSnippetProblem(purpose, occasion, values.title ?? existing?.title)

  if (problem !== null) {
    throw new BadRequestException(problem)
  }

  return {
    ...(values.purpose === undefined ? {} : { purpose }),
    ...(values.title === undefined ? {} : { title: (values.title as string).trim() }),
    ...(values.text === undefined ? {} : { text }),
    ...(values.mailOccasion === undefined && values.purpose === undefined
      ? {}
      : { mailOccasion: occasion as MailOccasion | null }),
  }
}

/**
 * The texts the office puts into its documents again and again.
 *
 * Under `documents`, because they are part of writing one and carry its
 * rights: whoever may write a document may keep the texts it is written from.
 * The path also keeps them inside the prefix the browser already sends to the
 * server, and a fourth place that lists the paths of the API would be one more
 * place to forget.
 */
/** A second text for an occasion that has one is refused with what to do instead (#315). */
function taken(error: unknown, occasion: MailOccasion | null | undefined): unknown {
  return isUniqueViolation(error, 'text_snippets_one_per_occasion') && occasion
    ? new ConflictException(
        `Für „${mailOccasionLabel[occasion]}“ gibt es schon einen Text. Den bestehenden bearbeiten oder entfernen.`,
      )
    : error
}

@Controller('documents/text-snippets')
export class TextSnippetsController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('document.read')
  list(@CurrentIdentity() identity: RequestIdentity) {
    return this.database.forTenant(identity, (tx) =>
      tx
        .select()
        .from(textSnippets)
        .orderBy(asc(textSnippets.purpose), asc(textSnippets.title), asc(textSnippets.id)),
    )
  }

  @Post()
  @RequiresPermission('document.write')
  async create(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const values = pick(body, writableFields)
    requireFields(values, ['purpose', 'title'])

    const snippet = checked(values)

    try {
      const [created] = await this.database.forTenant(identity, (tx) =>
        tx
          .insert(textSnippets)
          .values({
            tenantId: identity.tenantId,
            purpose: snippet.purpose as SnippetPurpose,
            title: snippet.title as string,
            text: snippet.text ?? '',
            mailOccasion: snippet.mailOccasion ?? null,
          })
          .returning(),
      )

      return created
    } catch (error) {
      throw taken(error, snippet.mailOccasion)
    }
  }

  @Patch(':id')
  @RequiresPermission('document.write')
  async update(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const values = pick(body, writableFields)
    requireSomething(values)

    let occasion: MailOccasion | null | undefined

    try {
      return await this.database.forTenant(identity, async (tx) => {
        const [existing] = await tx
          .select()
          .from(textSnippets)
          .where(eq(textSnippets.id, id as TextSnippetId))

        if (!existing) {
          throw new NotFoundException()
        }

        const snippet = checked(values, existing)
        occasion = snippet.mailOccasion ?? existing.mailOccasion

        const [updated] = await tx
          .update(textSnippets)
          .set({ ...snippet, updatedAt: new Date() })
          .where(eq(textSnippets.id, existing.id))
          .returning()

        return updated
      })
    } catch (error) {
      throw taken(error, occasion)
    }
  }

  /**
   * Gone for real. Every document that used the snippet has its own copy of
   * the text, so nothing that went out changes, and the audit log keeps what
   * the snippet said.
   */
  @Delete(':id')
  @RequiresPermission('document.write')
  async remove(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    const [removed] = await this.database.forTenant(identity, (tx) =>
      tx
        .delete(textSnippets)
        .where(eq(textSnippets.id, id as TextSnippetId))
        .returning({ id: textSnippets.id }),
    )

    if (!removed) {
      throw new NotFoundException()
    }

    return { removed: removed.id }
  }
}
