import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  ServiceUnavailableException,
} from '@nestjs/common'

import { RequiresPermission } from '../api/authorization.js'
import { pick, requireFields } from '../api/body.js'
import { CurrentIdentity, type RequestIdentity } from '../api/identity.js'
import { Database } from '../database/database.js'
import { ACCESS_RULES, type AccessRules, accessRights } from './access.js'
import {
  changeRoles,
  devicesOf,
  type InvitationEntry,
  inviteStaff,
  type IssuedInvitation,
  listInvitations,
  listStaff,
  revokeDeviceOf,
  revokeInvitation,
  setBlocked,
  type StaffDevice,
  type StaffEntry,
} from './administration.js'
import { INVITATION_MAILING, type InvitationMailing } from './invitation-mailing.js'

/**
 * Who works in this tenant, for whoever administers it.
 *
 * Until #63 an account came into being only through `add-staff` on the command
 * line. For the very first one that was right: it has to exist before anybody
 * can sign in to create it. For everybody after that it was never a decision,
 * only something nobody had got to, and a tenant with a handful of people
 * does not open an SSH session to put somebody on holiday.
 *
 * Every route asks for `membership.read` or `membership.write`, which an
 * application gives to the role that leads a tenant and to no other:
 * somebody who can hand out roles can hand themselves the leading one, and a
 * right that whoever holds it can widen is not a boundary.
 *
 * Nothing here reaches past this tenant, and that is a property of how the
 * questions are asked rather than a rule somebody has to keep. See the note at
 * the top of `administration.ts`.
 */
@Controller('staff')
export class StaffController {
  constructor(
    private readonly database: Database,
    @Inject(ACCESS_RULES) private readonly access: AccessRules,
    @Inject(INVITATION_MAILING) private readonly mailing: InvitationMailing | null,
  ) {}

  @Get()
  @RequiresPermission(accessRights.read)
  list(@CurrentIdentity() identity: RequestIdentity): Promise<StaffEntry[]> {
    return listStaff(this.database, identity)
  }

  /**
   * Invites somebody, and hands back the link once, or sends it by mail.
   *
   * Passed on by hand, the token is in the answer and nowhere else:
   * what the database keeps is its hash. So this is the only moment it can be
   * shown, and the screen says so rather than offering it again later. The
   * address the link starts with is not put together here, the browser that
   * asked is looking at the instance already and knows it.
   *
   * Sent by mail (`send: "mail"`), the answer carries no token at all.
   * Whatever sends the message makes one at that moment and knows the address
   * its link starts with. Whoever invited sees the message under the
   * invitation, not the link.
   */
  @Post()
  @RequiresPermission(accessRights.write)
  async invite(
    @CurrentIdentity() identity: RequestIdentity,
    @Body() body: unknown,
  ): Promise<IssuedInvitation> {
    const values = pick(body, ['email', 'name', 'roles', 'send'] as const)

    requireFields(values, ['email', 'name'] as const)

    if (values.send !== undefined && values.send !== 'link' && values.send !== 'mail') {
      throw new BadRequestException('send ist "link" oder "mail".')
    }

    const byMail = values.send === 'mail'
    const sender = byMail ? (this.mailing?.sender ?? null) : null

    if (byMail && sender === null) {
      throw new ServiceUnavailableException(
        'Diese Instanz verschickt keine E-Mails, die Einladung lässt sich deshalb nicht per ' +
          'E-Mail schicken. Der Link zum Weitergeben geht trotzdem.',
      )
    }

    // Whether this tenant can send one at all, asked before there is an
    // invitation that would wait for a mail server nobody set up.
    await sender?.ready(identity)

    const issued = await inviteStaff(
      this.access,
      this.database,
      identity,
      {
        email: text(values.email, 'email'),
        name: text(values.name, 'name'),
        roles: rolesFrom(values.roles),
      },
      { byMail },
    )

    // Sent by mail, the invitation is handed to whatever sends it, which
    // makes the link at the moment the message leaves.
    await sender?.send(identity, issued.id)

    return issued
  }

  /** The links of this tenant that can still be used. */
  @Get('invitations')
  @RequiresPermission(accessRights.read)
  invitations(@CurrentIdentity() identity: RequestIdentity): Promise<InvitationEntry[]> {
    return listInvitations(this.database, identity, this.mailing)
  }

  /** Calls a link back, for the invitation that went to the wrong address. */
  @Delete('invitations/:invitationId')
  @RequiresPermission(accessRights.write)
  async withdraw(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('invitationId') invitationId: string,
  ): Promise<{ withdrawn: string }> {
    await revokeInvitation(this.database, identity, invitationId)

    return { withdrawn: invitationId }
  }

  /**
   * Changes what somebody may do here.
   *
   * The warning that a role brings a second factor with it belongs on the
   * screen and not here: by the time this route answers, the person already
   * has the role and would meet the wall at their next request. What this
   * route does is refuse to take away the last one who leads the tenant,
   * which is the half no screen can be trusted with.
   */
  @Patch(':userId')
  @RequiresPermission(accessRights.write)
  async setRoles(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<{ userId: string; roles: readonly string[] }> {
    const values = pick(body, ['roles'] as const)
    const roles = await changeRoles(
      this.access,
      this.database,
      identity,
      userId,
      rolesFrom(values.roles),
    )

    return { userId, roles }
  }

  /**
   * Shuts somebody out, and ends what they have open right now.
   *
   * A block and not a delete. A deleted account takes its name off everything
   * the person ever wrote, and an audit log pointing at an identifier nobody
   * can resolve is worse than one naming somebody who no longer works here.
   */
  @Put(':userId/block')
  @RequiresPermission(accessRights.write)
  async block(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('userId') userId: string,
  ): Promise<{ userId: string; blocked: true }> {
    await setBlocked(this.access, this.database, identity, userId, true)

    return { userId, blocked: true }
  }

  @Delete(':userId/block')
  @RequiresPermission(accessRights.write)
  async unblock(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('userId') userId: string,
  ): Promise<{ userId: string; blocked: false }> {
    await setBlocked(this.access, this.database, identity, userId, false)

    return { userId, blocked: false }
  }

  /** The devices this person is signed in on, in this tenant and no other. */
  @Get(':userId/devices')
  @RequiresPermission(accessRights.read)
  devices(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('userId') userId: string,
  ): Promise<StaffDevice[]> {
    return devicesOf(this.access, this.database, identity, userId)
  }

  /**
   * Cuts one of them off, for the phone that was stolen.
   *
   * The person whose phone it is can already do this from another device. This
   * is for the case where the phone was the other device.
   */
  @Delete(':userId/devices/:sessionId')
  @RequiresPermission(accessRights.write)
  async revoke(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('userId') userId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<{ revoked: string }> {
    await revokeDeviceOf(this.access, this.database, identity, userId, sessionId)

    return { revoked: sessionId }
  }
}

/** A field that has to be a non empty string. */
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException(`${field} fehlt oder ist kein Text.`)
  }

  return value.trim()
}

/**
 * The roles out of a body, as an array of strings and nothing else.
 *
 * Which of them exist is checked where the change happens, so that the answer
 * is the same whichever route asked and names the roles there are.
 */
function rolesFrom(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException('roles fehlt oder ist keine Liste.')
  }

  if (!value.every((role) => typeof role === 'string')) {
    throw new BadRequestException('roles enthält etwas, das kein Text ist.')
  }

  return value as readonly string[]
}
