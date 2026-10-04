import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { useApplication } from '../application.js'
import { Button } from '../components/button.js'
import { Field } from '../components/field.js'
import { accountQuery } from '../session/queries.js'
import { invitationOffer, redeemInvitation, shortestPassword, signIn } from '../session/session.js'
import { RequestRefused } from '../sync/transport.js'
import { Gate, GateText, GateWaiting } from './frame.js'
import { SecondFactorScreen, SignInScreen } from './sign-in.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/**
 * The screen at the far end of a link, for somebody who has no account yet.
 *
 * It sits in the gate next to the first run setup and for the same reason:
 * whoever opens it cannot reach a single screen behind the navigation, so an
 * entry in a menu would be unreachable for them. It is recognised by the path
 * rather than by the router, because the router of an application starts
 * after there is a tenant and a session, and here there is neither.
 *
 * What it asks for is a password, and only a password. The name, the address
 * and the roles were decided by whoever invited and travel with the
 * invitation; the one thing they do not decide is the thing that lets
 * somebody in.
 *
 * Who invited is a tenant, and what that is called is the application's to
 * say (ADR 0010): why a link is no longer good and who to turn to, and the
 * two sentences that welcome somebody.
 */
export function InvitationScreen({ token }: { readonly token: string }) {
  const { invitation: sentences } = useApplication().sentences
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
        <GateText muted={false}>{sentences.spent[offer.data.state]}</GateText>
        <Button tone="secondary" wide onClick={startOver}>
          Zur Anmeldung
        </Button>
      </Gate>
    )
  }

  return <Accept token={token} offer={offer.data} />
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
  const { invitation: sentences } = useApplication().sentences
  const [password, setPassword] = useState('')
  const [repeated, setRepeated] = useState('')
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  const mismatched = repeated.length > 0 && repeated !== password

  async function submit() {
    if (password !== repeated) {
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
    return <JoinAsAccount token={token} offer={offer} />
  }

  return (
    <Gate title={`Willkommen bei ${offer.company}`}>
      <GateText>
        {sentences.newAccount(
          <strong className="text-ink">{offer.name}</strong>,
          <strong className="text-ink">{offer.email}</strong>,
        )}
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

/**
 * An address that already has an account joins signed in as that account, and
 * only so (opengewerk-haustechnik#31).
 *
 * The link alone is not enough: when no mail was sent it is in the hands of
 * whoever invited, and the server refuses it without the session of the
 * account it names. So this screen asks who is signed in and offers what
 * fits: the ordinary sign in with the address filled in, the second factor
 * where the account has one, and only then the button that joins. Signed in as
 * somebody else, it says so and goes no further; signing out belongs to the
 * application, which knows what is still waiting on this device.
 */
function JoinAsAccount({
  token,
  offer,
}: {
  readonly token: string
  readonly offer: { company: string; email: string }
}) {
  const { invitation: sentences } = useApplication().sentences
  const queries = useQueryClient()
  const account = useQuery(accountQuery)
  const [secondFactor, setSecondFactor] = useState(false)
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  function askAgain() {
    void queries.invalidateQueries({ queryKey: accountQuery.queryKey })
  }

  async function join() {
    setWorking(true)
    setTrouble(null)

    try {
      await redeemInvitation(token)
      startOver()
    } catch (error) {
      setTrouble(saidWhy(error, 'Das hat nicht geklappt.'))
      setWorking(false)
    }
  }

  if (secondFactor) {
    return (
      <SecondFactorScreen
        onVerified={() => {
          setSecondFactor(false)
          askAgain()
        }}
      />
    )
  }

  if (account.isPending) {
    return <GateWaiting>Die Anwendung fragt, wer angemeldet ist.</GateWaiting>
  }

  const signedIn = account.data ?? null

  if (!signedIn) {
    return (
      <SignInScreen
        email={offer.email}
        intro={
          <>
            Für <strong>{offer.email}</strong> gibt es auf dieser Instanz schon ein Konto. Melden
            Sie sich damit an, dann können Sie {offer.company} beitreten.
          </>
        }
        onSignedIn={askAgain}
        onSecondFactor={() => {
          setSecondFactor(true)
        }}
      />
    )
  }

  if (signedIn.email.toLowerCase() !== offer.email.toLowerCase()) {
    return (
      <Gate title={`Beitreten zu ${offer.company}`}>
        <GateText muted={false}>
          Diese Einladung gilt für <strong>{offer.email}</strong>, angemeldet sind Sie als{' '}
          <strong>{signedIn.email}</strong>. Melden Sie sich in der Anwendung ab und öffnen Sie den
          Link danach noch einmal.
        </GateText>
        <Button tone="secondary" wide onClick={startOver}>
          Zur Anwendung
        </Button>
      </Gate>
    )
  }

  return (
    <Gate title={`Beitreten zu ${offer.company}`}>
      <GateText muted={false}>
        Angemeldet als <strong>{offer.email}</strong>. {sentences.tenantIsAdded}
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
          void join()
        }}
      >
        {working ? 'Einen Moment' : sentences.join}
      </Button>
    </Gate>
  )
}
