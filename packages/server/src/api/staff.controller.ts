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
import type { RoleKey } from '@opengewerk/domain'

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
} from '../authentication/administration.js'
import { Database } from '../database/database.js'
import { requireMailServer } from '../mail/server-settings.js'
import { notify } from '../notifications/notify.js'
import { RequiresPermission } from './authorization.js'
import { pick, requireFields } from './body.js'
import { MAIL, type MailContext } from './handed-in.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/**
 * Who works in this business, for the office.
 *
 * Until #63 an account came into being only through `add-staff` on the command
 * line. For the very first owner that is still right and stays: they have to
 * exist before anybody can sign in to create them. For everybody after that it
 * was never a decision, only something nobody had got to, and a pilot with one
 * office worker and one technician does not open an SSH session to put
 * somebody on holiday.
 *
 * Every route asks for `membership.read` or `membership.write`, which only the
 * owner has. Not the office, although this screen lives in the office
 * application: somebody who can hand out roles can hand themselves the owner
 * role, and a right that whoever holds it can widen is not a boundary.
 *
 * Nothing here reaches past this business, and that is a property of how the
 * questions are asked rather than a rule somebody has to keep. See the note at
 * the top of `administration.ts`.
 */
@Controller('staff')
export class StaffController {
  constructor(
    private readonly database: Database,
    @Inject(MAIL) private readonly mail: MailContext | null,
  ) {}

  @Get()
  @RequiresPermission('membership.read')
  list(@CurrentIdentity() identity: RequestIdentity): Promise<StaffEntry[]> {
    return listStaff(this.database, identity)
  }

  /**
   * Invites somebody, and hands back the link once, or sends it by mail.
   *
   * Passed on by the office, the token is in the answer and nowhere else:
   * what the database keeps is its hash. So this is the only moment it can be
   * shown, and the screen says so rather than offering it again later. The
   * address the link starts with is not put together here, the browser that
   * asked is looking at the instance already and knows it.
   *
   * Sent by mail (`send: "mail"`), the answer carries no token at all. The job
   * that sends the message makes one at that moment, and the link in the mail
   * starts with the first trusted origin, like every link in a message. The
   * office sees the message under the invitation, not the link.
   */
  @Post()
  @RequiresPermission('membership.write')
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

    if (byMail && this.mail === null) {
      throw new ServiceUnavailableException(
        'Diese Instanz verschickt keine E-Mails, die Einladung lässt sich deshalb nicht per ' +
          'E-Mail schicken. Der Link zum Weitergeben geht trotzdem.',
      )
    }

    if (byMail) {
      await requireMailServer(this.database, identity)
    }

    const issued = await inviteStaff(
      this.database,
      identity,
      {
        email: text(values.email, 'email'),
        name: text(values.name, 'name'),
        roles: rolesFrom(values.roles),
      },
      { byMail },
    )

    // Sent by mail, the invitation is a cause like a due task: the message is
    // written now and goes out with the job, which makes the link as it sends.
    if (byMail && this.mail !== null) {
      await notify(
        this.database,
        identity.tenantId,
        { kind: 'invitation', invitationId: issued.id, requestedBy: identity.userId },
        { origin: this.mail.origin },
      )
    }

    return issued
  }

  /** The links of this business that can still be used. */
  @Get('invitations')
  @RequiresPermission('membership.read')
  invitations(@CurrentIdentity() identity: RequestIdentity): Promise<InvitationEntry[]> {
    return listInvitations(this.database, identity)
  }

  /** Calls a link back, for the invitation that went to the wrong address. */
  @Delete('invitations/:invitationId')
  @RequiresPermission('membership.write')
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
   * The warning that the owner role brings a second factor with it belongs on
   * the screen and not here: by the time this route answers, the person has
   * already been made an owner and would meet the wall at their next request.
   * What this route does is refuse to take the last owner away, which is the
   * half no screen can be trusted with.
   */
  @Patch(':userId')
  @RequiresPermission('membership.write')
  async setRoles(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<{ userId: string; roles: readonly RoleKey[] }> {
    const values = pick(body, ['roles'] as const)
    const roles = await changeRoles(this.database, identity, userId, rolesFrom(values.roles))

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
  @RequiresPermission('membership.write')
  async block(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('userId') userId: string,
  ): Promise<{ userId: string; blocked: true }> {
    await setBlocked(this.database, identity, userId, true)

    return { userId, blocked: true }
  }

  @Delete(':userId/block')
  @RequiresPermission('membership.write')
  async unblock(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('userId') userId: string,
  ): Promise<{ userId: string; blocked: false }> {
    await setBlocked(this.database, identity, userId, false)

    return { userId, blocked: false }
  }

  /** The devices this person is signed in on, in this business and no other. */
  @Get(':userId/devices')
  @RequiresPermission('membership.read')
  devices(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('userId') userId: string,
  ): Promise<StaffDevice[]> {
    return devicesOf(this.database, identity, userId)
  }

  /**
   * Cuts one of them off, for the phone in the van that was broken into.
   *
   * The person whose phone it is can already do this from another device. This
   * is for the case where the phone was the other device.
   */
  @Delete(':userId/devices/:sessionId')
  @RequiresPermission('membership.write')
  async revoke(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('userId') userId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<{ revoked: string }> {
    await revokeDeviceOf(this.database, identity, userId, sessionId)

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
function rolesFrom(value: unknown): readonly RoleKey[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException('roles fehlt oder ist keine Liste.')
  }

  if (!value.every((role) => typeof role === 'string')) {
    throw new BadRequestException('roles enthält etwas, das kein Text ist.')
  }

  return value as readonly RoleKey[]
}
