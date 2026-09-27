import type { PushEntry } from '@opengewerk/domain'

import {
  type BrowserSubscription,
  pushOverview,
  subscribeDevice,
  unsubscribeDevice,
} from '../session/push.js'
import { deviceName } from './devices.js'

/**
 * Push in this browser (#284): whether it can take messages, asking for them,
 * and the subscription at the browser's push service.
 *
 * The browser holds the subscription and the server the row that says whom it
 * belongs to. Both are kept in step from here: switched on, the row is written
 * after the browser subscribed; switched off or signed out, the browser drops
 * its subscription and the row goes; and at every start with push on the row
 * is written again, which binds it to the session this device is signed in
 * with now and notices a key that changed on the server.
 */

/** What stands between this browser and a push message, or null when nothing does. */
export type PushBlocker =
  /** The browser has no Push API, or no service worker is running here. */
  | 'unsupported'
  /** An iPhone or iPad in the browser: push arrives only for the installed app there. */
  | 'install'
  /** Notifications for this site were refused, which only the browser's settings undo. */
  | 'denied'

/** How long the service worker may take to be there before this browser counts as without one. */
const workerWaitMs = 4_000

/** Whether this is an iPhone or iPad, including an iPad that says it is a Mac. */
function onApplesPhone(): boolean {
  const agent = navigator.userAgent

  return (
    /iPhone|iPad|iPod/.test(agent) || (agent.includes('Macintosh') && navigator.maxTouchPoints > 1)
  )
}

/** Whether OpenGewerk runs as an installed app rather than in a tab of the browser. */
function installed(): boolean {
  return (
    globalThis.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** What keeps this browser from push, before anybody has pressed anything. */
export function pushBlocker(): PushBlocker | null {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return 'unsupported'
  }

  if (!('PushManager' in globalThis) || !('Notification' in globalThis)) {
    return onApplesPhone() && !installed() ? 'install' : 'unsupported'
  }

  if (onApplesPhone() && !installed()) {
    return 'install'
  }

  if (Notification.permission === 'denied') {
    return 'denied'
  }

  return null
}

/** The service worker's registration, or null when none comes in time; in development there is none. */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    return null
  }

  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => {
      setTimeout(() => {
        resolve(null)
      }, workerWaitMs)
    }),
  ])
}

/** The bytes of a key in base64url, in a buffer of their own as `subscribe` wants it. */
function bytesOf(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const text = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(new ArrayBuffer(text.length))

  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index)
  }

  return bytes
}

/** Whether a subscription was made with this public key, and messages signed with it arrive. */
function madeWith(subscription: PushSubscription, publicKey: string): boolean {
  const key = subscription.options.applicationServerKey

  if (!key) {
    return false
  }

  const have = new Uint8Array(key)
  const want = bytesOf(publicKey)

  return have.length === want.length && have.every((byte, index) => byte === want[index])
}

function asBrowserSubscription(subscription: PushSubscription): BrowserSubscription {
  const json = subscription.toJSON()

  return {
    endpoint: json.endpoint ?? subscription.endpoint,
    keys: { p256dh: json.keys?.['p256dh'] ?? '', auth: json.keys?.['auth'] ?? '' },
  }
}

/** The subscription this browser holds now, or null. */
export async function browserSubscription(): Promise<PushSubscription | null> {
  if (pushBlocker() === 'unsupported') {
    return null
  }

  const registered = await registration()

  return registered ? registered.pushManager.getSubscription() : null
}

export class PushRefused extends Error {}

/**
 * Switches push on here: asks the browser, subscribes with the server's key
 * and writes the row. A subscription made with another key is dropped first,
 * because messages signed with the new one would not arrive through it.
 */
export async function switchOn(publicKey: string, entry: PushEntry): Promise<string> {
  const blocker = pushBlocker()

  if (blocker === 'unsupported' || blocker === 'install') {
    throw new PushRefused(
      blocker === 'install'
        ? 'Auf dem iPhone und dem iPad kommen Push-Nachrichten nur, wenn OpenGewerk als App installiert ist.'
        : 'Dieser Browser kann keine Push-Nachrichten empfangen.',
    )
  }

  if ((await Notification.requestPermission()) !== 'granted') {
    throw new PushRefused(
      'Der Browser hat Benachrichtigungen für diese Seite nicht erlaubt. Erlauben lassen sie sich in seinen Einstellungen zu dieser Seite.',
    )
  }

  const registered = await registration()

  if (!registered) {
    throw new PushRefused(
      'OpenGewerk läuft in diesem Browser nicht als App, ohne die kommen keine Push-Nachrichten. Ein Neuladen der Seite hilft meist.',
    )
  }

  let subscription = await registered.pushManager.getSubscription()

  if (subscription && !madeWith(subscription, publicKey)) {
    await subscription.unsubscribe()
    subscription = null
  }

  subscription ??= await registered.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: bytesOf(publicKey),
  })

  const { id } = await subscribeDevice(
    asBrowserSubscription(subscription),
    entry,
    deviceName(navigator.userAgent),
  )

  return id
}

/** Switches push off here: the row goes, then the browser's subscription. */
export async function switchOff(id: string | null): Promise<void> {
  if (id !== null) {
    await unsubscribeDevice(id)
  }

  const subscription = await browserSubscription()

  await subscription?.unsubscribe()
}

/**
 * At every start with push on: writes the row again, bound to the session of
 * now, and subscribes anew where the server's key changed. Quiet by design:
 * whatever fails here is tried again at the next start, and nobody waits for
 * it.
 */
export async function refreshPush(entry: PushEntry): Promise<void> {
  if (pushBlocker() !== null || Notification.permission !== 'granted') {
    return
  }

  const subscription = await browserSubscription()

  if (!subscription) {
    return
  }

  const overview = await pushOverview()

  if (!overview.available || overview.publicKey === null) {
    return
  }

  if (madeWith(subscription, overview.publicKey)) {
    await subscribeDevice(
      asBrowserSubscription(subscription),
      entry,
      deviceName(navigator.userAgent),
    )
  } else {
    await subscription.unsubscribe()
    await switchOn(overview.publicKey, entry)
  }
}

/**
 * Before signing out: the row of this device goes while there is still a
 * session to ask with, and the browser drops its subscription, so that the
 * next person on this device gets nothing of the last one's. Never in the way
 * of signing out: whatever fails, the session ends all the same, and the
 * server sends nothing to a device whose session is gone.
 */
export async function leavePush(): Promise<void> {
  const subscription = await browserSubscription()

  if (!subscription) {
    return
  }

  const mine = (await pushOverview()).devices.find((device) => device.thisSession)

  if (mine) {
    await unsubscribeDevice(mine.id)
  }

  await subscription.unsubscribe()
}
