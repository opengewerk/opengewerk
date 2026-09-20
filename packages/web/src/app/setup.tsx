import { useState } from 'react'
import type { FormEvent } from 'react'
import { encode } from 'uqr'

import { Button, Card, Field, FieldLabel } from '../components/index.js'
import { RequestRefused } from '../sync/transport.js'
import { Gate } from './sign-in.js'
import {
  runSetup,
  secretFrom,
  shortestPassword,
  signIn,
  startSecondFactor,
  verifySecondFactor,
} from './../session/session.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/**
 * The first screen a freshly installed instance shows: the business, the
 * person who owns it, and a password they choose themselves.
 *
 * It replaces the sign in screen while there is nothing on the instance, and
 * it is gone the moment there is. Before it existed, a new installation needed
 * a psql prompt for the business and a command for the account, and an owner
 * was then stopped at the next request for want of a second factor there was
 * no screen to set up. All three steps are in this flow now.
 *
 * The password is typed twice. Not ceremony: this is the only account on the
 * instance, nobody can reset it for this person, and a typo in it means
 * starting the installation again.
 */
export function SetupScreen({ onDone }: { readonly onDone: () => void }) {
  const [company, setCompany] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [repeated, setRepeated] = useState('')
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  const mismatched = repeated.length > 0 && repeated !== password

  async function submit(event: FormEvent) {
    event.preventDefault()

    if (password !== repeated) {
      setTrouble('Die beiden Passwörter sind nicht gleich.')

      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      await runSetup({ company, name, email, password })
      // The ordinary sign in, with the ordinary cookie. The setup route hands
      // out no session of its own, so there is only ever one way in to keep
      // right.
      await signIn(email, password)
      onDone()
    } catch (error) {
      setTrouble(saidWhy(error, 'Die Einrichtung hat nicht geklappt.'))
      setWorking(false)
    }
  }

  return (
    <Gate title="Einrichten">
      <p className="text-body text-ink-muted">
        Diese Instanz ist noch leer. Hier entstehen der Betrieb und das erste Konto. Wer dieses
        Konto hat, legt später alle weiteren an.
      </p>

      <form
        className="mt-4 flex flex-col gap-4"
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <Field
          label="Betrieb"
          name="organization"
          autoComplete="organization"
          required
          value={company}
          onChange={(event) => {
            setCompany(event.target.value)
          }}
          hint="So wie der Betrieb auf einer Rechnung steht."
        />
        <Field
          label="Ihr Name"
          name="name"
          autoComplete="name"
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value)
          }}
        />
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
          hint="Damit melden Sie sich an."
        />
        <Field
          label="Passwort"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={shortestPassword}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
          }}
          hint={`Mindestens ${String(shortestPassword)} Zeichen. Dieses Konto kann niemand für Sie zurücksetzen.`}
        />
        <Field
          label="Passwort wiederholen"
          type="password"
          name="password-repeat"
          autoComplete="new-password"
          required
          value={repeated}
          onChange={(event) => {
            setRepeated(event.target.value)
          }}
          problem={mismatched ? 'Die beiden Passwörter sind nicht gleich.' : undefined}
        />

        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}

        <Button type="submit" tone="primary" wide disabled={working || mismatched}>
          {working ? 'Wird eingerichtet' : 'Betrieb anlegen'}
        </Button>
      </form>
    </Gate>
  )
}

/**
 * The picture an authenticator app reads.
 *
 * Drawn from the matrix rather than from a string of SVG, so nothing is handed
 * to `dangerouslySetInnerHTML` and the shape can carry its own labels. The
 * white square underneath is not decoration: a reader needs the quiet zone and
 * the dark on light contrast, and in a dark theme the page behind it is not
 * white.
 */
export function QrCode({ text, label }: { readonly text: string; readonly label: string }) {
  const { size, data } = encode(text)
  // Four modules of quiet zone, which is what the specification asks for.
  const quiet = 4
  const edge = size + quiet * 2

  return (
    <svg
      viewBox={`0 0 ${String(edge)} ${String(edge)}`}
      role="img"
      aria-label={label}
      className="w-full max-w-64 h-auto rounded-card"
      // Blocks, not smoothed. A scaled up QR code with interpolation between
      // the modules is one a camera has to work at.
      style={{ imageRendering: 'pixelated' }}
    >
      <rect width={edge} height={edge} fill="#ffffff" />
      {data.map((row, y) =>
        row.map((dark, x) =>
          dark ? (
            <rect
              key={`${String(x)}-${String(y)}`}
              x={x + quiet}
              y={y + quiet}
              width={1}
              height={1}
              fill="#000000"
            />
          ) : null,
        ),
      )}
    </svg>
  )
}

