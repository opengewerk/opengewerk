import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common'
import {
  accessRights,
  berlinClock,
  momentInGermany,
  type RoleDefinition,
  roleNamesOf,
  staffStateWords,
  staffTableColumns,
} from '@opengewerk/platform-domain'

import { RequiresPermission } from '../api/authorization.js'
import { pick, requireFields } from '../api/body.js'
import { CurrentIdentity, type RequestIdentity } from '../api/identity.js'
import { Database } from '../database/database.js'
import { tableAnswer, tableFormatOf } from '../tables/write.js'
import { ACCESS_RULES, type AccessRules } from './access.js'
import {
  changeRoles,
  correctAccount,
  type CorrectedAccount,
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
import { lastDayFrom } from './last-day.js'
import { rolesOfTenant } from './roles.js'

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
   * The accounts of the list as a table (opengewerk-haustechnik#236), as a
   * workbook or as text (`?format=xlsx` or `csv`): name and address, the
   * roles by the names of the tenant, what the application shows beside them,
   * whether somebody can work and when this tenant last saw them. For
   * whoever sees the list, which is whoever leads the tenant.
   */
  @Get('table')
  @RequiresPermission(accessRights.read)
  @Header('Cache-Control', 'no-store')
  async table(
    @CurrentIdentity() identity: RequestIdentity,
    @Query() query: Readonly<Record<string, unknown>>,
  ): Promise<StreamableFile> {
    const format = tableFormatOf(query)
    const people = await listStaff(this.database, identity)
    const beside = this.access.additions?.inTable ?? null
    const { roles, cells } = await this.database.forTenant(identity, async (tx) => ({
      roles: await rolesOfTenant(tx, identity.tenantId),
      cells:
        beside === null
          ? new Map<string, string>()
          : await beside.cells(
              tx,
              identity.tenantId,
              people.map((person) => person.userId),
            ),
    }))
    const columns = staffTableColumns

    return tableAnswer(
      {
        name: 'Zugänge',
        columns: [
          columns.access,
          columns.email,
          columns.role,
          ...(beside === null ? [] : [beside.title]),
          columns.state,
          columns.lastSeen,
        ],
        rows: people.map((person) => [
          person.name,
          person.email,
          roleNamesOf(person.roles, roles).join(', '),
          ...(beside === null ? [] : [cells.get(person.userId) ?? null]),
          staffStateWords(person, roles, momentInGermany, berlinClock(new Date()).day),
          person.lastSignInAt === null ? 'Noch nie' : momentInGermany(person.lastSignInAt),
        ]),
      },
      format,
      berlinClock(new Date()).day,
    )
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
   *
   * `additions` carries what the application keeps beside a membership, and
   * only the application reads it (`MembershipAdditions`).
   */
  @Post()
  @RequiresPermission(accessRights.write)
  async invite(
    @CurrentIdentity() identity: RequestIdentity,
    @Body() body: unknown,
  ): Promise<IssuedInvitation> {
    const values = pick(body, ['email', 'name', 'roles', 'send', 'additions', 'lastDay'] as const)

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
        additions: values.additions,
        lastDay: lastDayFrom(values.lastDay) ?? null,
      },
      { byMail },
    )

    // Sent by mail, the invitation is handed to whatever sends it, which
    // makes the link at the moment the message leaves.
    await sender?.send(identity, issued.id)

    return issued
  }

  /**
   * The roles this tenant has, in the order it made them: what a screen
   * offers when somebody is invited or given a role, what it calls them, and
   * which of them ask for a second factor.
   *
   * From the rows and not from a list in the code, for the reason the routes
   * beside this one check against the rows: a role is what the tenant has a
   * row for, and a screen that offered anything else would offer what the
   * server refuses.
   */
  @Get('roles')
  @RequiresPermission(accessRights.read)
  roles(@CurrentIdentity() identity: RequestIdentity): Promise<RoleDefinition[]> {
    return this.database.forTenant(identity, (tx) => rolesOfTenant(tx, identity.tenantId))
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
   *
   * `additions` carries what the application keeps beside a membership, as
   * with an invitation, and is written with the roles or not at all.
   */
  @Patch(':userId')
  @RequiresPermission(accessRights.write)
  async setRoles(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<{ userId: string; roles: readonly string[] }> {
    const values = pick(body, ['roles', 'additions', 'lastDay'] as const)
    const roles = await changeRoles(
      this.access,
      this.database,
      identity,
      userId,
      rolesFrom(values.roles),
      values.additions,
      lastDayFrom(values.lastDay),
    )

    return { userId, roles }
  }

  /**
   * Corrects the name or the address of somebody's account, either or both.
   *
   * A route of its own beside the roles, because it writes something else:
   * the account, which is the instance's, and not the membership. It answers
   * with what the account is called now, and refuses for an account that is
   * not this tenant's alone (`correctAccount`).
   */
  @Patch(':userId/account')
  @RequiresPermission(accessRights.write)
  async correct(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<{ userId: string } & CorrectedAccount> {
    const values = pick(body, ['name', 'email'] as const)
    const account = await correctAccount(this.access, this.database, identity, userId, {
      ...(values.name === undefined ? {} : { name: written(values.name, 'name') }),
      ...(values.email === undefined ? {} : { email: written(values.email, 'email') }),
    })

    return { userId, ...account }
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
 * A field that has to be a string, empty or not. What an empty one means is
 * said where the change happens, in the words for that field.
 */
function written(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} ist kein Text.`)
  }

  return value
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
