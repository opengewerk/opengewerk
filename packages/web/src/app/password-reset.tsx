import { useState } from 'react'
import type { FormEvent } from 'react'

import { Button, Field } from '../components/index.js'
import { RequestRefused } from '../sync/transport.js'
import { resetPassword, shortestPassword } from './../session/session.js'
import { Gate, GateText } from './gate.js'

/**
 * The far end of the link in the mail, for somebody who forgot their
 * password (#126).
 *
 * In the gate and recognised by its path, like the invitation, because the
 * person holding the link is exactly the one who cannot sign in. Afterwards
 * every device of the account is signed out, this one included, and the way
 * on is the ordinary sign in with the new password and, where one is set up,
 * the second factor.
 */
export function PasswordResetScreen({ token }: { readonly token: string }) {
  const [password, setPassword] = useState('')
  const [repeated, setRepeated] = useState('')
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTrouble(null)

    if (password.length < shortestPassword) {
      setTrouble(`Das Passwort braucht mindestens ${String(shortestPassword)} Zeichen.`)

      return
    }

    if (password !== repeated) {
      setTrouble('Die beiden Passwörter sind nicht gleich.')

      return
    }

    setWorking(true)

    try {
      await resetPassword(token, password)
      setDone(true)
    } catch (error) {
      setTrouble(
        error instanceof RequestRefused && error.status < 500
          ? 'Der Link gilt nicht mehr: er war schon benutzt oder ist älter als eine Stunde. ' +
              'Auf der Anmeldung lässt sich ein neuer anfordern.'
          : 'Das neue Passwort kam nicht an. Bitte gleich noch einmal.',
      )
    } finally {
      setWorking(false)
    }
  }

  if (done) {
    return (
      <Gate title="Passwort gesetzt">
        <GateText muted={false}>
          Das neue Passwort gilt ab sofort, und alle Geräte dieses Zugangs sind abgemeldet. Jetzt
          mit ihm anmelden.
        </GateText>
        <Button
          tone="primary"
          wide
          onClick={() => {
            // Out of the address with the token, which has done its work.
            globalThis.location.assign('/')
          }}
        >
          Zur Anmeldung
        </Button>
      </Gate>
    )
  }

  return (
    <Gate title="Passwort neu setzen">
      <form
        className="flex flex-col gap-[15px]"
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <Field
          label="Neues Passwort"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
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

        {trouble ? (
          <p
            role="alert"
            className="text-[15px] leading-[1.5] font-semibold text-conflict lg:text-[14px]"
          >
            {trouble}
          </p>
        ) : null}

        <Button type="submit" tone="primary" wide disabled={working}>
          {working ? 'Einen Moment' : 'Passwort setzen'}
        </Button>
      </form>
    </Gate>
  )
}
