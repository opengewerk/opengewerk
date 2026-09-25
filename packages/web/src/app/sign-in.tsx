import type { TenantId } from '@opengewerk/domain'
import clsx from 'clsx'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { Button, Field } from '../components/index.js'
import { RequestRefused } from '../sync/transport.js'
import type { Entry } from '../entry/entry.js'
import { Gate, GateText } from './gate.js'
import { roleLabel } from './labels.js'
import { SignOutButton } from './sign-out.js'
import {
  chooseTenant,
  recoveryCodesLeft,
  requestPasswordReset,
  signIn,
  verifyRecoveryCode,
  verifySecondFactor,
} from './../session/session.js'
import type { TenantChoice } from './../session/session.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/** A sentence that went wrong, in the gate. */
function GateTrouble({ children }: { readonly children: string }) {
  return (
    <p
      role="alert"
      className="text-[15px] leading-[1.5] font-semibold text-conflict lg:text-[14px]"
    >
      {children}
    </p>
  )
}

/**
 * Email and password, and nothing else on the screen, the board
 * "Tor-Anmelden": "Passwort vergessen?" beside the label of the password, and
 * under the button the sentence that says a code from the app may follow.
 *
 * No link to register, because there is no registering: an account is made on
 * the command line by somebody who already has one, which is the decision from
 * ADR 0006 and the reason a self hosted instance cannot be joined by whoever
 * finds it.
 */
export function SignInScreen({
  onSignedIn,
  onSecondFactor,
}: {
  readonly onSignedIn: () => void
  readonly onSecondFactor: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  const [asked, setAsked] = useState(false)

  /**
   * A link to a new password for the address in the field (#126). The answer
   * says the same whether there is an account or not, like the sign in.
   */
  async function forgotten() {
    setTrouble(null)

    if (!email.includes('@')) {
      setTrouble(
        'Zuerst oben die E-Mail-Adresse eintragen, für die ein neues Passwort kommen soll.',
      )

      return
    }

    setWorking(true)

    try {
      await requestPasswordReset(email)
      setAsked(true)
    } catch (error) {
      setTrouble(saidWhy(error, 'Der Link ließ sich gerade nicht anfordern.'))
    } finally {
      setWorking(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setWorking(true)
    setTrouble(null)

    try {
      const outcome = await signIn(email, password)

      if (outcome === 'second-factor') {
        onSecondFactor()
      } else {
        onSignedIn()
      }
    } catch (error) {
      // Deliberately the server's sentence and no guess of our own. It says
      // the same thing for a wrong password and an unknown address, which is
      // what keeps this from being a way of finding out who has an account.
      setTrouble(saidWhy(error, 'Die Anmeldung hat nicht geklappt.'))
    } finally {
      setWorking(false)
    }
  }

  return (
    <Gate title="Anmelden">
      <form
        className="flex flex-col gap-[15px]"
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <Field
          label="E-Mail"
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
          }}
        />
        <Field
          label="Passwort"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
          }}
          aside={
            asked ? null : (
              // A button, since it sends something, drawn as the link the
              // board has beside the label.
              <button
                type="button"
                disabled={working}
                onClick={() => {
                  void forgotten()
                }}
                className="cursor-pointer text-[13px] font-medium text-copper-text underline disabled:cursor-not-allowed disabled:text-disabled"
              >
                Passwort vergessen?
              </button>
            )
          }
        />

        {trouble ? <GateTrouble>{trouble}</GateTrouble> : null}

        <Button type="submit" tone="primary" wide disabled={working}>
          {working ? 'Einen Moment' : 'Anmelden'}
        </Button>

        {asked ? (
          <p role="status" className="text-[15px] leading-[1.5] text-ink lg:text-[14px]">
            Wenn es zu dieser Adresse einen Zugang gibt und ein Betrieb, in dem er arbeitet, E-Mails
            verschickt, ist ein Link zu einem neuen Passwort unterwegs. Er gilt eine Stunde. Kommt
            keiner an, hilft der Inhaber des Betriebs weiter.
          </p>
        ) : null}

        <p className="text-[15px] leading-[1.5] text-ink-muted lg:text-[13px]">
          Für die Rolle Inhaber ist der zweite Faktor Pflicht, für alle anderen empfohlen. Nach dem
          Passwort folgt dann der Code aus der App.
        </p>
      </form>
    </Gate>
  )
}

/**
 * The second factor, for the accounts that have to have one, the board
 * "Tor-Zweiter-Faktor": the code in a large field, at a desk as on a phone,
 * because it is read off another screen and typed digit by digit.
 *
 * With the code from the app, or with one of the recovery codes shown when the
 * factor was set up, for somebody whose phone is gone (#125). Afterwards the
 * screen says how many recovery codes are left, before it goes on: ten that
 * quietly became one are a way in that is about to close.
 */
