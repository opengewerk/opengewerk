import type { Provider, Type } from '@nestjs/common'

import { AUTHENTICATION, SETUP_CODE } from '../api/handed-in.js'
import { ACCESS_RULES, type AccessRules } from './access.js'
import type { Authentication } from './authentication.js'
import { AuthenticationController } from './authentication.controller.js'
import { InvitationController } from './invitation.controller.js'
import { INVITATION_MAILING, type InvitationMailing } from './invitation-mailing.js'
import { PasskeysController } from './passkeys.controller.js'
import { RecoveryCodesController } from './recovery-codes.controller.js'
import { SetupController } from './setup.controller.js'
import { StaffController } from './staff.controller.js'

/** What the authentication needs from the module of an application. */
export interface AuthenticationParts {
  /** The roles and the words of the application. */
  readonly access: AccessRules
  /**
   * The authentication handle, handed in only while the instance is open.
   * That is what switches the ways in on: the first run setup, the redemption
   * of a one time link, and the count of the recovery codes. Left out, the
   * three controllers are not registered and their routes do not exist: a
   * closed instance hands out nothing, and a way in that stayed open during a
   * restore would take the meaning out of closing it.
   */
  readonly authentication?: Authentication | undefined
  /**
   * The code the first run asks for (#215). Left out, an empty instance cannot
   * be set up at all: the first run is refused with the sentence saying how
   * to get one. Only read where the authentication is handed in.
   */
  readonly setupCode?: string | null | undefined
  /**
   * How this application sends an invitation by mail. Left out, an invitation
   * is handed over as a link and a wish for a mail is refused with the
   * sentence saying so.
   */
  readonly invitationMailing?: InvitationMailing | null | undefined
}

/**
 * The controllers of the authentication and what they are handed, for the
 * module of an application.
 *
 * A function and not a module of its own, because the guard, the database and
 * the identity source are the application's to register, once, and a module
 * beside it would have to be handed all three again.
 */
export function authenticationParts(parts: AuthenticationParts): {
  readonly controllers: Type<unknown>[]
  readonly providers: Provider[]
} {
  const { access, authentication, setupCode = null, invitationMailing = null } = parts

  return {
    controllers: [
      // The first two answer without an identity. All three need the
      // authentication handed in and are left out on a closed instance.
      ...(authentication ? [SetupController, InvitationController, RecoveryCodesController] : []),
      // What lives between signing in and working, the passkeys of the
      // account, and who works in a tenant. Behind the guard, so a closed
      // instance answers them with 401.
      AuthenticationController,
      PasskeysController,
      StaffController,
    ],
    providers: [
      { provide: ACCESS_RULES, useValue: access },
      { provide: INVITATION_MAILING, useValue: invitationMailing },
      ...(authentication
        ? [
            { provide: AUTHENTICATION, useValue: authentication },
            { provide: SETUP_CODE, useValue: setupCode },
          ]
        : []),
    ],
  }
}
