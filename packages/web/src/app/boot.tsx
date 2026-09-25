import { requiresSecondFactor, syncEntities } from '@opengewerk/domain'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, WifiOff } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { Button } from '../components/index.js'
import type { Entry } from '../entry/entry.js'
import { SyncClient } from '../sync/client.js'
import { SyncProvider } from '../sync/provider.js'
import { openLocalStore } from '../sync/store.js'
import { directWrite, httpTransport } from '../sync/transport.js'
import { unreachable } from '../session/remembered.js'
import { deviceIdentity } from './device.js'
import { Gate, GateText, GateWaiting } from './gate.js'
import { InvitationScreen } from './invitation.js'
import { PasswordResetScreen } from './password-reset.js'
import { accountQuery } from './queries.js'
import { SecondFactorSetupScreen, SetupScreen } from './setup.js'
import { SecondFactorScreen, SignInScreen, TenantScreen } from './sign-in.js'
import {
  availableTenants,
  invitationToken,
  passwordResetToken,
  setupNeeded,
} from './../session/session.js'
import type { Account } from './../session/session.js'

/**
 * Everything between opening the application and being able to work.
 *
 * The three questions of ADR 0006 in order: who are you, which business, and
 * only then anything at all. The order is the point, and it is why this is a
 * gate rather than a redirect somewhere inside the router: no screen in the
 * application is ever rendered without a business behind it, so no screen has
 * to remember to ask.
 *
 * Three steps sit in front of the first question and all three are about
 * somebody who cannot reach a single screen behind the navigation. An empty
 * instance is set up here rather than at a psql prompt. An account whose role
 * needs a second factor sets it up here rather than being refused at every
 * request with no way to fix it. And somebody who was handed a link redeems it
 * here, because at that moment they have no account at all.
 *
 * The link is recognised by its path and before anything else is asked. Not by
 * the router: the routers start after there is a session and a business, which
 * is exactly what the person holding a link does not have. And before the
 * account query, because the answer does not depend on it; somebody who is
 * already signed in on this browser can be handed a link for somebody else,
 * and the screen has to be the one the link points at rather than the office
 * of whoever used the machine last.
 */
type Step = 'second-factor' | 'asking' | 'working'

