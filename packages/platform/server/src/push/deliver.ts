import type { PushPost } from './post.js'
import {
  encryptMessage,
  type SubscriptionKeys,
  vapidAuthorization,
  type VapidKeys,
} from './web-push.js'

/** What a device shows: a title, one line, where a tap leads, and the tag that replaces an older one. */
export interface PushMessage {
  readonly title: string
  readonly body: string
  readonly url: string
  readonly tag: string
}

/** What became of one attempt. */
export type Delivered =
  | { readonly kind: 'sent' }
  /**
   * The subscription is gone for good: the browser dropped it, or it was made
   * with another key than the one the instance signs with now. The device
   * subscribes again the next time the application is opened there.
   */
  | { readonly kind: 'gone'; readonly reason: string }
  | { readonly kind: 'retry'; readonly reason: string; readonly afterSeconds: number | null }
  | { readonly kind: 'refused'; readonly reason: string }

/** A "Retry-After" in seconds, from either of its two forms. */
function secondsOf(retryAfter: string | null, now: Date): number | null {
  if (retryAfter === null) {
    return null
  }

  if (/^\d+$/.test(retryAfter.trim())) {
    return Number(retryAfter.trim())
  }

  const at = Date.parse(retryAfter)

  return Number.isNaN(at) ? null : Math.max(0, Math.round((at - now.getTime()) / 1000))
}

/**
 * Sends one message to one device: encrypted for it (RFC 8291), signed for its
 * push service (RFC 8292), and read back from the status the service answers
 * with (RFC 8030). The message lives at the service for `ttlSeconds` if the
 * device is off, and not longer.
 */
export async function deliver(
  post: PushPost,
  device: SubscriptionKeys & { readonly endpoint: string },
  message: PushMessage,
  vapid: VapidKeys,
  now: Date,
  ttlSeconds: number,
): Promise<Delivered> {
  const body = encryptMessage(Buffer.from(JSON.stringify(message)), device)
  let answer

  try {
    answer = await post(
      device.endpoint,
      {
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(Math.max(0, Math.round(ttlSeconds))),
        Urgency: 'normal',
        Authorization: vapidAuthorization(device.endpoint, vapid, now),
      },
      body,
    )
  } catch (error) {
    return {
      kind: 'retry',
      reason: `Der Push-Dienst war nicht zu erreichen: ${error instanceof Error ? error.message : String(error)}`,
      afterSeconds: null,
    }
  }

  const { status } = answer

  if (status >= 200 && status < 300) {
    return { kind: 'sent' }
  }

  if (status === 404 || status === 410) {
    return { kind: 'gone', reason: 'Der Browser hat das Abonnement aufgegeben.' }
  }

  if (status === 401 || status === 403) {
    return {
      kind: 'gone',
      reason:
        'Der Push-Dienst nimmt die Signatur nicht an; das Abonnement wurde mit einem anderen ' +
        'Schlüssel angelegt.',
    }
  }

  if (status === 429 || status >= 500) {
    return {
      kind: 'retry',
      reason: `Der Push-Dienst antwortete mit ${String(status)}.`,
      afterSeconds: secondsOf(answer.retryAfter, now),
    }
  }

  return {
    kind: 'refused',
    reason: `Der Push-Dienst lehnte die Nachricht mit ${String(status)} ab.`,
  }
}
