import { accessProblem, type RecordState } from '@opengewerk/domain'
import { Check, Eye, EyeOff, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'

import { Button, Confirm, Field, Panel } from '../../components/index.js'
import { clockTime } from '../../app/format.js'
import { useMay } from '../../app/queries.js'
import {
  changeAccess,
  createAccess,
  removeAccess,
  revealAccess,
  type Revealed,
  valueStampOf,
} from '../../session/site-access.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRelated, useSync } from '../../sync/provider.js'
import { RequestRefused } from '../../sync/transport.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/**
 * "Zugang", the card of the ways into a site in the office (#286), as the
 * board "Objekt mit Zugang: verdeckt, angezeigt, nicht mehr lesbar" draws it:
 * what each opens and its hint, the value hidden until somebody asks for it.
 * Asking goes to the server, which answers with the value and keeps who saw
 * it; nothing of the value lies on this device. A value on the screen counts
 * only while the access still has it: changed by somebody else meanwhile, it
 * is hidden again. Only with `site.access`, which the owner and the office
 * have.
 */
export function AccessPanel({ siteId }: { readonly siteId: string }) {
  const client = useSync()
  const may = useMay('site.access')
  const accesses = useRelated('site_accesses', 'siteId', siteId)
  const [shown, setShown] = useState<
    ReadonlyMap<string, Revealed & { readonly at: Date; readonly stamp: string }>
  >(new Map())
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [removing, setRemoving] = useState<RecordState | null>(null)
  const [busy, setBusy] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  // An access being asked for: its button stays pressed until the answer is
  // there, so that two quick clicks make one record (Greptile on #445). The
  // ref answers at once, the state draws the button.
  const pending = useRef(new Set<string>())
  const [asking, setAsking] = useState<ReadonlySet<string>>(new Set())

  if (!may) {
    return null
  }

  async function reveal(access: RecordState) {
    const id = String(access['id'])
    const stamp = valueStampOf(access)

    if (pending.current.has(id)) {
      return
    }

    pending.current.add(id)
    setAsking((current) => new Set(current).add(id))
    setTrouble(null)

    try {
      const answer = await revealAccess(siteId, id)

      setShown((current) => new Map(current).set(id, { ...answer, at: new Date(), stamp }))
    } catch (error) {
      setTrouble(
        saidWhy(error, 'Keine Verbindung. Ein Zugang wird im Büro nur mit Verbindung angezeigt.'),
      )
    } finally {
      pending.current.delete(id)
      setAsking((current) => {
        const next = new Set(current)

        next.delete(id)

        return next
      })
    }
  }

  function hide(id: string) {
    setShown((current) => {
      const next = new Map(current)

      next.delete(id)

      return next
    })
  }

  const sorted = [...accesses].sort((left, right) =>
    text(left, 'designation').localeCompare(text(right, 'designation'), 'de'),
  )

  // While a form is open, the card is the form, under its own title, as the
  // board "Zugang bearbeiten" draws it.
  const edited =
    editing !== null && editing !== 'new'
      ? sorted.find((access) => String(access['id']) === editing)
      : undefined
  const mode = editing === 'new' ? 'new' : edited ? 'edit' : 'list'

  return (
    <Panel
      title={
        mode === 'new' ? 'Zugang hinzufügen' : mode === 'edit' ? 'Zugang bearbeiten' : 'Zugang'
      }
      action={
        mode === 'list' ? (
          <Button size="small" icon={Plus} onClick={() => setEditing('new')}>
            Hinzufügen
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-2">
        {mode === 'new' ? (
          <AccessForm
            busy={busy}
            onCancel={() => setEditing(null)}
            onSave={async (input) => {
              setBusy(true)

              try {
                await createAccess(siteId, input)
                await client.synchronise()
                setEditing(null)

                return null
              } catch (error) {
                return saidWhy(error, 'Der Zugang ließ sich nicht speichern.')
              } finally {
                setBusy(false)
              }
            }}
          />
        ) : edited ? (
          <AccessForm
            access={edited}
            busy={busy}
            onCancel={() => setEditing(null)}
            onRemove={() => setRemoving(edited)}
            onSave={async (input) => {
              const id = String(edited['id'])

              setBusy(true)

              try {
                await changeAccess(siteId, id, input)
                await client.synchronise()
                hide(id)
                setEditing(null)

                return null
              } catch (error) {
                return saidWhy(error, 'Der Zugang ließ sich nicht speichern.')
              } finally {
                setBusy(false)
              }
            }}
          />
        ) : sorted.length === 0 ? (
          <p className="text-[13px] leading-[1.4] text-ink-muted">
            Noch kein Zugang eingetragen. Etwa der Code des Schlüsseltresors oder wo der Schlüssel
            liegt.
          </p>
        ) : (
          <ul className="flex flex-col">
            {sorted.map((access) => {
              const id = String(access['id'])
              const asked = shown.get(id)
              // Only while the access still has the value that was shown.
              const seen = asked?.stamp === valueStampOf(access) ? asked : undefined
              const state = String(
                access['valueState'] ?? (maybeText(access, 'valueSetAt') ? 'readable' : 'none'),
              )

              return (
                <li key={id} className="border-b border-row py-2 last:border-b-0">
                  <div className="flex items-start gap-2">
                    <span className="flex min-w-0 grow items-center gap-1.5 text-[14px] font-semibold [overflow-wrap:anywhere]">
                      <KeyRound
                        size={14}
                        strokeWidth={2.2}
                        aria-hidden="true"
                        className="shrink-0 text-ink-muted"
                      />
                      {text(access, 'designation')}
                    </span>
                    <button
                      type="button"
                      aria-label={`${text(access, 'designation')} bearbeiten`}
                      onClick={() => setEditing(id)}
                      className="flex size-[26px] shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent text-ink-muted"
                    >
                      <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </div>
                  {seen?.state === 'readable' ? (
                    <>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="numeric grow font-condensed text-[18px] font-semibold tracking-[1.5px] [overflow-wrap:anywhere]">
                          {seen.value}
                        </span>
                        <Button
                          size="small"
                          icon={EyeOff}
                          aria-label={`${text(access, 'designation')} verbergen`}
                          onClick={() => hide(id)}
                        >
                          Verbergen
                        </Button>
                      </div>
                      <p className="mt-[3px] text-[12px] text-ink-faint">
                        {`Angezeigt um ${clockTime(seen.at)}, steht im Änderungsprotokoll.`}
                      </p>
                    </>
                  ) : seen?.state === 'unreadable' || state === 'unreadable' ? (
                    <p className="mt-1 text-[13px] leading-[1.4] text-waiting">
                      Nicht mehr lesbar: der Schlüssel dieser Instanz hat sich geändert. Bitte den
                      Wert neu eintragen.
                    </p>
                  ) : state === 'readable' ? (
                    <div className="mt-1 flex items-center gap-2">
                      <span
                        aria-label="verdeckt"
                        className="grow text-[15px] tracking-[3px] text-ink-muted"
                      >
                        ••••••
                      </span>
                      <Button
                        size="small"
                        icon={Eye}
                        aria-label={`${text(access, 'designation')} anzeigen`}
                        disabled={asking.has(id)}
                        onClick={() => void reveal(access)}
                      >
                        Anzeigen
                      </Button>
                    </div>
                  ) : null}
                  {maybeText(access, 'hint') ? (
                    <p className="mt-1 text-[13px] text-ink-muted">{text(access, 'hint')}</p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
      </div>

      <Confirm
        open={removing !== null}
        title="Zugang löschen?"
        confirm="Löschen"
        busy={busy}
        onConfirm={() => {
          if (!removing) {
            return
          }

          const id = String(removing['id'])

          setBusy(true)
          void removeAccess(siteId, id)
            .then(() => client.synchronise())
            .then(() => {
              setRemoving(null)
              setEditing(null)
              hide(id)
            })
            .catch((error: unknown) => {
              setTrouble(saidWhy(error, 'Der Zugang ließ sich nicht löschen.'))
              setRemoving(null)
            })
            .finally(() => setBusy(false))
        }}
        onCancel={() => setRemoving(null)}
      >
        {`„${removing ? text(removing, 'designation') : ''}“ verschwindet mit seinem Wert. Wer den Wert noch braucht, trägt ihn neu ein.`}
      </Confirm>
    </Panel>
  )
}

function AccessForm({
  access,
  busy,
  onSave,
  onCancel,
  onRemove,
}: {
  readonly access?: RecordState
  readonly busy: boolean
  readonly onSave: (input: {
    designation: string
    hint: string | null
    value: string
  }) => Promise<string | null>
  readonly onCancel: () => void
  readonly onRemove?: () => void
}) {
  const [designation, setDesignation] = useState(access ? text(access, 'designation') : '')
  const [value, setValue] = useState('')
  const [hint, setHint] = useState(access ? (maybeText(access, 'hint') ?? '') : '')
  const [problem, setProblem] = useState<string | null>(null)
  const changing = access !== undefined

  async function submit(event: FormEvent) {
    event.preventDefault()

    const found = accessProblem({ designation, hint, value })

    if (found) {
      setProblem(found)

      return
    }

    setProblem(
      await onSave({
        designation: designation.trim(),
        hint: hint.trim() === '' ? null : hint.trim(),
        value,
      }),
    )
  }

  return (
    <form className="flex flex-col gap-2.5" onSubmit={(event) => void submit(event)}>
      <Field
        label="Bezeichnung"
        value={designation}
        onChange={(event) => setDesignation(event.target.value)}
        required
      />
      <Field
        label="Wert"
        value={value}
        autoComplete="off"
        placeholder={changing ? 'unverändert' : undefined}
        hint={
          changing
            ? 'Leer lassen, um den bisherigen Wert zu behalten. Versiegelt gespeichert, angezeigt nur auf Klick.'
            : 'Versiegelt gespeichert, angezeigt nur auf Klick. Jedes Anzeigen steht im Änderungsprotokoll.'
        }
        onChange={(event) => setValue(event.target.value)}
      />
      <Field label="Hinweis" value={hint} onChange={(event) => setHint(event.target.value)} />
      {problem ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
        {onRemove ? (
          <>
            <Button tone="danger" icon={Trash2} onClick={onRemove} disabled={busy}>
              Löschen
            </Button>
            <div className="grow" />
          </>
        ) : null}
        <Button onClick={onCancel} disabled={busy}>
          Abbrechen
        </Button>
        <Button type="submit" tone="primary" icon={Check} disabled={busy}>
          Speichern
        </Button>
      </div>
    </form>
  )
}
