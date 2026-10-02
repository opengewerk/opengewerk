import { type PasskeyEntry, passkeyNameMaxLength, passkeyNameProblem } from '@opengewerk/domain'
import { Button, Confirm, Field, Panel, useBand } from '@opengewerk/platform-web'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FingerprintPattern, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { deviceName } from '../../app/devices.js'
import { clockTime, date, moment } from '../../app/format.js'
import { accountQuery } from '../../app/queries.js'
import {
  addPasskey,
  passkeys,
  passkeysSupported,
  passkeyTrouble,
  reconfirm,
  removePasskey,
  renamePasskey,
} from '../../session/passkeys.js'
import { RequestRefused } from '../../sync/transport.js'
import { SettingsText } from '../settings-frame.js'

/** "Heute, 08:12" for today, the day and the time for any other, "Noch nie" for never. */
function lastUsed(value: string | null): string {
  if (value === null) {
    return 'Noch nie'
  }

  return date(value) === date(new Date().toISOString())
    ? `Heute, ${clockTime(new Date(value))}`
    : moment(value)
}

/** The code of a refusal of the server, `RECONFIRMATION_REQUIRED` and the like. */
function codeOf(error: unknown): string | null {
  const code = (error instanceof RequestRefused ? error.body : null) as { code?: unknown } | null

  return typeof code?.code === 'string' ? code.code : null
}

/** A sentence that went wrong, in the card. */
function Trouble({ children }: { readonly children: string }) {
  return (
    <p role="alert" className="text-[13px] font-semibold text-conflict">
      {children}
    </p>
  )
}

/**
 * The passkeys of this account (#167, #248), `passkeys_card()` of the canvas:
 * each with its name, when it was added and when it last signed in, renamed
 * in its line and deleted after a question; and a new one on this device
 * after confirming again with the password and, where set up, the code.
 *
 * Below 1024 pixels a box per passkey, as the board "Einst-Passkeys-390" draws
 * it for a phone.
 */
