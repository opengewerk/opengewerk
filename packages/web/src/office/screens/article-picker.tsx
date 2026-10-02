import type { IsoDate } from '@opengewerk/domain'
import { Field } from '@opengewerk/platform-web'
import clsx from 'clsx'
import { type KeyboardEvent, useDeferredValue, useId, useState } from 'react'

import { type FoundArticle, useArticleSearch } from '../../app/article-search.js'
import { euros } from '../../app/format.js'
import { lineUnitShort, priceBaseLabel } from '../../app/labels.js'

/** How many articles the list under the field offers. */
const offered = 8

/** "3 Treffer", or "8 von 57 Treffern" when the list shows the first of more. */
function hits(shown: number, total: number): string {
  return total > shown
    ? `${String(shown)} von ${total.toLocaleString('de-DE')} Treffern`
    : `${String(total)} Treffer`
}

/**
 * "Position aus Artikel" (#296), `article_search()` of the board "Neue
 * Position aus einem Artikel": a search over the catalogue that offers what
 * it finds in a list under the field, with the selling price of the
 * document's date. Picked, the article fills the form, and from then on the
 * text is the line's own. With a connection the search asks the server,
 * without one it looks at the articles on the device.
 */
export function ArticlePicker({
  day,
  priced,
  onPick,
}: {
  readonly day: IsoDate
  /** Whether the document shows prices; a report takes no price. */
  readonly priced: boolean
  readonly onPick: (article: FoundArticle) => void
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wanted = useDeferredValue(search)
  const { found, total, where, pending } = useArticleSearch(wanted, day, offered)
  const listId = useId()
  const shown = open && search.trim() !== ''
  const optionId = (index: number) => `${listId}-${String(index)}`

  function pick(article: FoundArticle) {
    onPick(article)
    setSearch('')
    setOpen(false)
    setActive(0)
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((current) => Math.min(current + 1, Math.max(found.length - 1, 0)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => Math.max(current - 1, 0))
    } else if (event.key === 'Enter' && shown) {
      const article = found[active]

      // Enter picks; without a hit it does nothing, rather than send the form.
      event.preventDefault()

      if (article) {
        pick(article)
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      <Field
        label="Position aus Artikel"
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && found[active] ? optionId(active) : undefined}
        autoComplete="off"
        placeholder="Nummer, Bezeichnung oder EAN"
        value={search}
        hint={
          priced
            ? 'Übernimmt Bezeichnung, Beschreibung, Einheit und den Verkaufspreis am Belegdatum. Danach gehört der Text der Position.'
            : 'Übernimmt Bezeichnung, Beschreibung und Einheit. Danach gehört der Text der Position.'
        }
        onChange={(event) => {
          setSearch(event.target.value)
          setOpen(true)
          setActive(0)
        }}
        onKeyDown={onKey}
        onBlur={() => {
          setOpen(false)
        }}
      />
      {shown ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Gefundene Artikel"
          className="absolute top-[60px] right-0 left-0 z-20 m-0 list-none rounded-control border border-line-strong bg-surface p-1 shadow-[0_8px_24px_rgba(15,20,27,0.18)]"
        >
          {found.map((article, index) => (
            <li
              key={article.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              className={clsx(
                'flex cursor-pointer items-baseline gap-2.5 rounded-[3px] px-2.5 py-[7px] text-[14px]',
                index === active && 'bg-surface-sunken',
              )}
              // Before the field loses the focus, which would close the list.
              onMouseDown={(event) => {
                event.preventDefault()
              }}
              onClick={() => {
                pick(article)
              }}
              onMouseEnter={() => {
                setActive(index)
              }}
            >
              <span className="numeric w-11 shrink-0 text-ink-faint">{article.number}</span>
              <span className="min-w-0 grow">{article.designation}</span>
              {priced && article.priceCents !== null ? (
                <span className="numeric whitespace-nowrap text-ink-muted">
                  {euros(article.priceCents)} je{' '}
                  {article.priceBase > 1
                    ? priceBaseLabel(article.priceBase, article.unit)
                    : lineUnitShort[article.unit]}
                </span>
              ) : null}
            </li>
          ))}
          <li role="presentation" className="px-2.5 pt-[7px] pb-1 text-[12px] text-ink-faint">
            {pending
              ? 'Wird gesucht.'
              : found.length === 0
                ? where === 'device'
                  ? 'Kein Artikel auf diesem Gerät passt. Den ganzen Katalog gibt es mit Netz.'
                  : 'Kein Artikel passt zur Suche.'
                : `${hits(found.length, total)}${where === 'device' ? ' auf diesem Gerät' : ''}`}
          </li>
        </ul>
      ) : null}
    </div>
  )
}
