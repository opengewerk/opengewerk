import type { Provider, Type } from '@nestjs/common'

import { AUTHENTICATION, SETUP_CODE } from '../api/handed-in.js'
import { ACCOUNT_MESSAGES, type AccountMessages } from '../instance/account-mail.js'
import { INSTANCE_SETTINGS, InstanceController } from '../instance/instance.controller.js'
import { LegalTextsController } from '../instance/legal-texts.controller.js'
import type { InstanceSettingsCache } from '../instance/settings.js'
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
   * of a one time link, the count of the recovery codes and, unless
   * `legalTexts` says otherwise, the legal texts for anybody. Left out, these
   * controllers are not registered and their routes do not exist: a
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
  /**
   * The settings of the instance in memory (#188), where the application
   * keeps them there. A change made in the area of the instance then reaches
   * whatever reads them at once. Left out, the area reads and writes the
   * database and nothing is refreshed.
   */
  readonly instanceSettings?: InstanceSettingsCache | null | undefined
  /**
   * The words of the application for the mails to an account
   * (`account-mail.ts`), the same it hands the authentication. The area of
   * the instance tells whoever leads a tenant in them of a change of the mail
   * server of the instance (opengewerk-haustechnik#360). Not optional, so that
   * no application leaves them out by accident: one that sends no mail says
   * null, and then only the log of every tenant is told.
   */
  readonly accountMessages: AccountMessages | null
  /**
   * Whether the legal texts of the instance are handed out to anybody
   * (opengewerk-haustechnik#129). Left out, they are wherever the
   * authentication is handed in, and on a closed instance not. A preview,
   * which signs everybody in without the authentication and shows the page
   * of the texts all the same, says yes.
   */
  readonly legalTexts?: boolean | undefined
}

/**
 * The controllers of the authentication and of the area of the instance, and
 * what they are handed, for the module of an application.
 *
 * A function and not a module of its own, because the guard, the database and
 * the identity source are the application's to register, once, and a module
 * beside it would have to be handed all three again.
 */
export function authenticationParts(parts: AuthenticationParts): {
  readonly controllers: Type<unknown>[]
  readonly providers: Provider[]
} {
  const {
    access,
    authentication,
    setupCode = null,
    invitationMailing = null,
    instanceSettings = null,
    accountMessages,
    legalTexts = authentication !== undefined,
  } = parts

  return {
    controllers: [
      // The first two answer without an identity. All three need the
      // authentication handed in and are left out on a closed instance.
      ...(authentication ? [SetupController, InvitationController, RecoveryCodesController] : []),
      // The legal texts of the instance answer without an identity as well,
      // for the foot of the sign in (opengewerk-haustechnik#129), and are
      // left out on a closed instance with the others.
      ...(legalTexts ? [LegalTextsController] : []),
      // What lives between signing in and working, the passkeys of the
      // account, who works in a tenant, and the area of the instance. Behind
      // the guard, so a closed instance answers them with 401.
      AuthenticationController,
      PasskeysController,
      StaffController,
      InstanceController,
    ],
    providers: [
      { provide: ACCESS_RULES, useValue: access },
      { provide: INVITATION_MAILING, useValue: invitationMailing },
      { provide: INSTANCE_SETTINGS, useValue: instanceSettings },
      { provide: ACCOUNT_MESSAGES, useValue: accountMessages },
      ...(authentication
        ? [
            { provide: AUTHENTICATION, useValue: authentication },
            { provide: SETUP_CODE, useValue: setupCode },
          ]
        : []),
    ],
  }
}