export function PasskeysPanel() {
  const queries = useQueryClient()
  // Boxes below 1024 pixels, where a button grows to the size of a finger and
  // two of them no longer fit a column of a table; the board draws them at 390.
  const band = useBand()
  const narrow = band === 'S' || band === 'M'
  const list = useQuery({ queryKey: ['passkeys'], queryFn: passkeys })
  const [supported] = useState(passkeysSupported)
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [removing, setRemoving] = useState<PasskeyEntry | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)

  const rename = useMutation({
    mutationFn: (wanted: { id: string; name: string }) => renamePasskey(wanted.id, wanted.name),
    onSuccess: () => {
      setRenaming(null)
      void queries.invalidateQueries({ queryKey: ['passkeys'] })
    },
    onError: (error) => {
      setTrouble(
        error instanceof RequestRefused ? error.message : 'Der Name ließ sich nicht ändern.',
      )
    },
  })

  const remove = useMutation({
    mutationFn: removePasskey,
    onSuccess: () => {
      setRemoving(null)
      void queries.invalidateQueries({ queryKey: ['passkeys'] })
    },
    onError: () => {
      setRemoving(null)
      setTrouble('Der Passkey ließ sich nicht löschen.')
    },
  })

  function startRenaming(passkey: PasskeyEntry) {
    setTrouble(null)
    setRenaming({ id: passkey.id, name: passkey.name })
  }

  function saveName(event: FormEvent) {
    event.preventDefault()

    if (!renaming) {
      return
    }

    const problem = passkeyNameProblem(renaming.name)

    if (problem) {
      setTrouble(problem)

      return
    }

    setTrouble(null)
    rename.mutate({ id: renaming.id, name: renaming.name.trim() })
  }

  const entries = list.data ?? []

  return (
    <Panel title="Passkeys" roomy>
      <div className="flex flex-col gap-2.5">
        <SettingsText muted>
          Mit einem Passkey meldest du dich ohne Passwort an, bestätigt mit Fingerabdruck, Gesicht
          oder PIN am Gerät. Er zählt als zweiter Faktor.
        </SettingsText>

        {list.isPending ? (
          <SettingsText muted>Wird geladen.</SettingsText>
        ) : list.isError ? (
          <SettingsText muted>Die Liste kam nicht an.</SettingsText>
        ) : entries.length === 0 ? (
          <SettingsText muted>Noch kein Passkey für dieses Konto.</SettingsText>
        ) : narrow ? (
          <ul aria-label="Deine Passkeys" className="flex flex-col gap-2">
            {entries.map((passkey) => (
              <li
                key={passkey.id}
                className="flex flex-col gap-2 rounded-[6px] border border-line bg-surface p-3"
              >
                {renaming?.id === passkey.id ? (
                  <RenameForm
                    value={renaming.name}
                    busy={rename.isPending}
                    onChange={(name) => {
                      setRenaming({ id: passkey.id, name })
                    }}
                    onSubmit={saveName}
                    onCancel={() => {
                      setRenaming(null)
                      setTrouble(null)
                    }}
                  />
                ) : (
                  <>
                    <span className="text-[16px] font-semibold [overflow-wrap:anywhere]">
                      {passkey.name}
                    </span>
                    <span className="text-[13px] text-ink-muted">
                      Hinzugefügt am {date(passkey.createdAt)} · Zuletzt benutzt:{' '}
                      {lastUsed(passkey.lastUsedAt)}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        icon={Pencil}
                        aria-label={`${passkey.name} umbenennen`}
                        onClick={() => {
                          startRenaming(passkey)
                        }}
                      >
                        Umbenennen
                      </Button>
                      <Button
                        tone="danger"
                        icon={Trash2}
                        aria-label={`${passkey.name} löschen`}
                        onClick={() => {
                          setTrouble(null)
                          setRemoving(passkey)
                        }}
                      >
                        Löschen
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div>
            <div
              aria-hidden="true"
              className="flex gap-3 pb-1.5 font-condensed text-[12px] font-semibold tracking-[0.8px] text-ink-faint uppercase"
            >
              <span className="grow">Passkey</span>
              <span className="w-[110px] shrink-0">Hinzugefügt</span>
              <span className="w-[130px] shrink-0">Zuletzt benutzt</span>
              <span className="w-[190px] shrink-0" />
            </div>
            <ul aria-label="Deine Passkeys" className="flex flex-col">
              {entries.map((passkey) => (
                <li key={passkey.id} className="flex items-center gap-3 border-t border-row py-2">
                  <span className="min-w-0 grow">
                    {renaming?.id === passkey.id ? (
                      <RenameForm
                        inline
                        value={renaming.name}
                        busy={rename.isPending}
                        onChange={(name) => {
                          setRenaming({ id: passkey.id, name })
                        }}
                        onSubmit={saveName}
                        onCancel={() => {
                          setRenaming(null)
                          setTrouble(null)
                        }}
                      />
                    ) : (
                      <span className="block text-[14px] font-medium [overflow-wrap:anywhere]">
                        {passkey.name}
                      </span>
                    )}
                  </span>
                  <span className="w-[110px] shrink-0 text-[13px] text-ink-muted">
                    <span className="sr-only">Hinzugefügt am </span>
                    {date(passkey.createdAt)}
                  </span>
                  <span className="w-[130px] shrink-0 text-[13px] text-ink-muted">
                    <span className="sr-only">Zuletzt benutzt: </span>
                    {lastUsed(passkey.lastUsedAt)}
                  </span>
                  <span className="flex w-[190px] shrink-0 justify-end gap-1.5">
                    {renaming?.id === passkey.id ? null : (
                      <>
                        <Button
                          size="small"
                          aria-label={`${passkey.name} umbenennen`}
                          onClick={() => {
                            startRenaming(passkey)
                          }}
                        >
                          Umbenennen
                        </Button>
                        <Button
                          size="small"
                          tone="danger"
                          aria-label={`${passkey.name} löschen`}
                          onClick={() => {
                            setTrouble(null)
                            setRemoving(passkey)
                          }}
                        >
                          Löschen
                        </Button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {trouble ? <Trouble>{trouble}</Trouble> : null}

        <p className="text-[12px] leading-[1.5] text-ink-muted">
          Das Passwort bleibt. Wer den letzten Passkey löscht, meldet sich weiter damit an.
        </p>

        {!supported ? (
          <SettingsText muted>Dieser Browser kann keinen Passkey anlegen.</SettingsText>
        ) : adding ? (
          <PasskeyAdding
            narrow={narrow}
            onDone={() => {
              setAdding(false)
              void queries.invalidateQueries({ queryKey: ['passkeys'] })
            }}
            onCancel={() => {
              setAdding(false)
            }}
          />
        ) : (
          <div>
            <Button
              icon={Plus}
              onClick={() => {
                setTrouble(null)
                setAdding(true)
              }}
            >
              Passkey hinzufügen
            </Button>
          </div>
        )}
      </div>

      <Confirm
        open={removing !== null}
        title="Passkey löschen?"
        confirm="Löschen"
        busy={remove.isPending}
        onConfirm={() => {
          if (removing) {
            remove.mutate(removing.id)
          }
        }}
        onCancel={() => {
          setRemoving(null)
        }}
      >
        {`„${removing?.name ?? ''}“ meldet danach nicht mehr an. Das Passwort bleibt, und ein neuer Passkey lässt sich jederzeit wieder hinzufügen.`}
      </Confirm>
    </Panel>
  )
}

/** The name of a passkey being changed, in its line or in its box. */
function RenameForm({
  value,
  busy,
  inline = false,
  onChange,
  onSubmit,
  onCancel,
}: {
  readonly value: string
  readonly busy: boolean
  readonly inline?: boolean
  readonly onChange: (name: string) => void
  readonly onSubmit: (event: FormEvent) => void
  readonly onCancel: () => void
}) {
  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className={inline ? 'flex flex-wrap items-center gap-2' : 'flex flex-col gap-2'}
    >
      <input
        type="text"
        aria-label="Neuer Name"
        maxLength={passkeyNameMaxLength}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className={
          inline
            ? 'h-[30px] w-[220px] rounded-[4px] border border-control bg-input px-[9px] text-[14px] text-ink'
            : 'h-control-lg min-h-tap w-full rounded-[4px] border border-control bg-input px-3 text-[16px] text-ink'
        }
      />
      <div className="flex gap-2">
        <Button type="submit" size={inline ? 'small' : 'normal'} disabled={busy}>
          Speichern
        </Button>
        <Button size={inline ? 'small' : 'normal'} onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </form>
  )
}

/**
 * Adding a passkey, the two steps of the boards "Einst-Passkey-Hinzufuegen"
 * and "Einst-Passkeys-390": first confirming again, then the name, and then
 * the browser's own question for fingerprint, face or PIN.
 *
 * The confirmation is the server's condition (#167) and holds ten minutes; a
 * name that takes longer sends somebody back to the first step with the
 * server's sentence.
 */
function PasskeyAdding({
  narrow,
  onDone,
  onCancel,
}: {
  readonly narrow: boolean
  readonly onDone: () => void
  readonly onCancel: () => void
}) {
  const account = useQuery(accountQuery)
  // The server asks for the code whenever the account has the app, and says so
  // when this screen did not know of it yet, set up in another tab perhaps.
  const [codeAsked, setCodeAsked] = useState(false)
  const withCode = account.data?.twoFactorEnabled === true || codeAsked
  const [step, setStep] = useState<'confirm' | 'name'>('confirm')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState(() => deviceName(globalThis.navigator.userAgent))
  const [tried, setTried] = useState(false)
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const problem = passkeyNameProblem(name) ?? undefined

  async function confirm(event: FormEvent) {
    event.preventDefault()
    setWorking(true)
    setTrouble(null)

    try {
      await reconfirm(password, withCode ? code : null)
      setPassword('')
      setCode('')
      setStep('name')
    } catch (error) {
      if (codeOf(error) === 'CODE_REQUIRED') {
        setCodeAsked(true)
        void account.refetch()
      }

      setTrouble(passkeyTrouble(error, 'Die Bestätigung kam nicht an. Bitte gleich noch einmal.'))
    } finally {
      setWorking(false)
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    setTrouble(null)

    if (problem) {
      return
    }

    setWorking(true)

    try {
      await addPasskey(name)
      onDone()
    } catch (error) {
      if (codeOf(error) === 'RECONFIRMATION_REQUIRED') {
        setStep('confirm')
      }

      setTrouble(passkeyTrouble(error, 'Der Passkey ließ sich nicht anlegen.'))
    } finally {
      setWorking(false)
    }
  }

  return (
    <section
      aria-label="Passkey hinzufügen"
      className="flex flex-col gap-2.5 rounded-[5px] border border-line bg-surface-sunken p-3"
    >
      <h3 className="font-condensed text-[12px] font-semibold tracking-[1.1px] text-ink-faint uppercase">
        Passkey hinzufügen
      </h3>

      {step === 'confirm' ? (
        <form
          className="flex flex-col gap-2.5"
          onSubmit={(event) => {
            void confirm(event)
          }}
        >
          <SettingsText muted>
            {withCode
              ? 'Zur Bestätigung dein Passwort und der Code aus der App, auch wenn du schon angemeldet bist.'
              : 'Zur Bestätigung dein Passwort, auch wenn du schon angemeldet bist.'}
          </SettingsText>
          <div
            className={withCode && !narrow ? 'grid gap-3 lg:grid-cols-2' : 'flex flex-col gap-3'}
          >
            <Field
              label="Passwort"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
              }}
            />
            {withCode ? (
              <Field
                label="Code aus der App"
                numeric
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123 456"
                maxLength={8}
                required
                value={code}
                onChange={(event) => {
                  setCode(event.target.value)
                }}
              />
            ) : null}
          </div>
          {trouble ? <Trouble>{trouble}</Trouble> : null}
          <div className="flex flex-wrap gap-2">
            <div className="grow" />
            <Button onClick={onCancel}>Abbrechen</Button>
            <Button type="submit" tone="primary" disabled={working}>
              {working ? 'Wird geprüft' : 'Weiter'}
            </Button>
          </div>
        </form>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-2.5"
          onSubmit={(event) => {
            void create(event)
          }}
        >
          <SettingsText muted>Bestätigt. Wie soll der Passkey in der Liste heißen?</SettingsText>
          <Field
            label="Name"
            maxLength={passkeyNameMaxLength}
            value={name}
            hint="Danach fragt der Browser nach Fingerabdruck, Gesicht oder PIN. Ohne diese Bestätigung am Gerät legt OpenGewerk keinen Passkey an."
            {...(tried && problem ? { problem } : {})}
            onChange={(event) => {
              setName(event.target.value)
            }}
          />
          {trouble ? <Trouble>{trouble}</Trouble> : null}
          <div className="flex flex-wrap gap-2">
            <div className="grow" />
            <Button onClick={onCancel}>Abbrechen</Button>
            <Button type="submit" tone="primary" icon={FingerprintPattern} disabled={working}>
              {working ? 'Einen Moment' : 'Passkey anlegen'}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
