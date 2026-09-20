import type { TenantId } from '@opengewerk/domain'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { Button, Card, Field, FieldLabel } from '../components/index.js'
import { RequestRefused } from '../sync/transport.js'
import type { Entry } from '../entry/entry.js'
import { roleLabel } from './labels.js'
import { chooseTenant, signIn, verifySecondFactor } from './../session/session.js'
import type { TenantChoice } from './../session/session.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/**
 * The frame every step before working shares: the mark, one card, one action.
 *
 * `<main>` and an `<h1>`, because this is the first thing a screen reader
 * meets and an application that starts with an unlabelled div starts badly.
 */
function Gate({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <main className="min-h-dvh flex items-center justify-center p-4">
      <div className="w-full max-w-md flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <FieldLabel>OpenGewerk</FieldLabel>
          <h1 className="text-title font-semibold">{title}</h1>
        </div>
        <Card label={title}>{children}</Card>
      </div>
    </main>
  )
}

/**
 * Email and password, and nothing else on the screen.
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
        className="flex flex-col gap-4"
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
        />

        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}

        <Button type="submit" tone="primary" wide disabled={working}>
          {working ? 'Einen Moment' : 'Anmelden'}
        </Button>
      </form>
    </Gate>
  )
}

/** The second factor, for the accounts that have to have one. */
export function SecondFactorScreen({ onVerified }: { readonly onVerified: () => void }) {
  const [code, setCode] = useState('')
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setWorking(true)
    setTrouble(null)

    try {
      await verifySecondFactor(code)
      onVerified()
    } catch (error) {
      setTrouble(saidWhy(error, 'Der Code stimmt nicht.'))
    } finally {
      setWorking(false)
    }
  }

  return (
    <Gate title="Zweiter Faktor">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <Field
          label="Code aus der App"
          numeric
          inputMode="numeric"
          // `one-time-code` is what lets a phone offer the code from the
          // keyboard instead of making somebody switch apps and come back.
          autoComplete="one-time-code"
          maxLength={8}
          required
          value={code}
          onChange={(event) => {
            setCode(event.target.value)
          }}
        />

        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}

        <Button type="submit" tone="primary" wide disabled={working}>
          {working ? 'Wird geprüft' : 'Weiter'}
        </Button>
      </form>
    </Gate>
  )
}

/**
 * Which business this session works in.
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
  onSignOut,
}: {
  readonly entry: Entry
  readonly deviceId: string
  readonly tenants: readonly TenantChoice[]
  readonly onChosen: () => void
  readonly onSignOut: () => void
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
        <p className="text-body">
          Dieses Konto gehört zu keinem Betrieb. Wer die Instanz betreibt, legt die Zugehörigkeit
          an.
        </p>
        <Button className="mt-4" tone="secondary" wide onClick={onSignOut}>
          Abmelden
        </Button>
      </Gate>
    )
  }

  return (
    <Gate title="Betrieb wählen">
      <ul className="flex flex-col gap-3">
        {tenants.map((tenant) => (
          <li key={tenant.id}>
            <Button
              tone="secondary"
              wide
              className="justify-between"
              disabled={working !== null}
              onClick={() => {
                void choose(tenant)
              }}
            >
              <span>{tenant.name}</span>
              <span className="font-condensed text-label uppercase tracking-wider text-ink-muted">
                {tenant.roles.map((role) => roleLabel[role]).join(', ')}
              </span>
            </Button>
          </li>
        ))}
      </ul>

      {trouble ? (
        <p role="alert" className="mt-4 text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
    </Gate>
  )
}

export { Gate }
