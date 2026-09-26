import { businessNameMaxLength } from '@opengewerk/domain'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { encode } from 'uqr'

import { Button, Field, FieldLabel, useInGate } from '../components/index.js'
import { RequestRefused } from '../sync/transport.js'
import { Gate, GateText } from './gate.js'
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

/** A sentence that went wrong, at the size of the gate there and of a card elsewhere. */
function Trouble({ children }: { readonly children: string }) {
  const gate = useInGate()

  return (
    <p
      role="alert"
      className={
        gate
          ? 'text-[15px] leading-[1.5] font-semibold text-conflict lg:text-[14px]'
          : 'text-body font-semibold text-conflict'
      }
    >
      {children}
    </p>
  )
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
 *
 * The setup code comes first (#215), with a line under it, as the canvas draws
 * it on "Tor-Einrichten": it is what lets somebody in, the rest describes the
 * business. Before it, an empty instance took its first run from whoever
 * reached the address first. The code stands in `docker/.env` on the server,
 * so only somebody who can get at the server sets up, and the hint says so in
 * those words.
 */
export function SetupScreen({ onDone }: { readonly onDone: () => void }) {
  const [setupCode, setSetupCode] = useState('')
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
      await runSetup({ setupCode, company, name, email, password })
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
      <GateText>
        Diese Instanz ist noch leer. Hier entstehen der Betrieb und das erste Konto. Wer dieses
        Konto hat, legt später alle weiteren an.
      </GateText>

      <form
        className="flex flex-col gap-[15px]"
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <Field
          label="Einrichtungscode"
          name="setup-code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          value={setupCode}
          onChange={(event) => {
            setSetupCode(event.target.value)
          }}
          hint="Steht auf dem Server in der Datei docker/.env. So richtet nur ein, wer an den Server kommt."
        />
        <hr className="border-0 border-t border-line" />
        <Field
          label="Betrieb"
          // Not "organization" (#276): with it, a browser or a password
          // manager filled in a company of its own, and the business was set
          // up under a name nobody had typed.
          name="business"
          autoComplete="off"
          maxLength={businessNameMaxLength}
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

        {trouble ? <Trouble>{trouble}</Trouble> : null}

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
      className="h-auto w-full rounded-[6px] border border-line"
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

        {trouble ? <Trouble>{trouble}</Trouble> : null}

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

  // As the board "Tor-Faktor-Einrichten" draws it: the code to scan beside the
  // key to type, the recovery codes in a sunken box, and the check at the end.
  return (
    <div className="flex flex-col gap-[15px]">
      <div className="flex flex-wrap items-center gap-[18px]">
        <div className="w-48 shrink-0">
          <QrCode text={started.totpUri} label="QR-Code für die Authenticator-App" />
        </div>
        <div className="flex min-w-[12rem] grow basis-0 flex-col gap-1.5">
          <p className="text-[13px] leading-[1.5] text-ink-muted">
            Scannen, oder diesen Schlüssel eintippen:
          </p>
          <p className="font-condensed text-[18px] font-semibold tracking-[1.5px] [overflow-wrap:anywhere] text-ink">
            {secretFrom(started.totpUri)}
          </p>
        </div>
      </div>

      <section
        aria-label="Wiederherstellungscodes"
        className="flex flex-col gap-2.5 rounded-[5px] border border-line bg-surface-sunken px-4 py-3.5"
      >
        <p className="text-[14px] leading-[1.5] text-ink">
          Diese Codes sind der Weg hinein, wenn das Telefon weg ist. Jeder gilt einmal. Jetzt
          ausdrucken oder aufschreiben, danach sind sie nicht mehr zu sehen.
        </p>
        <ul className="grid grid-cols-2 gap-x-[18px] gap-y-1.5">
          {started.backupCodes.map((backup) => (
            <li key={backup}>
              <code className="text-[15px] font-semibold tracking-[0.5px] text-ink">{backup}</code>
            </li>
          ))}
        </ul>
      </section>

      <form
        className="flex flex-col gap-[15px]"
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

        {trouble ? <Trouble>{trouble}</Trouble> : null}

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
    <Gate title="Zweiter Faktor" width={600}>
      <GateText>
        Für die Rolle Inhaber ist ein zweiter Faktor Pflicht. Richten Sie ihn mit einer
        Authenticator-App auf dem Telefon ein.
      </GateText>
      <SecondFactorSetup onDone={onDone} />
    </Gate>
  )
}
