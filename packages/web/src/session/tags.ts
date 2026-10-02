import { request } from '@opengewerk/platform-web/sync'

/**
 * The tags of the business (#314), made, renamed and deleted at their route,
 * and put on a customer or a site at the route of that record. None of it
 * goes through the outbox: a tag is master data, which changes with a
 * connection, and the server asks whether a name is taken. The rows come down
 * with the next exchange like any other.
 */

/** The tags a record is to have, as the whole list: the ones there are, and names for new ones. */
export interface TagChoice {
  readonly tagIds: readonly string[]
  readonly newTags: readonly string[]
}

export function createTag(name: string): Promise<{ readonly id: string; readonly name: string }> {
  return request('/customers/tags', { method: 'POST', body: JSON.stringify({ name }) })
}

export function renameTag(
  tagId: string,
  name: string,
): Promise<{ readonly id: string; readonly name: string }> {
  return request(`/customers/tags/${encodeURIComponent(tagId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export function removeTag(tagId: string): Promise<{ readonly removed: string }> {
  return request(`/customers/tags/${encodeURIComponent(tagId)}`, { method: 'DELETE' })
}

export function setTags(
  record: { readonly customerId: string } | { readonly siteId: string },
  choice: TagChoice,
): Promise<{ readonly tagIds: readonly string[] }> {
  const path =
    'customerId' in record
      ? `/customers/${encodeURIComponent(record.customerId)}/tags`
      : `/sites/${encodeURIComponent(record.siteId)}/tags`

  return request(path, { method: 'PUT', body: JSON.stringify(choice) })
}
