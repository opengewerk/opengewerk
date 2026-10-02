import {
  type CustomerStanding,
  customerStanding,
  type JobStatus,
  type RecordState,
  tagKey,
  tagName,
  tagNameProblem,
} from '@opengewerk/domain'
import { Field } from '@opengewerk/platform-web'
import { text, useRecords } from '@opengewerk/platform-web/sync'
import clsx from 'clsx'
import { Tag as TagIcon, X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

import { jobStatusOf } from '../app/labels.js'

/**
 * The tags of the business on customers and sites (#314), as the office shows
 * and chooses them. The tags travel to every device like the records they
 * are on; which record has which is `customer_tags` and `site_tags`, both
 * set at a route and only read here.
 */

export type Tagged = 'customer' | 'site'

const links: Readonly<
  Record<Tagged, { readonly entity: string; readonly field: string; readonly owners: string }>
> = {
  customer: { entity: 'customer_tags', field: 'customerId', owners: 'customers' },
  site: { entity: 'site_tags', field: 'siteId', owners: 'sites' },
}

const pillSizes = {
  small: 'h-[21px] gap-1 px-2 text-[11px]',
  normal: 'h-[22px] gap-1 px-2 text-[12px]',
  large: 'h-[23px] gap-1 px-2 text-[13px]',
} as const

/**
 * One tag, `tag_pill()` of the canvas: a rounded label with the tag in front,
 * set apart from a status by its shape. Small in a list, large in a form,
 * where it can be taken off at its cross. A name as long as a tag may have
 * is cut short with an ellipsis rather than running past the edge of a
 * telephone; the whole name stays in the text and in the title.
 */
export function TagPill({
  name,
  size = 'normal',
  onRemove,
}: {
  readonly name: string
  readonly size?: keyof typeof pillSizes
  readonly onRemove?: () => void
}) {
  const icon = size === 'small' ? 11 : size === 'normal' ? 12 : 13

  return (
    <span
      title={name}
      className={clsx(
        'inline-flex max-w-full min-w-0 items-center self-start rounded-full border border-line bg-surface-sunken text-ink-muted',
        pillSizes[size],
      )}
    >
      <TagIcon size={icon} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 truncate">{name}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`${name} entfernen`}
          onClick={onRemove}
          className="-mr-[3px] inline-flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 text-ink-muted"
        >
          <X size={12} strokeWidth={2.4} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  )
}

/** Several tags in a row that wraps, or nothing when there are none. */
export function TagPills({
  names,
  size,
  className,
}: {
  readonly names: readonly string[]
  readonly size?: keyof typeof pillSizes
  readonly className?: string
}): ReactNode {
  if (names.length === 0) {
    return null
  }

  return (
    <span className={clsx('inline-flex max-w-full min-w-0 flex-wrap gap-1.5', className)}>
      {names.map((name) => (
        <TagPill key={name} name={name} size={size} />
      ))}
    </span>
  )
}

/** The tags of the business, in the order of their names. */
export function useTags(): readonly RecordState[] {
  const tags = useRecords('tags')

  return useMemo(
    () =>
      [...tags].sort((left, right) => text(left, 'name').localeCompare(text(right, 'name'), 'de')),
    [tags],
  )
}

/**
 * Which tags each customer or each site has, by the id of the record: the
 * ids, and the names in the order a person reads them. A tag deleted in the
 * meantime is left out, although its row on the record is marked deleted in
 * the same step and goes with the next exchange; so is a record this device
 * does not hold, deleted or outside its part of the business.
 */
export function useTagsBy(
  kind: Tagged,
): ReadonlyMap<string, { readonly ids: readonly string[]; readonly names: readonly string[] }> {
  const tags = useRecords('tags')
  const rows = useRecords(links[kind].entity)
  const owners = useRecords(links[kind].owners)

  return useMemo(() => {
    const names = new Map(tags.map((tag) => [String(tag['id']), text(tag, 'name')]))
    const held = new Set(owners.map((owner) => String(owner['id'])))
    const byRecord = new Map<string, { ids: string[]; names: string[] }>()

    for (const row of rows) {
      const tagId = text(row, 'tagId')
      const name = names.get(tagId)
      const key = text(row, links[kind].field)

      if (name === undefined || !held.has(key)) {
        continue
      }

      const entry = byRecord.get(key) ?? { ids: [], names: [] }

      entry.ids.push(tagId)
      entry.names.push(name)
      byRecord.set(key, entry)
    }

    for (const entry of byRecord.values()) {
      entry.names.sort((left, right) => left.localeCompare(right, 'de'))
    }

    return byRecord
  }, [tags, rows, owners, kind])
}

/** How many customers or sites carry each tag, by the id of the tag. */
export function useTagCounts(kind: Tagged): ReadonlyMap<string, number> {
  const tagged = useTagsBy(kind)

  return useMemo(() => {
    const counts = new Map<string, number>()

    for (const entry of tagged.values()) {
      for (const tagId of entry.ids) {
        counts.set(tagId, (counts.get(tagId) ?? 0) + 1)
      }
    }

    return counts
  }, [tagged])
}

/**
 * Whether each customer is an existing one or new, read off the jobs as
 * `customerStanding` does: a completed job makes an existing customer.
 */
export function useStandings(): ReadonlyMap<string, CustomerStanding> {
  const jobs = useRecords('jobs')

  return useMemo(() => {
    const statuses = new Map<string, JobStatus[]>()

    for (const job of jobs) {
      const key = text(job, 'customerId')

      statuses.set(key, [...(statuses.get(key) ?? []), jobStatusOf(job)])
    }

    return new Map([...statuses].map(([key, list]) => [key, customerStanding(list)]))
  }, [jobs])
}

/** The tags a record is to have: those there are, and names for new ones. */
export interface ChosenTags {
  readonly tagIds: readonly string[]
  readonly newTags: readonly string[]
}

type Option =
  | { readonly kind: 'tag'; readonly id: string; readonly name: string; readonly count: number }
  | { readonly kind: 'new'; readonly name: string }

/** "bei 2 Kunden", "bei einem Objekt", "bei keinem Kunden". */
function usage(count: number, kind: Tagged): string {
  const [none, one, many] =
    kind === 'customer'
      ? ['bei keinem Kunden', 'bei einem Kunden', 'Kunden']
      : ['bei keinem Objekt', 'bei einem Objekt', 'Objekten']

  return count === 0 ? none : count === 1 ? one : `bei ${String(count)} ${many}`
}

/** The typed part of a name in bold, as the canvas shows a match. */
function marked(name: string, typed: string): ReactNode {
  const at = name.toLowerCase().indexOf(typed.toLowerCase())

  if (typed === '' || at < 0) {
    return name
  }

  return (
    <>
      {name.slice(0, at)}
      <b>{name.slice(at, at + typed.length)}</b>
      {name.slice(at + typed.length)}
    </>
  )
}

/**
 * The tags of a record in its form, `tag_field()` of the canvas: the ones it
 * has, each with a cross, and a field that finds a tag of the business or
 * makes a new one. Enter takes the marked suggestion and never sends the
 * form; the arrows move the mark, Escape closes the list.
 */
export function TagPicker({
  kind,
  chosen,
  onChange,
}: {
  readonly kind: Tagged
  readonly chosen: ChosenTags
  readonly onChange: (next: ChosenTags) => void
}) {
  const tags = useTags()
  const counts = useTagCounts(kind)
  const [typed, setTyped] = useState('')
  const [open, setOpen] = useState(false)
  const [marker, setMarker] = useState(0)
  const listId = useId()
  const hintId = useId()

  const nameOf = useMemo(
    () => new Map(tags.map((tag) => [String(tag['id']), text(tag, 'name')])),
    [tags],
  )
  const query = tagName(typed)
  const key = tagKey(query)
  const taken = new Set([
    ...chosen.tagIds.map((id) => tagKey(nameOf.get(id) ?? '')),
    ...chosen.newTags.map(tagKey),
  ])

  const found: Option[] = tags
    .filter((tag) => !chosen.tagIds.includes(String(tag['id'])))
    .filter((tag) => key === '' || tagKey(text(tag, 'name')).includes(key))
    .slice(0, 8)
    .map((tag) => ({
      kind: 'tag',
      id: String(tag['id']),
      name: text(tag, 'name'),
      count: counts.get(String(tag['id'])) ?? 0,
    }))
  const exists = tags.some((tag) => tagKey(text(tag, 'name')) === key) || taken.has(key)
  const options: readonly Option[] =
    key !== '' && !exists && tagNameProblem(query) === null
      ? [...found, { kind: 'new', name: query }]
      : found
  const shown = open && options.length > 0
  const at = Math.min(marker, options.length - 1)

  const take = (option: Option) => {
    onChange(
      option.kind === 'tag'
        ? { ...chosen, tagIds: [...chosen.tagIds, option.id] }
        : { ...chosen, newTags: [...chosen.newTags, option.name] },
    )
    setTyped('')
    setMarker(0)
  }

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setMarker((current) => {
        const last = Math.max(options.length - 1, 0)

        return event.key === 'ArrowDown' ? Math.min(current + 1, last) : Math.max(current - 1, 0)
      })
    } else if (event.key === 'Enter') {
      // Never the form: a tag is taken or nothing happens.
      event.preventDefault()

      const option = shown ? options[at] : undefined

      if (option) {
        take(option)
      }
    } else if (event.key === 'Escape' && shown) {
      event.preventDefault()
      setOpen(false)
    }
  }

  const problem = key === '' || exists ? null : tagNameProblem(query)

  return (
    <div className="flex flex-col gap-[9px]">
      {chosen.tagIds.length + chosen.newTags.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
          {chosen.tagIds.map((id) => (
            <li key={id} className="max-w-full min-w-0">
              <TagPill
                name={nameOf.get(id) ?? 'ein gelöschter Tag'}
                size="large"
                onRemove={() => {
                  onChange({ ...chosen, tagIds: chosen.tagIds.filter((other) => other !== id) })
                }}
              />
            </li>
          ))}
          {chosen.newTags.map((name) => (
            <li key={`new:${name}`} className="max-w-full min-w-0">
              <TagPill
                name={name}
                size="large"
                onRemove={() => {
                  onChange({ ...chosen, newTags: chosen.newTags.filter((other) => other !== name) })
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-col gap-1">
        <div className="relative">
          <Field
            label="Tag hinzufügen"
            value={typed}
            role="combobox"
            aria-expanded={shown}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={shown ? `${listId}-${String(at)}` : undefined}
            autoComplete="off"
            problem={problem ?? undefined}
            aria-describedby={hintId}
            onChange={(event) => {
              setTyped(event.target.value)
              setOpen(true)
              setMarker(0)
            }}
            onFocus={() => {
              setOpen(true)
            }}
            onBlur={() => {
              setOpen(false)
            }}
            onKeyDown={onKey}
          />
          {shown ? (
            <ul
              id={listId}
              role="listbox"
              aria-label="Vorschläge"
              className="absolute top-full right-0 left-0 z-10 m-0 mt-1 list-none rounded-control border border-line-strong bg-surface py-1 shadow-[0_6px_18px_rgb(27_36_48/0.14)]"
            >
              {options.map((option, index) => (
                <li
                  key={option.kind === 'tag' ? option.id : 'new'}
                  id={`${listId}-${String(index)}`}
                  role="option"
                  aria-selected={index === at}
                  // Down, not click: the field would lose the focus first and
                  // close the list under the pointer.
                  onMouseDown={(event) => {
                    event.preventDefault()
                    take(option)
                  }}
                  className={clsx(
                    'flex cursor-pointer items-center gap-2 px-2.5 py-[7px] text-body',
                    index === at && 'bg-surface-sunken',
                  )}
                >
                  <TagIcon
                    size={13}
                    strokeWidth={2.2}
                    aria-hidden="true"
                    className="text-ink-muted"
                  />
                  {option.kind === 'tag' ? (
                    <>
                      <span className="grow">{marked(option.name, query)}</span>
                      <span className="text-[12px] text-ink-faint">
                        {usage(option.count, kind)}
                      </span>
                    </>
                  ) : (
                    <span className="grow">{`Neuen Tag „${option.name}“ anlegen`}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <p id={hintId} className="text-[13px] leading-[1.4] text-ink-faint">
          Ein Tag gilt für Kunden und Objekte. Umbenennen und löschen lassen sich Tags unter
          „Einstellungen“, „Tags“.
        </p>
      </div>
    </div>
  )
}
