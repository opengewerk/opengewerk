import { isAllowed, missingPermission, type Identity, type Permission } from '@opengewerk/domain'
import {
  type Authorization,
  RequiresPermission as requiresPermission,
} from '@opengewerk/platform-server'

import { operatorAccess } from '../instance/operators.js'

// The guard is the foundation's (ADR 0010): who is asking, in which business,
// and that a route without a declared right is refused. What a right is and
// who holds it is this application's, and this is where the two are bound.

export {
  AuthorizationGuard,
  OPERATOR_METADATA,
  PERMISSION_METADATA,
  PUBLIC_METADATA,
  PublicRoute,
  RequiresOperator,
  RequiresSession,
  SESSION_METADATA,
} from '@opengewerk/platform-server'

/**
 * The right a handler needs, as one of the rights of this application: a typo
 * in one is found by the compiler and not by a refused request.
 */
export const RequiresPermission = (permission: Permission) => requiresPermission(permission)

/** What the guard is told about this application. */
export const authorization: Authorization<Identity, Permission> = {
  isAllowed,
  missingPermission,
  // Who runs the instance is read from the area of the instance (#188), fresh
  // on every request.
  operatorAccess,
  sentences: {
    operatorsOnly: 'Diesen Bereich erreicht nur ein Betreiber der Instanz.',
    workingInAnotherTenant:
      'Diese Seite arbeitet noch in einem anderen Betrieb als die Anmeldung und lädt neu.',
  },
}