export function SecondFactorScreen({ onVerified }: { readonly onVerified: () => void }) {
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [left, setLeft] = useState<number | null | undefined>(undefined)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setWorking(true)
    setTrouble(null)

    try {
      if (recovery) {
        await verifyRecoveryCode(code)
        // Signed in by now, so the count can be asked for. A count that does
        // not arrive is no reason to keep somebody out.
        setLeft(await recoveryCodesLeft().catch(() => null))
      } else {
        await verifySecondFactor(code)
        onVerified()
      }
    } catch (error) {
      setTrouble(saidWhy(error, 'Der Code stimmt nicht.'))
    } finally {
      setWorking(false)
    }
  }

  if (left !== undefined) {
    return (
      <Gate title="Wiederherstellungscode eingelöst">
        <GateText muted={false}>{codesLeftSentence(left)}</GateText>
        <Button tone="primary" wide onClick={onVerified}>
          Weiter
        </Button>
      </Gate>
    )
  }

  return (
    <Gate title="Zweiter Faktor">
      <form
        className="flex flex-col gap-[15px]"
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        {recovery ? (
          <Field
            label="Wiederherstellungscode"
            // Ten letters and digits with a hyphen in the middle, the way the
            // setup printed them. Room for the spaces a copied code brings
            // along, which are trimmed before it is sent.
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={20}
            required
            className="h-13! text-[17px]!"
            value={code}
            onChange={(event) => {
              setCode(event.target.value)
            }}
          />
        ) : (
          <Field
            label="Code aus der App"
            numeric
            inputMode="numeric"
            // `one-time-code` is what lets a phone offer the code from the
            // keyboard instead of making somebody switch apps and come back.
            autoComplete="one-time-code"
            maxLength={8}
            required
            className="h-13! text-[17px]!"
            value={code}
            onChange={(event) => {
              setCode(event.target.value)
            }}
          />
        )}

        {trouble ? <GateTrouble>{trouble}</GateTrouble> : null}

        <Button type="submit" tone="primary" wide disabled={working}>
          {working ? 'Wird geprüft' : 'Weiter'}
        </Button>

        <Button
          tone="quiet"
          onClick={() => {
            setRecovery(!recovery)
            setCode('')
            setTrouble(null)
          }}
        >
          {recovery
            ? 'Code aus der App verwenden'
            : 'Telefon nicht zur Hand? Wiederherstellungscode'}
        </Button>
      </form>
    </Gate>
  )
}

/** What is left after a recovery code, and where to get new ones. */
function codesLeftSentence(left: number | null): string {
  const counted =
    left === null
      ? 'Der Code ist eingelöst und gilt kein zweites Mal.'
      : left === 1
        ? 'Der Code ist eingelöst. Es ist noch ein Wiederherstellungscode übrig.'
        : 'Der Code ist eingelöst. Es sind noch ' + String(left) + ' Wiederherstellungscodes übrig.'

  return (
    counted +
    ' Unter "Konto" im Büro lassen sich neue erzeugen und der zweite Faktor auf einem neuen Telefon einrichten.'
  )
}

/**
 * Which business this session works in, the board "Tor-Betrieb": one box
 * each, side by side while they fit, with the roles in small capitals.
 *
 * Asked before anything is read and not afterwards. A session without a
 * business would have to be told which one by every request, and then the
 * answer comes from the caller instead of from the session; row level security
 * would then isolate that business perfectly, for whoever asked.
 *
 * On the site entry the device identity goes along, which is what makes the
 * session a long one. At a desk it does not, and the session runs out after
 * twelve hours, because a desk is a thing people walk away from.
 */
export function TenantScreen({
  entry,
  deviceId,
  tenants,
  onChosen,
  onSignedOut,
}: {
  readonly entry: Entry
  readonly deviceId: string
  readonly tenants: readonly TenantChoice[]
  readonly onChosen: () => void
  readonly onSignedOut: () => void
}) {
  const [working, setWorking] = useState<TenantId | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function choose(tenant: TenantChoice) {
    setWorking(tenant.id)
    setTrouble(null)

    try {
      await chooseTenant(tenant.id, entry === 'site' ? deviceId : undefined)
      onChosen()
    } catch (error) {
      setTrouble(saidWhy(error, 'Der Betrieb ließ sich nicht auswählen.'))
      setWorking(null)
    }
  }

  if (tenants.length === 0) {
    return (
      <Gate title="Kein Betrieb">
        <GateText muted={false}>
          Dieses Konto gehört zu keinem Betrieb. Wer die Instanz betreibt, legt die Zugehörigkeit
          an.
        </GateText>
        <SignOutButton client={null} onSignedOut={onSignedOut} wide />
      </Gate>
    )
  }

  return (
    <Gate title="Betrieb wählen" width={640}>
      <ul className="flex flex-wrap gap-2.5">
        {tenants.map((tenant) => (
          <li key={tenant.id} className="flex min-w-[12rem] grow basis-0">
            <button
              type="button"
              disabled={working !== null}
              onClick={() => {
                void choose(tenant)
              }}
              className={clsx(
                'flex w-full cursor-pointer flex-col items-start gap-[3px] rounded-[5px] px-3.5 py-3 text-left text-ink hover:border-ink disabled:cursor-not-allowed',
                // The one being opened, as the board marks the chosen one.
                working === tenant.id
                  ? 'border-[1.5px] border-ink bg-input'
                  : 'border border-line bg-surface',
              )}
            >
              <span className="text-[16px] font-semibold">{tenant.name}</span>
              <span className="font-condensed text-[13px] font-semibold tracking-[0.8px] text-ink-faint uppercase">
                {tenant.roles.map((role) => roleLabel[role]).join(', ')}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {trouble ? <GateTrouble>{trouble}</GateTrouble> : null}
    </Gate>
  )
}
