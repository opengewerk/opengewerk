import { tagName, tagNameMaxLength, tagNameProblem, type RecordState } from '@opengewerk/domain'
import { Button, Confirm, Field, Panel, useBand } from '@opengewerk/platform-web'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { useMay } from '../../app/queries.js'
import { createTag, removeTag, renameTag } from '../../session/tags.js'
import { RequestRefused } from '../../sync/transport.js'
import { text } from '../../sync/fields.js'
import { useSync } from '../../sync/provider.js'
import { SettingsPage, SettingsText } from '../settings-frame.js'
import { TagPill, useTagCounts, useTags } from '../tags.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/**
 * "Tags" under the settings (#314), `einst_tags()` of the canvas: every tag of
 * the business with how many customers and sites have it, renamed in its line,
 * deleted after a question, and a field for a new one.
 *
 * Whoever may change customers keeps their tags, the office as much as the
 * owner; the tags come to the screen through the sync like the records they
 * are on, and every change goes to the route and comes back with the next
 * exchange.
 */
export function TagsScreen() {
  return (
    <SettingsPage active="tags" title="Tags" sub="Für Kunden und Objekte dieses Betriebs.">
      <TagsSection />
    </SettingsPage>
  )
}

function TagsSection() {
  const client = useSync()
  const band = useBand()
  const narrow = band === 'S' || band === 'M'
  const mayWrite = useMay('customer.write')
  const tags = useTags()
  const customers = useTagCounts('customer')
  const sites = useTagCounts('site')
  const [renaming, setRenaming] = useState<{ readonly id: string; readonly name: string } | null>(
    null,
  )
  const [removing, setRemoving] = useState<RecordState | null>(null)
  const [fresh, setFresh] = useState('')
  const [busy, setBusy] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function run(step: () => Promise<unknown>, fallback: string): Promise<boolean> {
    setBusy(true)
    setTrouble(null)

    try {
      await step()
      await client.synchronise()

      return true
    } catch (error) {
      setTrouble(saidWhy(error, fallback))

      return false
    } finally {
      setBusy(false)
    }
  }

  async function saveName(event: FormEvent) {
    event.preventDefault()

    if (!renaming) {
      return
    }

    const problem = tagNameProblem(renaming.name)

    if (problem) {
      setTrouble(problem)

      return
    }

    if (
      await run(
        () => renameTag(renaming.id, tagName(renaming.name)),
        'Der Tag ließ sich nicht umbenennen.',
      )
    ) {
      setRenaming(null)
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault()

    const problem = tagNameProblem(fresh)

    if (problem) {
      setTrouble(problem)

      return
    }

    if (await run(() => createTag(tagName(fresh)), 'Der Tag ließ sich nicht anlegen.')) {
      setFresh('')
    }
  }

  const counted = (tag: RecordState) => {
    const id = String(tag['id'])

    return { customers: customers.get(id) ?? 0, sites: sites.get(id) ?? 0 }
  }

  const actions = (tag: RecordState) =>
    mayWrite && renaming?.id !== String(tag['id']) ? (
      <>
        <Button
          size="small"
          aria-label={`${text(tag, 'name')} umbenennen`}
          onClick={() => {
            setTrouble(null)
            setRenaming({ id: String(tag['id']), name: text(tag, 'name') })
          }}
        >
          Umbenennen
        </Button>
        <Button
          size="small"
          tone="danger"
          aria-label={`${text(tag, 'name')} löschen`}
          onClick={() => {
            setTrouble(null)
            setRemoving(tag)
          }}
        >
          Löschen
        </Button>
      </>
    ) : null

  const nameOf = (tag: RecordState) =>
    renaming?.id === String(tag['id']) ? (
      <form
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(event) => void saveName(event)}
      >
        {/* In the line as on the board, the name in the field saying what it is. */}
        <input
          type="text"
          aria-label="Neuer Name"
          maxLength={tagNameMaxLength}
          value={renaming.name}
          onChange={(event) => {
            setRenaming({ id: renaming.id, name: event.target.value })
          }}
          className={
            narrow
              ? 'h-control-lg min-h-tap w-full rounded-[4px] border border-control bg-input px-3 text-[16px] text-ink'
              : 'h-[30px] w-[220px] rounded-[4px] border border-control bg-input px-[9px] text-[14px] text-ink'
          }
          autoFocus
        />
        <Button type="submit" size="small" disabled={busy}>
          Speichern
        </Button>
        <Button
          size="small"
          disabled={busy}
          onClick={() => {
            setRenaming(null)
            setTrouble(null)
          }}
        >
          Abbrechen
        </Button>
      </form>
    ) : (
      <TagPill name={text(tag, 'name')} size="large" />
    )

  return (
    <Panel title="Tags" roomy>
      <div className="flex flex-col gap-3">
        <SettingsText>
          Tags ordnen Kunden und Objekte, etwa nach Gewerk, Region oder Vertrag, und die Kundenliste
          filtert nach ihnen. Die Art des Kunden und ob er Bestandskunde ist, folgen aus Stammdaten
          und Aufträgen und brauchen keinen Tag.
        </SettingsText>

        {tags.length === 0 ? (
          <SettingsText muted>Noch kein Tag angelegt.</SettingsText>
        ) : narrow ? (
          <ul aria-label="Tags des Betriebs" className="flex flex-col gap-2">
            {tags.map((tag) => {
              const count = counted(tag)

              return (
                <li
                  key={String(tag['id'])}
                  className="flex flex-col gap-2 rounded-[5px] border border-line bg-surface px-3 py-2.5"
                >
                  {nameOf(tag)}
                  <span className="text-[13px] text-ink-muted">
                    {`${amountOf(count.customers, 'Kunde', 'Kunden')} · ${amountOf(count.sites, 'Objekt', 'Objekte')}`}
                  </span>
                  <div className="flex flex-wrap gap-2">{actions(tag)}</div>
                </li>
              )
            })}
          </ul>
        ) : (
          <div>
            <div
              aria-hidden="true"
              className="flex gap-3 pb-1.5 font-condensed text-[12px] font-semibold tracking-[0.8px] text-ink-faint uppercase"
            >
              <span className="grow">Tag</span>
              <span className="w-[70px] shrink-0 text-right">Kunden</span>
              <span className="w-[70px] shrink-0 text-right">Objekte</span>
              <span className="w-[190px] shrink-0" />
            </div>
            <ul aria-label="Tags des Betriebs" className="flex flex-col">
              {tags.map((tag) => {
                const count = counted(tag)

                return (
                  <li
                    key={String(tag['id'])}
                    className="flex items-center gap-3 border-t border-row py-2"
                  >
                    <span className="min-w-0 grow">{nameOf(tag)}</span>
                    <span className="numeric w-[70px] shrink-0 text-right text-[14px]">
                      <span className="sr-only">Kunden: </span>
                      {count.customers}
                    </span>
                    <span className="numeric w-[70px] shrink-0 text-right text-[14px]">
                      <span className="sr-only">Objekte: </span>
                      {count.sites}
                    </span>
                    <span className="flex w-[190px] shrink-0 justify-end gap-1.5">
                      {actions(tag)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}

        {mayWrite ? (
          <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => void add(event)}>
            <Field
              label="Neuer Tag"
              value={fresh}
              placeholder="etwa Wärmepumpe"
              onChange={(event) => {
                setFresh(event.target.value)
              }}
              className="w-[320px] max-sm:w-full"
            />
            <Button type="submit" tone="primary" icon={Plus} disabled={busy}>
              Tag anlegen
            </Button>
          </form>
        ) : null}
      </div>

      <Confirm
        open={removing !== null}
        title="Tag löschen?"
        confirm="Löschen"
        busy={busy}
        onConfirm={() => {
          if (removing) {
            void run(
              () => removeTag(String(removing['id'])),
              'Der Tag ließ sich nicht löschen.',
            ).then(() => {
              setRemoving(null)
            })
          }
        }}
        onCancel={() => {
          setRemoving(null)
        }}
      >
        {`„${removing ? text(removing, 'name') : ''}“ verschwindet von jedem Kunden und jedem Objekt, das ihn trägt. Die Kunden und Objekte selbst bleiben.`}
      </Confirm>
    </Panel>
  )
}

/** "1 Kunde", "2 Kunden": a number with its word in the right number. */
function amountOf(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`
}
