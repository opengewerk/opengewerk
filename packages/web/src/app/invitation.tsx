import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Button, Field } from '../components/index.js'
import { RequestRefused } from '../sync/transport.js'
import { Gate, GateText, GateWaiting } from './gate.js'
import {
  invitationOffer,
  redeemInvitation,
  shortestPassword,
  signIn,
} from './../session/session.js'
import type { InvitationState } from './../session/session.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/**
 * The screen at the far end of a link, for somebody who has no account yet.
 *
 * It sits in the gate next to the first run setup and for the same reason:
 * whoever opens it cannot reach a single screen behind the navigation, so an
 * entry in a menu would be unreachable for them. It is recognised by the path
 * rather than by the router, because the router of the office starts after
 * there is a business and a session, and here there is neither.
 *
 * What it asks for is a password, and only a password. The name, the address
 * and the roles were decided by the office and travel with the invitation; the
 * one thing the office does not decide is the thing that lets somebody in.
 */
export function InvitationScreen({ token }: { readonly token: string }) {
  const offer = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => invitationOffer(token),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })

  if (offer.isPending) {
    return <GateWaiting>Die Einladung wird geprüft.</GateWaiting>
  }

  if (offer.isError) {
    return (
      <Gate title="Dieser Link führt nirgendwohin">
        <GateText muted={false}>
          {saidWhy(offer.error, 'Diesen Link gibt es nicht.')} Wer Ihnen den Link geschickt hat,
          kann einen neuen erzeugen.
        </GateText>
        <Button tone="secondary" wide onClick={startOver}>
          Zur Anmeldung
        </Button>
      </Gate>
    )
  }

  if (offer.data.state !== 'open') {
    return (
      <Gate title="Dieser Link gilt nicht mehr">
        <GateText muted={false}>{spent[offer.data.state]}</GateText>
        <Button tone="secondary" wide onClick={startOver}>
          Zur Anmeldung
        </Button>
      </Gate>
    )
  }

  return <Accept token={token} offer={offer.data} />
}

/** Why a link is no longer good, in the words that fit each case. */
const spent: Readonly<Record<Exclude<InvitationState, 'open'>, string>> = {
  redeemed:
    'Er wurde schon benutzt. Wenn das nicht Sie waren, sagen Sie dem Betrieb bitte Bescheid.',
  revoked: 'Der Betrieb hat ihn zurückgezogen. Bitte dort nachfragen.',
  expired: 'Er ist abgelaufen. Der Betrieb kann einen neuen erzeugen.',
}

/**
 * Leaves the token behind.
 *
 * A full load and not a route change, and both halves matter: the address bar
 * loses the token, which would otherwise sit in the history of a borrowed
 * machine, and the gate starts from the beginning with whatever session now
 * exists.
 */
function startOver(): void {
  globalThis.location.assign('/')
}

function Accept({
  token,
  offer,
}: {
  readonly token: string
  readonly offer: { company: string; name: string; email: string; knownAccount: boolean }
}) {
  const [password, setPassword] = useState('')
  const [repeated, setRepeated] = useState('')
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  const mismatched = repeated.length > 0 && repeated !== password

  async function submit() {
    if (!offer.knownAccount && password !== repeated) {
      setTrouble('Die beiden Passwörter sind nicht gleich.')

      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      const { created } = await redeemInvitation(token, password)

      if (created) {
        // The ordinary sign in, with the ordinary cookie. The redemption hands
        // out no session of its own, so there is only ever one way in to keep
        // right.
        await signIn(offer.email, password)
      }

      startOver()
    } catch (error) {
      setTrouble(saidWhy(error, 'Das hat nicht geklappt.'))
      setWorking(false)
    }
  }

  if (offer.knownAccount) {
    return (
      <Gate title={`Beitreten zu ${offer.company}`}>
        <GateText muted={false}>
          Für <strong>{offer.email}</strong> gibt es auf dieser Instanz schon ein Konto. Sie
          behalten Ihr Passwort; der Betrieb kommt einfach dazu.
        </GateText>

        {trouble ? (
          <p
            role="alert"
            className="text-[15px] leading-[1.5] font-semibold text-conflict lg:text-[14px]"
          >
            {trouble}
          </p>
        ) : null}

        <Button
          tone="primary"
          wide
          disabled={working}
          onClick={() => {
            void submit()
          }}
        >
          {working ? 'Einen Moment' : 'Betrieb übernehmen'}
        </Button>
      </Gate>
    )
  }

  return (
    <Gate title={`Willkommen bei ${offer.company}`}>
      <GateText>
        Der Betrieb hat einen Zugang für <strong className="text-ink">{offer.name}</strong>{' '}
        angelegt, mit der Adresse <strong className="text-ink">{offer.email}</strong>. Fehlt nur
        noch ein Passwort, und das wählen Sie selbst: niemand im Betrieb bekommt es zu sehen.
      </GateText>

      <form
        className="flex flex-col gap-[15px]"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
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
          hint={`Mindestens ${String(shortestPassword)} Zeichen.`}
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
          problem={mismatched ? 'Die beiden stimmen nicht überein.' : undefined}
        />

        {trouble ? (
          <p
            role="alert"
            className="text-[15px] leading-[1.5] font-semibold text-conflict lg:text-[14px]"
          >
            {trouble}
          </p>
        ) : null}

        <Button type="submit" tone="primary" wide disabled={working || mismatched}>
          {working ? 'Einen Moment' : 'Zugang einrichten'}
        </Button>
      </form>
    </Gate>
  )
}
