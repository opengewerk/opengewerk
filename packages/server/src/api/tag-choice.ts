import { BadRequestException, UnprocessableEntityException } from '@nestjs/common'
import {
  type CustomerId,
  type SiteId,
  type TagId,
  type TenantId,
  tagKey,
  tagName,
  tagNameProblem,
} from '@opengewerk/domain'
import { pick, type TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

import { customerTags, siteTags, tags } from '../database/schema/index.js'

/** A name for a tag from a request body, shaped as the tag will carry it, or a sentence why not. */
export function tagNameFrom(body: unknown): string {
  const { name } = pick(body, ['name'] as const)

  if (typeof name !== 'string') {
    throw new BadRequestException('name ist der Name des Tags.')
  }

  const problem = tagNameProblem(name)

  if (problem) {
    throw new UnprocessableEntityException(problem)
  }

  return tagName(name)
}

/** The tags a record is to have: the ones there are, and names for new ones. */
export interface TagChoice {
  readonly tagIds: readonly TagId[]
  readonly names: readonly string[]
}

/** Reads `{ tagIds, newTags }`, the whole list of a record's tags. */
export function tagChoiceFrom(body: unknown): TagChoice {
  const { tagIds, newTags = [] } = pick(body, ['tagIds', 'newTags'] as const)

  if (
    !Array.isArray(tagIds) ||
    !tagIds.every((tagId) => typeof tagId === 'string' && tagId.length > 0)
  ) {
    throw new BadRequestException('tagIds ist die Liste der Tags, die der Datensatz tragen soll.')
  }

  if (!Array.isArray(newTags) || !newTags.every((name) => typeof name === 'string')) {
    throw new BadRequestException('newTags ist die Liste der Namen neuer Tags.')
  }

  for (const name of newTags as string[]) {
    const problem = tagNameProblem(name)

    if (problem) {
      throw new UnprocessableEntityException(problem)
    }
  }

  const names = new Map((newTags as string[]).map((name) => [tagKey(name), tagName(name)]))

  return { tagIds: [...new Set(tagIds as TagId[])], names: [...names.values()] }
}

type Target =
  | { readonly kind: 'customer'; readonly id: CustomerId }
  | { readonly kind: 'site'; readonly id: SiteId }

/**
 * Sets the tags of one customer or site as the whole list (#314): whichever
 * is in it and was not is added, whichever was and is not any more is taken
 * off, marked deleted so that every device learns it.
 *
 * A tag named by its id has to be one of this business that is not deleted.
 * A new name becomes a tag, unless the business has one by that name
 * already, whatever its case, which is then the one put on: two people who
 * type "Wallbox" at the same time mean the same tag.
 *
 * Every tag put on is read with a share lock, which a deletion has to wait
 * for, so a tag cannot be deleted between being found and being put on and
 * keep an assignment its deletion never saw. The caller holds the record
 * itself locked, so two lists for one record come one after the other.
 */
export async function setTags(
  tx: TenantTransaction,
  tenantId: TenantId,
  target: Target,
  choice: TagChoice,
): Promise<{ readonly tagIds: readonly TagId[] }> {
  const known =
    choice.tagIds.length === 0
      ? []
      : await tx
          .select({ id: tags.id })
          .from(tags)
          .where(and(inArray(tags.id, [...choice.tagIds]), isNull(tags.deletedAt)))
          .for('share')

  if (known.length !== choice.tagIds.length) {
    throw new UnprocessableEntityException(
      'Einen der Tags gibt es nicht mehr. Die Seite neu laden und noch einmal wählen.',
    )
  }

  const wanted = new Set<TagId>(choice.tagIds)

  for (const name of choice.names) {
    // Another request may make the same name in between; the index lets one
    // of them win and the other finds it on the second look.
    await tx.insert(tags).values({ tenantId, name }).onConflictDoNothing()

    const [tag] = await tx
      .select({ id: tags.id })
      .from(tags)
      .where(and(sql`lower(${tags.name}) = lower(${name})`, isNull(tags.deletedAt)))
      .for('share')

    if (tag) {
      wanted.add(tag.id)
    }
  }

  const table = target.kind === 'customer' ? customerTags : siteTags
  const owner = target.kind === 'customer' ? customerTags.customerId : siteTags.siteId
  const current = await tx
    .select({ id: table.id, tagId: table.tagId })
    .from(table)
    .where(and(eq(owner, target.id), isNull(table.deletedAt)))
  const held = new Set(current.map((row) => row.tagId))
  const adding = [...wanted].filter((tagId) => !held.has(tagId))

  if (adding.length > 0) {
    await (target.kind === 'customer'
      ? tx
          .insert(customerTags)
          .values(adding.map((tagId) => ({ tenantId, customerId: target.id, tagId })))
      : tx.insert(siteTags).values(adding.map((tagId) => ({ tenantId, siteId: target.id, tagId }))))
  }

  const removing = current.filter((row) => !wanted.has(row.tagId))

  if (removing.length > 0) {
    await tx
      .update(table)
      .set({ deletedAt: new Date() })
      .where(
        inArray(
          table.id,
          removing.map((row) => row.id),
        ),
      )
  }

  return { tagIds: [...wanted].sort() }
}
