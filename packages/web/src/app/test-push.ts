import { vi } from 'vitest'

/**
 * A browser that can take push, for the tests of "Konto" and the menu of the
 * site (#284): its permission, its service worker and its push manager, with
 * or without a subscription.
 */
export function fakePushBrowser(state: {
  readonly subscribed: boolean
  readonly permission?: NotificationPermission
}) {
  let subscribed = state.subscribed
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    options: { applicationServerKey: null },
    toJSON: () => ({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'BPublic', auth: 'Secret' },
    }),
    unsubscribe: vi.fn(() => {
      subscribed = false

      return Promise.resolve(true)
    }),
  }
  const registration = {
    pushManager: {
      getSubscription: () => Promise.resolve(subscribed ? subscription : null),
      subscribe: vi.fn(() => {
        subscribed = true

        return Promise.resolve(subscription)
      }),
    },
  }

  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve(registration) },
    configurable: true,
  })
  vi.stubGlobal('PushManager', class {})
  vi.stubGlobal('Notification', {
    permission: state.permission ?? (state.subscribed ? 'granted' : 'default'),
    requestPermission: vi.fn(() => Promise.resolve('granted')),
  })

  return { registration, subscription }
}

/** Takes the browser of `fakePushBrowser` away again. */
export function forgetPushBrowser(): void {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'serviceWorker')
}
