import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { Button, Card, Cell, Column, Field, Table } from '../../components/index.js'
import { moment } from '../../app/format.js'
import { accountQuery } from '../../app/queries.js'
import { SecondFactorSetup } from '../../app/setup.js'
import {
  changePassword,
  devices,
  newRecoveryCodes,
  recoveryCodesLeft,
  revokeDevice,
  shortestPassword,
  signOut,
} from '../../session/session.js'
import { RequestRefused } from '../../sync/transport.js'
import { Nothing, Page, Section } from '../layout.js'

/**
 * What somebody can look after about their own account: the second factor and
 * the devices they are signed in on.
 *
 * One screen and not two, because both answer the same question: who can get
 * in as me, and how do I stop them. The device list is what makes the long
 * session of ADR 0006 bearable, a phone on a registered device stays signed in
 * for thirty days, which is right for somebody in a cellar and wrong for a
 * phone left in a van that was broken into.
 */
export function AccountScreen() {
  const queries = useQueryClient()
  const account = useQuery(accountQuery)
  const list = useQuery({ queryKey: ['devices'], queryFn: devices })
  const [trouble, setTrouble] = useState<string | null>(null)
  const [setting, setSetting] = useState(false)

  const revoke = useMutation({
    mutationFn: revokeDevice,
    onSuccess: () => {
      void queries.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: () => {
      setTrouble('Das Gerät ließ sich nicht abmelden.')
    },
  })

  return (
    <Page
      title="Konto"
      meta={account.data ? `${account.data.name}, ${account.data.email}` : 'Dieses Konto.'}
      actions={
        <Button
          tone="secondary"
          onClick={() => {
            // Reloading afterwards rather than routing: signing out has to end
            // with the sync client stopped and the local store closed, and the
            // shortest honest way to be sure of that is to start again.
            void signOut().finally(() => {
              globalThis.location.assign('/')
            })
          }}
        >
          Abmelden
        </Button>
      }
    >
      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <Section title="Zweiter Faktor">
        {account.data?.twoFactorEnabled ? (
          <div className="flex flex-col gap-4">
            <p className="text-body">
              Eingerichtet. Bei jeder Anmeldung fragt OpenGewerk zusätzlich nach dem Code aus der
              App.
            </p>
            <RecoveryCodes />
          </div>
        ) : setting ? (
          <SecondFactorSetup
            onDone={() => {
              setSetting(false)
              // The confirmation swaps the session, so what the application
              // knows about the account and about the devices is both a step
              // behind.
              void queries.invalidateQueries({ queryKey: ['account'] })
              void queries.invalidateQueries({ queryKey: ['devices'] })
            }}
            onCancel={() => {
              setSetting(false)
            }}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-body">
              Noch nicht eingerichtet. Ein zweiter Faktor macht ein gestohlenes Passwort allein
              nutzlos. Für die Rolle Inhaber ist er Pflicht, für alle anderen empfohlen.
            </p>
            <div>
              <Button
                tone="primary"
                onClick={() => {
                  setSetting(true)
                }}
              >
                Zweiten Faktor einrichten
              </Button>
            </div>
          </div>
        )}
      </Section>

      <Section title="Passwort">
        <PasswordChange
          onChanged={() => {
            // The other devices are signed out, so the list is a step behind.
            void queries.invalidateQueries({ queryKey: ['devices'] })
          }}
        />
      </Section>

      <Section title="Angemeldete Geräte">
        {list.isPending ? (
          <Nothing>Wird geladen.</Nothing>
        ) : list.isError ? (
          <Nothing>Die Liste kam nicht an.</Nothing>
        ) : list.data.length === 0 ? (
          <Nothing>Keine Anmeldung außer dieser.</Nothing>
        ) : (
          <Table caption="Geräte, auf denen dieses Konto angemeldet ist">
            <thead>
              <tr>
                <Column>Gerät</Column>
                <Column>Angemeldet</Column>
                <Column>Läuft ab</Column>
                <Column>Art</Column>
                <Column>
                  <span className="sr-only">Abmelden</span>
                </Column>
              </tr>
            </thead>
            <tbody>
              {list.data.map((entry) => (
                <tr key={entry.sessionId}>
                  <Cell>
                    {entry.userAgent ?? 'Unbekanntes Gerät'}
                    {entry.current ? (
                      <span className="ml-2 font-semibold text-copper-text">dieses Gerät</span>
                    ) : null}
                  </Cell>
                  <Cell>{moment(entry.signedInAt)}</Cell>
                  <Cell>{moment(entry.expiresAt)}</Cell>
                  <Cell>{entry.longLived ? 'Baustelle, 30 Tage' : 'Büro, 12 Stunden'}</Cell>
                  <Cell>
                    <Button
                      tone="danger"
                      disabled={entry.current || revoke.isPending}
                      onClick={() => {
                        setTrouble(null)
                        revoke.mutate(entry.sessionId)
                      }}
                    >
                      Abmelden
                    </Button>
                  </Cell>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </Page>
  )
}

/**
 * The recovery codes of this account: how many are left, and a new set (#125).
 *
 * The count and not the codes. They were shown once, when they were made, and
 * a screen that showed them again would turn a session left open at a desk
 * into a way past the second factor for good. A new set asks for the password
 * for the same reason, and replaces the old one entirely.
 */
function RecoveryCodes() {
  const queries = useQueryClient()
  const left = useQuery({ queryKey: ['recovery-codes'], queryFn: recoveryCodesLeft })
  const [asking, setAsking] = useState(false)
  const [password, setPassword] = useState('')
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [fresh, setFresh] = useState<readonly string[] | null>(null)

  async function make(event: FormEvent) {
    event.preventDefault()
    setWorking(true)
    setTrouble(null)

    try {
      setFresh(await newRecoveryCodes(password))
      setAsking(false)
      setPassword('')
      void queries.invalidateQueries({ queryKey: ['recovery-codes'] })
    } catch (error) {
      setTrouble(
        error instanceof RequestRefused ? error.message : 'Es kamen keine neuen Codes zurück.',
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <Card label="Wiederherstellungscodes" tone="sunken">
      <div className="flex flex-col gap-3">
        <p className="text-body">
          {left.data === undefined || left.data === null
            ? 'Die Codes sind der Weg hinein, wenn das Telefon weg ist. Jeder gilt einmal.'
            : left.data === 1
              ? 'Noch ein Code übrig. Die Codes sind der Weg hinein, wenn das Telefon weg ist.'
              : 'Noch ' +
                String(left.data) +
                ' Codes übrig. Die Codes sind der Weg hinein, wenn das Telefon weg ist.'}
        </p>

        {fresh ? (
          <div className="flex flex-col gap-2">
            <p className="text-body font-semibold">
              Die neuen Codes. Jetzt ausdrucken oder aufschreiben, danach sind sie nicht mehr zu
              sehen; die alten gelten nicht mehr.
            </p>
            <ul className="grid grid-cols-2 gap-2">
              {fresh.map((code) => (
                <li key={code} className="text-body font-condensed tracking-wider numeric">
                  {code}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {asking ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              void make(event)
            }}
          >
            <Field
              label="Passwort zur Bestätigung"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
              }}
            />
            {trouble ? (
              <p role="alert" className="text-body font-semibold text-conflict">
                {trouble}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" tone="primary" disabled={working}>
                {working ? 'Wird erzeugt' : 'Neue Codes erzeugen'}
              </Button>
              <Button
                tone="quiet"
                onClick={() => {
                  setAsking(false)
                  setPassword('')
                  setTrouble(null)
                }}
              >
                Abbrechen
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button
              tone="secondary"
              onClick={() => {
                setAsking(true)
              }}
            >
              Neue Wiederherstellungscodes
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}

/**
 * A new password with the old one as confirmation (#126). A password that
 * somebody else chose on the command line, or one somebody else has seen, is
 * replaced here; every other device of the account is signed out with it.
 */
function PasswordChange({ onChanged }: { readonly onChanged: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeated, setRepeated] = useState('')
  const [working, setWorking] = useState(false)
  const [said, setSaid] = useState<{ readonly ok: boolean; readonly text: string } | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaid(null)

    if (next.length < shortestPassword) {
      setSaid({
        ok: false,
        text: `Das neue Passwort braucht mindestens ${String(shortestPassword)} Zeichen.`,
      })

      return
    }

    if (next !== repeated) {
      setSaid({ ok: false, text: 'Die beiden neuen Passwörter sind nicht gleich.' })

      return
    }

    setWorking(true)

    try {
      await changePassword(current, next)
      setCurrent('')
      setNext('')
      setRepeated('')
      setSaid({ ok: true, text: 'Geändert. Alle anderen Geräte dieses Zugangs sind abgemeldet.' })
      onChanged()
    } catch (error) {
      setSaid({
        ok: false,
        text:
          error instanceof RequestRefused
            ? 'Das Passwort wurde nicht geändert. Stimmt das bisherige?'
            : 'Die Änderung kam nicht an. Bitte gleich noch einmal.',
      })
    } finally {
      setWorking(false)
    }
  }

  return (
    <form
      className="flex max-w-md flex-col gap-3"
      onSubmit={(event) => {
        void submit(event)
      }}
    >
      <Field
        label="Bisheriges Passwort"
        type="password"
        autoComplete="current-password"
        required
        value={current}
        onChange={(event) => {
          setCurrent(event.target.value)
        }}
      />
      <Field
        label="Neues Passwort"
        type="password"
        autoComplete="new-password"
        required
        value={next}
        onChange={(event) => {
          setNext(event.target.value)
        }}
      />
      <Field
        label="Neues Passwort wiederholen"
        type="password"
        autoComplete="new-password"
        required
        value={repeated}
        onChange={(event) => {
          setRepeated(event.target.value)
        }}
      />
      {said ? (
        <p
          role={said.ok ? 'status' : 'alert'}
          className={said.ok ? 'text-body' : 'text-body font-semibold text-conflict'}
        >
          {said.text}
        </p>
      ) : null}
      <div>
        <Button type="submit" tone="primary" disabled={working}>
          {working ? 'Wird geändert' : 'Passwort ändern'}
        </Button>
      </div>
    </form>
  )
}
