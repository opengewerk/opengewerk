import { hasSecondFactor, syncEntities, type TenantId } from '@opengewerk/domain'
import { Button } from '@opengewerk/platform-web'
import {
  accountQuery,
  availableTenants,
  deviceIdentity,
  instanceVersion,
  invitationToken,
  passwordResetToken,
  setupNeeded,
  unreachable,
} from '@opengewerk/platform-web/session'
import type { Account } from '@opengewerk/platform-web/session'
import {
  SyncProvider,
  directWrite,
  httpTransport,
  openLocalStore,
  workIn,
} from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, WifiOff } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import type { Entry } from '../entry/entry.js'
import { upgradeKeptTenants } from '../session/older-tenants.js'
import { SyncClient } from '../sync/client.js'
import { siteTransport } from '../sync/transport.js'
import { Gate, GateText, GateWaiting, InstanceVersion } from './gate.js'
import { InvitationScreen } from './invitation.js'
import { PasswordResetScreen } from './password-reset.js'
import { SecondFactorSetupScreen, SetupScreen } from './setup.js'
import { SecondFactorScreen, SignInScreen, TenantScreen } from './sign-in.js'

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
  // Once, before the first question that could read it: a list of businesses
  // an earlier version kept, put into the form this one reads.
  useState(() => {
    upgradeKeptTenants()

    return true
  })

  // Asked once per start and kept: the version does not change while the page
  // is open, and without an answer the foot of the gate shows the licence
  // alone (#259).
  const version = useQuery({
    queryKey: ['version'],
    queryFn: instanceVersion,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

  return (
    <InstanceVersion.Provider value={version.data ?? null}>
      <BootSteps entry={entry}>{children}</BootSteps>
    </InstanceVersion.Provider>
  )
}

function BootSteps({ entry, children }: { readonly entry: Entry; readonly children: ReactNode }) {
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
  // Set when the server turned the running client away as signed out and the
  // account came back as it was; see `signedOut`.
  const [stalled, setStalled] = useState(false)
  // Bumped to start a client again for the same business, which the effect
  // below would otherwise never do: nothing it depends on has changed.
  const [round, setRound] = useState(0)

  const forget = useCallback(() => {
    setStep('asking')
    setClient(null)
    void queries.invalidateQueries({ queryKey: ['account'] })
  }, [queries])

  /**
   * The server answered the running client with "not signed in".
   *
   * The account is asked again, and it decides. A session that has run out
   * takes the business with it, and the gate asks for a sign in. A session
   * that is still good comes back with the same business, and then nothing the
   * effect below depends on changes: the gate waited for a client that nothing
   * would ever start (#254). That case is shown, with a way to try again.
   * Starting a client by itself instead would loop against a server that keeps
   * saying no.
   */
  const signedOut = useCallback(
    (business: TenantId) => {
      setClient(null)
      void queries.invalidateQueries({ queryKey: accountQuery.queryKey }).then(() => {
        if (queries.getQueryData(accountQuery.queryKey)?.tenantId === business) {
          setStalled(true)
        }
      })
    },
    [queries],
  )

  useEffect(() => {
    if (!tenantId) {
      return
    }

    let live = true
    let started: SyncClient | null = null

    // From here on every request of this page names this business (#242).
    workIn(tenantId)

    void (async () => {
      const store = await openLocalStore(tenantId)
      const running = await SyncClient.start({
        store,
        transport: entry === 'site' ? siteTransport() : httpTransport,
        writer: directWrite,
        deviceId,
        entities: syncEntities,
        onSignedOut: () => {
          signedOut(tenantId)
        },
      })

      if (!live) {
        // The business changed while the store was opening. Closing it here
        // beats leaving a second client listening for the network behind the
        // one on screen.
        running.stop()

        return
      }

      started = running
      setStalled(false)
      setClient(running)
      void running.synchronise()
    })()

    return () => {
      live = false
      started?.stop()
      workIn(null)
      setClient(null)
      setStalled(false)
    }
  }, [tenantId, deviceId, signedOut, round, entry])

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
    if (stalled) {
      return (
        <Gate title="Abgleich unterbrochen">
          <GateText muted={false}>
            Der Server hat eine Anfrage dieses Geräts als nicht angemeldet abgelehnt, die Anmeldung
            gilt aber noch. Was auf dem Gerät erfasst ist, bleibt erhalten.
          </GateText>
          <Button
            tone="secondary"
            wide
            icon={RefreshCw}
            onClick={() => {
              setStalled(false)
              setRound((count) => count + 1)
            }}
          >
            Erneut versuchen
          </Button>
        </Gate>
      )
    }

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
   * whichever business they pick. Which role asks for one is said by the
   * server with each business, from the rows of its roles (ADR 0010). Asking
   * here rather than after the choice is deliberate: setting the factor up
   * replaces the session, and at this point there is no business on it yet
   * and nothing to put back.
   *
   * A sign in with a passkey carries the second factor itself (#167), so it
   * goes straight on to the choice, as the server lets it.
   */
  const needed = tenants.data.some((tenant) => tenant.secondFactor)

  if (needed && !hasSecondFactor(account)) {
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
