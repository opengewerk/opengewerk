import type { PushPost } from './post.js'
import type { VapidKeys } from './web-push.js'

/** Where the routes of push get the key, the way out and, in the tests, a resolver of their own. */
export const PUSH = Symbol('Push')

/**
 * What push needs, from `VAPID_PRIVATE_KEY` and the network. Null on an
 * instance without a key: then it sends no push, and the routes say so.
 */
export interface PushContext {
  readonly vapid: VapidKeys
  readonly post: PushPost
  readonly resolve?: (host: string) => Promise<readonly string[]>
}
