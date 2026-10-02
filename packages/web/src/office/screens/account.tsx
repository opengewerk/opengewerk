import { businessNameMaxLength, businessNameProblem, type TenantId } from '@opengewerk/domain'
import {
  Button,
  Cell,
  Column,
  Confirm,
  Field,
  Panel,
  TablePanel,
  ThemeSwitch,
  useTheme,
} from '@opengewerk/platform-web'
import type { TableCard } from '@opengewerk/platform-web'
import { moment } from '@opengewerk/platform-web/format'
import { SecondFactorSetup, SignOutButton } from '@opengewerk/platform-web/gate'
import {
  PageHead,
  Saved,
  Screen,
  SettingsText,
  switchTenant,
  useTenants,
} from '@opengewerk/platform-web/office'
import {
  accountQuery,
  changePassword,
  deviceName,
  devices,
  newRecoveryCodes,
  recoveryCodesLeft,
  revokeDevice,
  rolesInWords,
  shortestPassword,
} from '@opengewerk/platform-web/session'
import { RequestRefused, useSync } from '@opengewerk/platform-web/sync'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Key, Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import { useMay } from '../../app/queries.js'
import { createOwnTenant } from '../../session/instance.js'
import { PasskeysPanel } from './account-passkeys.js'
import { PushPanel } from './account-push.js'

/**
 * What somebody can look after about their own account: the second factor,
 * the passkeys (#167, #248) and the devices they are signed in on.
 *
 * One screen and not two, because both answer the same question: who can get
 * in as me, and how do I stop them. The device list is what makes the long
 * session of ADR 0006 bearable, a phone on a registered device stays signed in
 * for thirty days, which is right for somebody in a cellar and wrong for a
 * phone left in a van that was broken into.
 */
