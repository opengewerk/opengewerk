import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
} from '@nestjs/common'
import { type PasskeyEntry, passkeyNameProblem } from '@opengewerk/domain'
import { Database, pick } from '@opengewerk/platform-server'

import { RequiresSession } from '../api/authorization.js'
import { CurrentUser, type SignedInUser } from '../api/identity.js'
import { passkeysOf, removePasskey, renamePasskey } from './passkeys.js'

/** One answer for a passkey that is not there and one that is somebody else's. */
const notFound = 'Diesen Passkey gibt es für dieses Konto nicht.'

/**
 * The passkeys of the signed in account under "Konto" (#167, #248).
 *
 * Here and not in better-auth's plugin, which has routes for the same three
 * things and has them switched off (`authentication.ts`): a change to a
 * passkey belongs in the log of every business the account works in, and
 * only this side of the server can write there. Each route works on the
 * account of the session and on nothing else, so nobody lists, renames or
 * deletes a passkey of somebody else, whatever key they send.
 *
 * `@RequiresSession` and no right, like the rest of what belongs to an
 * account rather than a business: the passkeys are the person's own, whatever
 * their roles.
 */
@Controller('auth/passkeys')
export class PasskeysController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresSession()
  list(@CurrentUser() user: SignedInUser): Promise<PasskeyEntry[]> {
    return passkeysOf(this.database, user.userId)
  }

  @Patch(':passkeyId')
  @RequiresSession()
  async rename(
    @CurrentUser() user: SignedInUser,
    @Param('passkeyId') passkeyId: string,
    @Body() body: unknown,
  ): Promise<{ id: string; name: string }> {
    const { name } = pick(body, ['name'] as const)
    const wanted = typeof name === 'string' ? name : ''
    const problem = passkeyNameProblem(wanted)

    if (problem) {
      throw new BadRequestException(problem)
    }

    const renamed = await renamePasskey(this.database, user.userId, passkeyId, wanted.trim())

    if (!renamed) {
      throw new NotFoundException(notFound)
    }

    return renamed
  }

  @Delete(':passkeyId')
  @RequiresSession()
  async remove(
    @CurrentUser() user: SignedInUser,
    @Param('passkeyId') passkeyId: string,
  ): Promise<{ removed: string }> {
    const removed = await removePasskey(this.database, user.userId, passkeyId)

    if (!removed) {
      throw new NotFoundException(notFound)
    }

    return { removed: removed.id }
  }
}
