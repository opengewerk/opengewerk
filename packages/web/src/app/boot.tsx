import { syncEntities } from '@opengewerk/domain'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { Button } from '../components/index.js'
import type { Entry } from '../entry/entry.js'
import { SyncClient } from '../sync/client.js'
import { SyncProvider } from '../sync/provider.js'
import { openLocalStore } from '../sync/store.js'
import { directWrite, httpTransport } from '../sync/transport.js'
import { deviceIdentity } from './device.js'
import { Gate, SecondFactorScreen, SignInScreen, TenantScreen } from './sign-in.js'
import { availableTenants, currentAccount, signOut } from './../session/session.js'

/**
 * Everything between opening the application and being able to work.
 *
 * Four states and they are the three questions of ADR 0006 in order: who are
 * you, which business, and only then anything at all. The order is the point,
 * and it is why this is a gate rather than a redirect somewhere inside the
 * router: no screen in the application is ever rendered without a business
 * behind it, so no screen has to remember to ask.
 */
type Step = 'second-factor' | 'asking' | 'working'

export function Boot({ entry, children }: { readonly entry: Entry; readonly children: ReactNode }) {
  const queries = useQueryClient()
  const [step, setStep] = useState<Step>('asking')
  const [client, setClient] = useState<SyncClient | null>(null)
  // Worked out once and then constant. A ref would say the same thing and
  // would be read during render, which is what a ref is not for.
  const [deviceId] = useState(deviceIdentity)

  const account = useQuery({
    queryKey: ['account'],
    queryFn: currentAccount,
    // An expired session has to be noticed, and the answer is cheap. Asking
    // again on every focus is what turns "nothing works any more" into a sign
    // in screen.
    staleTime: 30_000,
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

  if (account.isPending) {
    return <Gate title="Einen Moment">Die Anwendung fragt, wer angemeldet ist.</Gate>
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
    return <ChooseTenant entry={entry} deviceId={deviceId} onDone={forget} />
  }

  if (!client) {
    return <Gate title="Einen Moment">Die Daten dieses Geräts werden geöffnet.</Gate>
  }

  return <SyncProvider client={client}>{children}</SyncProvider>
}

function ChooseTenant({
  entry,
  deviceId,
  onDone,
}: {
  readonly entry: Entry
  readonly deviceId: string
  readonly onDone: () => void
}) {
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: availableTenants, retry: false })

  if (tenants.isPending) {
    return <Gate title="Einen Moment">Die Betriebe werden geladen.</Gate>
  }

  if (tenants.isError) {
    return (
      <Gate title="Das ging nicht">
        <p className="text-body">Die Liste der Betriebe kam nicht an.</p>
        <Button
          className="mt-4"
          tone="secondary"
          wide
          onClick={() => {
            void tenants.refetch()
          }}
        >
          Erneut versuchen
        </Button>
      </Gate>
    )
  }

  return (
    <TenantScreen
      entry={entry}
      deviceId={deviceId}
      tenants={tenants.data}
      onChosen={onDone}
      onSignOut={() => {
        void signOut().finally(onDone)
      }}
    />
  )
}
