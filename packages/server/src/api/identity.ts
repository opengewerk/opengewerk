import type { Identity, Permission } from '@opengewerk/domain'
import type * as platform from '@opengewerk/platform-server'

// The identity of a request is the foundation's (ADR 0010): where it comes
// from, where the guard puts it and how a handler reads it. Bound here to what
// this application knows about somebody: the roles of the membership, and a
// reason that is one of its own rights. So a handler names one module and gets
// the types of this application.

export {
  CurrentIdentity,
  CurrentUser,
  IDENTITY_SOURCE,
  identityProperty,
  type SignedInUser,
  userProperty,
} from '@opengewerk/platform-server'

/**
 * An identity as a source finds it, with the session it came from where there
 * is one. The session is what a device is signed in with, so that something
 * bound to it, a push subscription (#284), ends when the device is signed out.
 * The preview and the tests have none.
 *
 * `deviceId` is the device the session was signed in on, as it named itself
 * when it chose the business, and not what a request says about itself: the
 * value of a way into a site is handed to a device and a showing is taken
 * from the device that held it, both measured by this (#286).
 */
export type FoundIdentity = platform.FoundIdentity<Identity>

/** Where an identity comes from, see the foundation; here with the roles of this application. */
export type IdentitySource = platform.IdentitySource<Identity>

/**
 * The identity, plus what this request is about to do: the right the route
 * declared. A reason a person types ("Storno wegen Zahlendreher") is a better
 * answer to the same question and belongs to the screen that asks for it,
 * which does not exist yet.
 */
export type RequestIdentity = platform.RequestIdentity<Identity, Permission>

export interface RequestWithIdentity {
  opengewerkIdentity?: RequestIdentity
  opengewerkUser?: platform.SignedInUser
}