/**
 * Setting up a second factor, which for an owner is not optional.
 *
 * ADR 0006 hangs the requirement on the role and checks it on every request,
 * and until this existed there was no way to meet it: the only account a new
 * instance can have was exactly the account that could not be used. That was
 * the dead end #62 describes.
 *
 * Two steps, because better-auth asks for the password before it hands out a
 * secret, and because a factor switched on before a code from it has been
 * checked is a factor that can lock somebody out of their own instance.
 *
 * Without a frame of its own, so that the gate can put it on a screen and the
 * account settings can put it in a card. The two places are the same work at
 * two moments: before somebody can do anything, and afterwards when they get
 * round to it.
 */
export function SecondFactorSetup({
  onDone,
  onCancel,
}: {
  readonly onDone: () => void
  /** Present where this is optional, absent where it is the only way on. */
  readonly onCancel?: () => void
}) {
  const [password, setPassword] = useState('')
  const [started, setStarted] = useState<{
    readonly totpUri: string
    readonly backupCodes: readonly string[]
  } | null>(null)
  const [code, setCode] = useState('')
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function begin(event: FormEvent) {
    event.preventDefault()
    setWorking(true)
    setTrouble(null)

    try {
      setStarted(await startSecondFactor(password))
    } catch (error) {
      setTrouble(saidWhy(error, 'Das Passwort stimmt nicht.'))
    } finally {
      setWorking(false)
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault()
    setWorking(true)
    setTrouble(null)

    try {
      await verifySecondFactor(code)
      onDone()
    } catch (error) {
      setTrouble(saidWhy(error, 'Der Code stimmt nicht.'))
      setWorking(false)
    }
  }

  if (!started) {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          void begin(event)
        }}
      >
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
          hint="Zur Sicherheit noch einmal, bevor ein neuer Zugang entsteht."
        />

        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}

        <Button type="submit" tone="primary" wide disabled={working}>
          {working ? 'Einen Moment' : 'Einrichten'}
        </Button>

        {onCancel ? (
          <Button type="button" tone="secondary" wide onClick={onCancel}>
            Später
          </Button>
        ) : null}
      </form>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-2">
        <QrCode text={started.totpUri} label="QR-Code für die Authenticator-App" />
        <p className="text-table text-ink-muted text-center">
          Scannen, oder diesen Schlüssel eintippen:
        </p>
        <p className="text-body font-condensed tracking-wider break-all text-center">
          {secretFrom(started.totpUri)}
        </p>
      </div>

      <Card label="Wiederherstellungscodes" tone="sunken">
        <p className="text-body">
          Diese Codes sind der Weg hinein, wenn das Telefon weg ist. Jeder gilt einmal. Jetzt
          ausdrucken oder aufschreiben, danach sind sie nicht mehr zu sehen.
        </p>
        <ul className="mt-3 grid grid-cols-2 gap-2">
          {started.backupCodes.map((backup) => (
            <li key={backup} className="text-body font-condensed tracking-wider numeric">
              {backup}
            </li>
          ))}
        </ul>
      </Card>

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          void confirm(event)
        }}
      >
        <FieldLabel>Zum Abschluss</FieldLabel>
        <Field
          label="Code aus der App"
          numeric
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          required
          value={code}
          onChange={(event) => {
            setCode(event.target.value)
          }}
          hint="Erst wenn ein Code gestimmt hat, gilt der zweite Faktor als eingerichtet."
        />

        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}

        <Button type="submit" tone="primary" wide disabled={working}>
          {working ? 'Wird geprüft' : 'Fertig'}
        </Button>
      </form>
    </div>
  )
}

/**
 * The same thing as the only thing on the screen, for the gate.
 *
 * An owner who has no second factor cannot reach a single screen inside a
 * business, so this cannot live behind the navigation: it has to be what they
 * meet instead.
 */
export function SecondFactorSetupScreen({ onDone }: { readonly onDone: () => void }) {
  return (
    <Gate title="Zweiter Faktor">
      <p className="text-body text-ink-muted">
        Für die Rolle Inhaber ist ein zweiter Faktor Pflicht. Richten Sie ihn mit einer
        Authenticator-App auf dem Telefon ein.
      </p>
      <div className="mt-4">
        <SecondFactorSetup onDone={onDone} />
      </div>
    </Gate>
  )
}