export function AccountScreen() {
  const client = useSync()
  const queries = useQueryClient()
  const account = useQuery(accountQuery)
  const list = useQuery({ queryKey: ['devices'], queryFn: devices })
  const [trouble, setTrouble] = useState<string | null>(null)
  const [setting, setSetting] = useState(false)
  const [theme, chooseTheme] = useTheme()

  // Signing another device out asks first (#222).
  const [signingOut, setSigningOut] = useState<{ sessionId: string; label: string } | null>(null)
  const revoke = useMutation({
    mutationFn: revokeDevice,
    onSuccess: () => {
      setSigningOut(null)
      void queries.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: () => {
      setSigningOut(null)
      setTrouble('Das Gerät ließ sich nicht abmelden.')
    },
  })

  function signOutButton(sessionId: string, label: string, current: boolean): ReactNode {
    return (
      <Button
        size="small"
        tone="danger"
        aria-label={`${label} abmelden`}
        disabled={current || revoke.isPending}
        onClick={() => {
          setTrouble(null)
          setSigningOut({ sessionId, label })
        }}
      >
        Abmelden
      </Button>
    )
  }

  const cards: readonly TableCard[] = (list.data ?? []).map((entry) => ({
    key: entry.sessionId,
    title: <DeviceName userAgent={entry.userAgent} current={entry.current} />,
    sub: `${moment(entry.signedInAt)} bis ${moment(entry.expiresAt)}`,
    right: entry.longLived ? 'Baustelle, 30 Tage' : 'Büro, 12 Stunden',
    actions: signOutButton(entry.sessionId, deviceName(entry.userAgent), entry.current),
  }))

  return (
    <Screen>
      <PageHead
        title="Konto"
        sub={account.data ? `${account.data.name}, ${account.data.email}` : 'Dieses Konto.'}
        actions={
          <SignOutButton
            client={client}
            icon
            onSignedOut={() => {
              // Reloading afterwards rather than routing: signing out ends with
              // the sync client stopped and the local store gone, and the
              // shortest honest way to be sure of that is to start again.
              globalThis.location.assign('/')
            }}
          />
        }
      />

      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <div className="grid gap-3.5 lg:grid-cols-2">
        <Panel title="Darstellung" roomy>
          <div className="flex flex-col gap-2.5">
            <SettingsText muted>
              Wie OpenGewerk auf diesem Gerät aussieht. Hell ist der Standard, auf jedem neuen Gerät
              und vor der Anmeldung.
            </SettingsText>
            <ThemeSwitch value={theme} onChoose={chooseTheme} className="max-w-[280px]" />
            <p className="text-[12px] leading-[1.5] text-ink-muted">
              Gilt auf diesem Gerät, auch ohne Netz. Auf dem Tablet im Keller lässt sich unabhängig
              davon dunkel wählen.
            </p>
          </div>
        </Panel>

        <Panel title="Zweiter Faktor" roomy>
          {account.isPending ? (
            // Not "Noch nicht eingerichtet" while the answer is on its way: for
            // a moment that told everybody with a second factor they had none
            // (#223).
            <SettingsText muted>Wird geladen.</SettingsText>
          ) : account.data?.twoFactorEnabled ? (
            <div className="flex flex-col gap-2.5">
              <SettingsText>
                Eingerichtet. Bei jeder Anmeldung fragt OpenGewerk zusätzlich nach dem Code aus der
                App.
              </SettingsText>
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
            <div className="flex flex-col gap-2.5">
              <SettingsText>
                Noch nicht eingerichtet. Ein zweiter Faktor macht ein gestohlenes Passwort allein
                nutzlos. Für die Rolle Inhaber ist er Pflicht, für alle anderen empfohlen.
              </SettingsText>
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
        </Panel>
      </div>

      <PasskeysPanel />

      <BusinessesPanel />

      <PushPanel />

      <Panel title="Passwort" roomy>
        <PasswordChange
          onChanged={() => {
            // The other devices are signed out, so the list is a step behind.
            void queries.invalidateQueries({ queryKey: ['devices'] })
          }}
        />
      </Panel>

      {list.isPending || list.isError || list.data.length === 0 ? (
        <Panel title="Angemeldete Geräte">
          <SettingsText muted>
            {list.isPending
              ? 'Wird geladen.'
              : list.isError
                ? 'Die Liste kam nicht an.'
                : 'Keine Anmeldung außer dieser.'}
          </SettingsText>
        </Panel>
      ) : (
        <TablePanel
          title="Angemeldete Geräte"
          caption="Geräte, auf denen dieses Konto angemeldet ist"
          cards={cards}
        >
          <thead>
            <tr>
              <Column>Gerät</Column>
              <Column className="w-[150px]">Angemeldet</Column>
              <Column className="w-[150px]">Läuft ab</Column>
              <Column className="w-[140px]">Art</Column>
              <Column numeric className="w-[110px]">
                <span className="sr-only">Abmelden</span>
              </Column>
            </tr>
          </thead>
          <tbody>
            {list.data.map((entry) => (
              <tr key={entry.sessionId}>
                <Cell>
                  <DeviceName userAgent={entry.userAgent} current={entry.current} />
                </Cell>
                <Cell className="text-[13px]">{moment(entry.signedInAt)}</Cell>
                <Cell className="text-[13px]">{moment(entry.expiresAt)}</Cell>
                <Cell className="text-[13px]">
                  {entry.longLived ? 'Baustelle, 30 Tage' : 'Büro, 12 Stunden'}
                </Cell>
                <Cell numeric>
                  {signOutButton(entry.sessionId, deviceName(entry.userAgent), entry.current)}
                </Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
      <Confirm
        open={signingOut !== null}
        title="Gerät abmelden?"
        confirm="Abmelden"
        busy={revoke.isPending}
        onConfirm={() => {
          if (signingOut) {
            revoke.mutate(signingOut.sessionId)
          }
        }}
        onCancel={() => {
          setSigningOut(null)
        }}
      >
        {`${signingOut?.label ?? ''} muss sich danach neu anmelden. Was dort noch nicht übertragen ist, bleibt auf dem Gerät und geht nach der nächsten Anmeldung hinaus.`}
      </Confirm>
    </Screen>
  )
}

/** The device a session runs on, and "dieses Gerät" for the one looking. */
function DeviceName({
  userAgent,
  current,
}: {
  readonly userAgent: string | null
  readonly current: boolean
}) {
  return (
    <>
      {deviceName(userAgent)}
      {current ? (
        <span className="ml-1.5 text-[12px] font-bold text-copper-text">dieses Gerät</span>
      ) : null}
    </>
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
    <section
      aria-label="Wiederherstellungscodes"
      className="flex flex-col gap-2.5 rounded-[5px] border border-line bg-surface-sunken px-3 py-2.5"
    >
      <h3 className="font-condensed text-[12px] font-semibold tracking-[1.1px] text-ink-faint uppercase">
        Wiederherstellungscodes
      </h3>
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 grow basis-48 text-[13px] leading-[1.45]">
          {left.data === undefined || left.data === null
            ? 'Die Codes sind der Weg hinein, wenn das Telefon weg ist. Jeder gilt einmal.'
            : left.data === 0
              ? 'Kein Code mehr übrig. Ist das Telefon weg, geht die Anmeldung dann nicht mehr; am besten jetzt neue Codes erzeugen.'
              : left.data === 1
                ? 'Noch ein Code übrig. Die Codes sind der Weg hinein, wenn das Telefon weg ist.'
                : 'Noch ' +
                  String(left.data) +
                  ' Codes übrig. Die Codes sind der Weg hinein, wenn das Telefon weg ist.'}
        </span>
        {asking ? null : (
          <Button
            size="small"
            icon={Key}
            onClick={() => {
              setAsking(true)
            }}
          >
            Neue Codes erzeugen
          </Button>
        )}
      </div>

      {fresh ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] leading-[1.45] font-semibold">
            Die neuen Codes. Jetzt ausdrucken oder aufschreiben, danach sind sie nicht mehr zu
            sehen; die alten gelten nicht mehr.
          </p>
          <ul className="grid grid-cols-2 gap-2">
            {fresh.map((code) => (
              <li key={code} className="numeric font-condensed text-[15px] tracking-wider">
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
            className="sm:max-w-[280px]"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
            }}
          />
          {trouble ? (
            <p role="alert" className="text-[13px] font-semibold text-conflict">
              {trouble}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" tone="primary" icon={Key} disabled={working}>
              {working ? 'Wird erzeugt' : 'Neue Codes erzeugen'}
            </Button>
            <Button
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
      ) : null}
    </section>
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
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        void submit(event)
      }}
    >
      <div className="grid gap-3 lg:grid-cols-3">
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
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={working}>
          {working ? 'Wird geändert' : 'Passwort ändern'}
        </Button>
        {said?.ok ? <Saved>{said.text}</Saved> : null}
        {said && !said.ok ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {said.text}
          </p>
        ) : null}
      </div>
    </form>
  )
}

/**
 * The businesses of this person (#142, #242), `betriebe_card()` of the
 * canvas: each with the roles in it, the one worked in marked, the others one
 * click away without signing in again. An owner creates a further one here and
 * is its owner at once, with the second factor already set up; it starts
 * empty, as after the first run.
 */
function BusinessesPanel() {
  const client = useSync()
  const queries = useQueryClient()
  const mayCreate = useMay('tenant.create')
  const { list, current } = useTenants()
  const [switching, setSwitching] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [tried, setTried] = useState(false)
  const [made, setMade] = useState<{ tenantId: TenantId; name: string } | null>(null)
  const problem = businessNameProblem(name) ?? undefined

  const create = useMutation({
    mutationFn: createOwnTenant,
    onSuccess: (answer) => {
      setName('')
      setTried(false)
      setMade({ tenantId: answer.tenantId, name: answer.name })
      void queries.invalidateQueries({ queryKey: ['tenants'] })
    },
    onError: (error) => {
      setTrouble(
        error instanceof RequestRefused ? error.message : 'Der Betrieb ließ sich nicht anlegen.',
      )
    },
  })

  function switchTo(tenantId: TenantId) {
    setTrouble(null)
    setSwitching(tenantId)
    switchTenant(client, tenantId).catch(() => {
      setSwitching(null)
      setTrouble('Der Wechsel ging nicht. Ist der Server erreichbar?')
    })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    setTrouble(null)
    setMade(null)

    if (problem) {
      return
    }

    create.mutate(name)
  }

  return (
    <Panel title="Betriebe" roomy>
      <div id="betriebe" className="flex scroll-mt-20 flex-col gap-2.5">
        <SettingsText muted>
          Die Betriebe, in denen du arbeitest. Gewechselt wird ohne neue Anmeldung.
        </SettingsText>
        <ul aria-label="Deine Betriebe" className="flex flex-col">
          {list.map((tenant) => (
            <li key={tenant.id} className="flex items-center gap-2.5 border-t border-row py-2">
              <span className="min-w-0 grow">
                <span className="block text-[14px] font-medium [overflow-wrap:anywhere]">
                  {tenant.name}
                </span>
                <span className="block text-[12px] text-ink-faint">
                  {rolesInWords(tenant.roleLabels)}
                </span>
              </span>
              {tenant.id === current ? (
                <span className="text-[13px] text-ink-faint">Dieser Betrieb</span>
              ) : (
                <Button
                  size="small"
                  aria-label={`Zu ${tenant.name} wechseln`}
                  disabled={switching !== null}
                  onClick={() => {
                    switchTo(tenant.id)
                  }}
                >
                  Wechseln
                </Button>
              )}
            </li>
          ))}
        </ul>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        {made ? (
          <div className="flex flex-wrap items-center gap-2.5 rounded-[5px] border border-done-edge bg-done-fill px-3 py-2.5">
            <p role="status" className="grow text-[14px] text-done">
              <strong>{made.name}</strong> ist angelegt. Du bist dort Inhaber.
            </p>
            <Button
              size="small"
              disabled={switching !== null}
              onClick={() => {
                switchTo(made.tenantId)
              }}
            >
              Jetzt wechseln
            </Button>
          </div>
        ) : null}
        {mayCreate ? (
          <form
            noValidate
            onSubmit={submit}
            className="flex flex-col gap-2.5 rounded-[5px] border border-line bg-surface-sunken p-3"
          >
            <div className="font-condensed text-label font-semibold uppercase tracking-[1.1px] text-ink-faint">
              Weiterer Betrieb
            </div>
            <Field
              label="Name des Betriebs"
              value={name}
              maxLength={businessNameMaxLength}
              placeholder="etwa Kohm Elektromobilität GmbH"
              hint="Du bist dort Inhaber, mit deinem zweiten Faktor. Der Betrieb startet leer wie nach der Ersteinrichtung: Briefkopf, Steuern und Nummernkreise richtest du dort ein."
              {...(tried && problem ? { problem } : {})}
              onChange={(event) => {
                setName(event.target.value)
              }}
            />
            <div className="flex flex-wrap gap-2">
              <div className="grow" />
              <Button
                disabled={name === ''}
                onClick={() => {
                  setName('')
                  setTried(false)
                }}
              >
                Abbrechen
              </Button>
              <Button tone="primary" type="submit" icon={Plus} disabled={create.isPending}>
                Betrieb anlegen
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </Panel>
  )
}
