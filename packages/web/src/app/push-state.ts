import type { PushEntry, PushOccasion } from '@opengewerk/domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import {
  type PushDeviceView,
  type PushOverview,
  pushOverview,
  sendTestPush,
  setOccasion,
} from '../session/push.js'
import { RequestRefused } from '../sync/transport.js'
import {
  browserSubscription,
  type PushBlocker,
  pushBlocker,
  PushRefused,
  refreshPush,
  switchOff,
  switchOn,
} from './push.js'

/** Whether this page has refreshed its subscription already; once per start is enough. */
let refreshed = false

/**
 * At the start of either entry: a device with push on writes its row again,
 * bound to the session of now (#284). Once per page, quietly; see
 * `refreshPush`.
 */
export function usePushRefresh(entry: PushEntry): void {
  useEffect(() => {
    if (refreshed) {
      return
    }

    refreshed = true
    void refreshPush(entry).catch(() => undefined)
  }, [entry])
}

/** Where the identifier of this device's row is kept, for an instance where a session says nothing (the preview). */
const rememberedDevice = 'opengewerk.push.device'

function remembered(): string | null {
  try {
    return globalThis.localStorage?.getItem(rememberedDevice) ?? null
  } catch {
    return null
  }
}

function remember(id: string | null): void {
  try {
    if (id === null) {
      globalThis.localStorage?.removeItem(rememberedDevice)
    } else {
      globalThis.localStorage?.setItem(rememberedDevice, id)
    }
  } catch {
    // A browser that keeps nothing still gets push; it only asks the server again.
  }
}

/** The state of push for "Konto" and the menu of the site, with what can be done about it. */
export interface PushState {
  /** The server's answer, or undefined while it is on its way. */
  readonly overview: PushOverview | undefined
  readonly failedToLoad: boolean
  /** What keeps this browser from push, or null. */
  readonly blocker: PushBlocker | null
  /** The row of this device, when push is on here. */
  readonly here: PushDeviceView | null
  readonly busy: boolean
  /** The last thing worth saying: why something did not work, or how the test went. */
  readonly said: { readonly tone: 'done' | 'conflict'; readonly text: string } | null
  readonly turnOn: () => void
  readonly turnOff: () => void
  readonly test: () => void
  readonly choose: (occasion: PushOccasion, on: boolean) => void
}

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/** "an 1 Gerät", "an 2 Geräte". */
function devices(count: number): string {
  return count === 1 ? '1 Gerät' : `${String(count)} Geräte`
}

export function usePush(entry: PushEntry): PushState {
  const queries = useQueryClient()
  const overview = useQuery({ queryKey: ['push'], queryFn: pushOverview })
  // What the browser holds, asked once and again after each change here.
  const browser = useQuery({
    queryKey: ['push', 'browser'],
    queryFn: async () => ({ subscribed: (await browserSubscription()) !== null }),
    retry: false,
  })
  const [said, setSaid] = useState<PushState['said']>(null)

  const refresh = () => {
    void queries.invalidateQueries({ queryKey: ['push'] })
  }

  const on = useMutation({
    mutationFn: async () => {
      const publicKey = overview.data?.publicKey

      if (!publicKey) {
        throw new PushRefused('Diese Instanz verschickt keine Push-Nachrichten.')
      }

      return switchOn(publicKey, entry)
    },
    onSuccess: (id) => {
      remember(id)
      setSaid(null)
      refresh()
    },
    onError: (error) => {
      setSaid({
        tone: 'conflict',
        text:
          error instanceof PushRefused
            ? error.message
            : saidWhy(error, 'Push ließ sich auf diesem Gerät nicht einschalten.'),
      })
      refresh()
    },
  })

  const here =
    overview.data?.devices.find((device) => device.thisSession) ??
    overview.data?.devices.find((device) => device.id === remembered()) ??
    null
  const onHere = here !== null && browser.data?.subscribed === true

  const off = useMutation({
    mutationFn: () => switchOff(here?.id ?? null),
    onSuccess: () => {
      remember(null)
      setSaid(null)
      refresh()
    },
    onError: (error) => {
      setSaid({ tone: 'conflict', text: saidWhy(error, 'Push ließ sich nicht ausschalten.') })
      refresh()
    },
  })

  const test = useMutation({
    mutationFn: sendTestPush,
    onSuccess: (result) => {
      setSaid(
        result.failed === 0
          ? { tone: 'done', text: `Gesendet an ${devices(result.sent)}.` }
          : {
              tone: 'conflict',
              text: `Gesendet an ${devices(result.sent)}, an ${devices(result.failed)} nicht. Das Gerät meldet sich beim nächsten Öffnen neu an.`,
            },
      )
      refresh()
    },
    onError: (error) => {
      setSaid({ tone: 'conflict', text: saidWhy(error, 'Die Probenachricht ging nicht hinaus.') })
    },
  })

  const choose = useMutation({
    mutationFn: ({ occasion, value }: { occasion: PushOccasion; value: boolean }) =>
      setOccasion(occasion, value),
    onSuccess: (occasions) => {
      queries.setQueryData<PushOverview>(['push'], (old) => (old ? { ...old, occasions } : old))
    },
    onError: (error) => {
      setSaid({ tone: 'conflict', text: saidWhy(error, 'Das ließ sich nicht speichern.') })
    },
  })

  return {
    overview: overview.data,
    failedToLoad: overview.isError,
    blocker: pushBlocker(),
    here: onHere ? here : null,
    busy: on.isPending || off.isPending || test.isPending,
    said,
    turnOn: () => {
      setSaid(null)
      on.mutate()
    },
    turnOff: () => {
      setSaid(null)
      off.mutate()
    },
    test: () => {
      setSaid(null)
      test.mutate()
    },
    choose: (occasion, value) => {
      choose.mutate({ occasion, value })
    },
  }
}
