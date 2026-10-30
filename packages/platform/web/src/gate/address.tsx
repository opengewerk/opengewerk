import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '../components/button.js'
import { addressOffer, confirmAddressLink } from '../session/session.js'
import { RequestRefused } from '../sync/transport.js'
import { Gate, GateText, GateWaiting } from './frame.js'

/**
 * The far end of the link in the mail to an address (N28 of the security
 * audit, opengewerk#754), as the board "Neue E-Mail-Adresse bestätigen"
 * draws it.
 *
 * In the gate and recognised by its path, like the link to a new password,
 * because it may be opened on any device and signed in as nobody. It shows
 * the address and waits for the button: a scanner of mails that opens every
 * link confirms nothing by itself. Afterwards the way on is the sign in, with
 * the new address where it was a new one.
 */
export function AddressScreen({ token }: { readonly token: string }) {
  const offer = useQuery({
    queryKey: ['address-offer', token],
    queryFn: () => addressOffer(token),
    retry: false,
  })
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [done, setDone] = useState<{ email: string; changed: boolean } | null>(null)

  async function confirm() {
    setWorking(true)
    setTrouble(null)

    try {
      setDone(await confirmAddressLink(token))
    } catch (error) {
      setTrouble(
        error instanceof RequestRefused && error.status < 500
          ? error.message
          : 'Die Bestätigung kam nicht an. Bitte gleich noch einmal.',
      )
    } finally {
      setWorking(false)
    }
  }

  const away = (
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
  )

  if (done) {
    return (
      <Gate title="E-Mail-Adresse bestätigt">
        <GateText muted={false}>
          {done.changed
            ? `Ab jetzt gilt ${done.email} für Ihr Konto, und Sie melden sich mit ihr an. Die bisherige Adresse hat einen Hinweis bekommen.`
            : `${done.email} ist als Adresse Ihres Kontos bestätigt.`}
        </GateText>
        {away}
      </Gate>
    )
  }

  if (offer.isPending) {
    return <GateWaiting>Der Link wird geprüft.</GateWaiting>
  }

  if (offer.isError || offer.data.state !== 'open') {
    return (
      <Gate title="Neue E-Mail-Adresse">
        <GateText muted={false}>
          {offer.isError
            ? 'Der Link ließ sich gerade nicht prüfen. Bitte gleich noch einmal.'
            : 'Dieser Link gilt nicht mehr: er war schon benutzt, verworfen oder älter als einen Tag. Unter „Konto“ geht eine neue Mail hinaus.'}
        </GateText>
        {away}
      </Gate>
    )
  }

  return (
    <Gate title="Neue E-Mail-Adresse">
      <GateText muted={false}>
        {`Mit dem Knopf gilt ${offer.data.email} für Ihr Konto, und Sie melden sich ab dann mit ihr an. Die bisherige Adresse bekommt einen Hinweis.`}
      </GateText>
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <Button
        tone="primary"
        wide
        disabled={working}
        onClick={() => {
          void confirm()
        }}
      >
        Adresse bestätigen
      </Button>
    </Gate>
  )
}