export function Boot({ entry, children }: { readonly entry: Entry; readonly children: ReactNode }) {
  const queries = useQueryClient()
  // Read once and then constant, like the device identity below. The screen it
  // leads to leaves the address behind when it is done, so this never has to
  // notice a change.
  const [token] = useState(() => invitationToken(globalThis.location.pathname))
  // The link to a new password, recognised the same way and for the same
  // reason: whoever holds it cannot sign in (#126).
  const [resetToken] = useState(() => passwordResetToken(globalThis.location.pathname))
  const [step, setStep] = useState<Step>('asking')
  const [client, setClient] = useState<SyncClient | null>(null)
  // Worked out once and then constant. A ref would say the same thing and
  // would be read during render, which is what a ref is not for.
  const [deviceId] = useState(deviceIdentity)

  // Without a network this answers with who was signed in here last, and the
  // device opens what it keeps (#123); see `currentAccount`.
  const account = useQuery(accountQuery)
  const cutOff = account.isError && unreachable(account.error)

  /**
   * Whether this instance has never been used.
   *
   * Only asked while nobody is signed in, which is the one moment it can be
   * true and the one moment an extra request costs nothing. A browser with a
   * session never sends it.
   */
  const setup = useQuery({
    queryKey: ['setup'],
    queryFn: setupNeeded,
    enabled: !account.isPending && !account.data && !cutOff,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

  const tenantId = account.data?.tenantId ?? null

  const forget = useCallback(() => {
    setStep('asking')
    setClient(null)
    void queries.invalidateQueries({ queryKey: ['account'] })
  }, [queries])

  useEffect(() => {
    if (!tenantId) {
      return
    }

    let live = true
    let started: SyncClient | null = null

    void (async () => {
      const store = await openLocalStore(tenantId)
      const running = await SyncClient.start({
        store,
        transport: httpTransport,
        writer: directWrite,
        deviceId,
        entities: syncEntities,
        onSignedOut: forget,
      })

      if (!live) {
        // The business changed while the store was opening. Closing it here
        // beats leaving a second client listening for the network behind the
        // one on screen.
        running.stop()

        return
      }

      started = running
      setClient(running)
      void running.synchronise()
    })()

    return () => {
      live = false
      started?.stop()
      setClient(null)
    }
  }, [tenantId, deviceId, forget])

  if (token) {
    return <InvitationScreen token={token} />
  }

  if (resetToken) {
    return <PasswordResetScreen token={resetToken} />
  }

  if (account.isPending) {
    return <GateWaiting>Die Anwendung fragt, wer angemeldet ist.</GateWaiting>
  }

  if (step === 'second-factor') {
    return (
      <SecondFactorScreen
        onVerified={() => {
          setStep('asking')
          void queries.invalidateQueries({ queryKey: ['account'] })
        }}
      />
    )
  }

  if (!account.data) {
    if (cutOff) {
      return (
        <Gate title="Keine Verbindung">
          <div className="flex items-start gap-3">
            <WifiOff
              size={24}
              strokeWidth={2.1}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-waiting"
            />
            <p className="text-[16px] leading-[1.5] text-ink lg:text-[15px]">
              Der Server antwortet nicht, und auf diesem Gerät war noch niemand angemeldet. Zum
              ersten Anmelden braucht es eine Verbindung; danach öffnet das Gerät seine Daten auch
              ohne.
            </p>
          </div>
          <Button
            tone="secondary"
            wide
            icon={RefreshCw}
            onClick={() => {
              void account.refetch()
            }}
          >
            Erneut versuchen
          </Button>
        </Gate>
      )
    }

    if (setup.data === undefined && !setup.isError) {
      return <GateWaiting>Die Anwendung sieht nach, ob sie schon läuft.</GateWaiting>
    }

    if (setup.data === true) {
      return (
        <SetupScreen
          onDone={() => {
            void queries.invalidateQueries({ queryKey: ['setup'] })
            void queries.invalidateQueries({ queryKey: ['account'] })
          }}
        />
      )
    }

    return (
      <SignInScreen
        onSignedIn={() => {
          void queries.invalidateQueries({ queryKey: ['account'] })
        }}
        onSecondFactor={() => {
          setStep('second-factor')
        }}
      />
    )
  }

  if (!tenantId) {
    return <ChooseTenant entry={entry} deviceId={deviceId} account={account.data} onDone={forget} />
  }

  if (!client) {
    return <GateWaiting>Die Daten dieses Geräts werden geöffnet.</GateWaiting>
  }

  return <SyncProvider client={client}>{children}</SyncProvider>
}

function ChooseTenant({
  entry,
  deviceId,
  account,
  onDone,
}: {
  readonly entry: Entry
  readonly deviceId: string
  readonly account: Account
  readonly onDone: () => void
}) {
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: availableTenants, retry: false })

  if (tenants.isPending) {
    return <GateWaiting>Die Betriebe werden geladen.</GateWaiting>
  }

  if (tenants.isError) {
    return (
      <Gate title="Das ging nicht">
        <GateText muted={false}>Die Liste der Betriebe kam nicht an.</GateText>
        <Button
          tone="secondary"
          wide
          icon={RefreshCw}
          onClick={() => {
            void tenants.refetch()
          }}
        >
          Erneut versuchen
        </Button>
      </Gate>
    )
  }

  /**
   * The wall from #62, and the way through it.
   *
   * The requirement hangs on the role and is checked on every request, so an
   * owner without a second factor gets as far as this screen and no further,
   * whichever business they pick. Asking here rather than after the choice is
   * deliberate: setting the factor up replaces the session, and at this point
   * there is no business on it yet and nothing to put back.
   */
  const needed = tenants.data.some((tenant) => requiresSecondFactor(tenant.roles))

  if (needed && !account.twoFactorEnabled) {
    return <SecondFactorSetupScreen onDone={onDone} />
  }

  return (
    <TenantScreen
      entry={entry}
      deviceId={deviceId}
      tenants={tenants.data}
      onChosen={onDone}
      onSignedOut={onDone}
    />
  )
}
