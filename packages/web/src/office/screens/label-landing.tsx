import { labelCodeFromScan } from '@opengewerk/domain'
import { Navigate } from '@tanstack/react-router'

import { labelMessages, useLabelLookup } from '../../app/installation-labels.js'
import { PageHead, Screen } from '../kit.js'

/**
 * The address on a QR label, `/a/<code>` (#308), opened by the camera of a
 * phone in the browser: signed in, the installation it belongs to, as the
 * board "Nach dem Scan im Browser, angemeldet" has it. Somebody not signed in
 * meets the gate first, with a line saying what comes after it.
 *
 * The code is read from the address of this very page and not from a router
 * parameter, so that it is read the same way the scanner reads it.
 */
export function LabelLandingScreen() {
  const code = labelCodeFromScan(globalThis.location.href)

  if (code === null) {
    return <Message message={labelMessages.foreign} />
  }

  return <LandingFor code={code} />
}

function LandingFor({ code }: { readonly code: string }) {
  const lookup = useLabelLookup(code)

  if (lookup.state === 'open') {
    return <Navigate to={`/anlagen/${lookup.installationId}`} replace />
  }

  if (lookup.state === 'waiting') {
    return (
      <Screen>
        <PageHead title="QR-Etikett" />
        <p role="status" className="text-body text-ink-muted">
          Einen Moment, dieses Gerät holt gerade den Stand des Betriebs.
        </p>
      </Screen>
    )
  }

  if (lookup.state === 'blocked') {
    return <Message message={labelMessages.blocked} />
  }

  return <Message message={lookup.wholeBusiness ? labelMessages.notOurs : labelMessages.notHere} />
}

function Message({
  message,
}: {
  readonly message: { readonly title: string; readonly lines: readonly string[] }
}) {
  return (
    <Screen>
      <PageHead title={message.title} />
      <div role="status" className="flex max-w-[640px] flex-col gap-2">
        {message.lines.map((line) => (
          <p key={line} className="text-body leading-[1.5] text-ink-muted">
            {line}
          </p>
        ))}
      </div>
    </Screen>
  )
}
