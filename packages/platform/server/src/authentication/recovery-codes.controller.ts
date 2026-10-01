import { Controller, Get, Inject } from '@nestjs/common'

import { RequiresSession } from '../api/authorization.js'
import { AUTHENTICATION } from '../api/handed-in.js'
import { CurrentUser, type SignedInUser } from '../api/identity.js'
import type { Authentication } from './authentication.js'

/**
 * How many recovery codes an account has left (#125).
 *
 * Redeeming one and making new ones are better-auth's routes,
 * `/two-factor/verify-backup-code` and `/two-factor/generate-backup-codes`.
 * What it does not say over HTTP is how many are left, and that is the one
 * thing somebody needs to know after using one: the codes are the way in when
 * the phone is gone, and ten that quietly became one are a way in that is
 * about to close.
 *
 * The number and not the codes. They were shown once, when they were made,
 * and a route that handed them out again would turn a session somebody left
 * open into the way past the second factor for good.
 *
 * Registered only while the instance is open, like everything that needs the
 * authentication handed in.
 */
@Controller('auth/recovery-codes')
export class RecoveryCodesController {
  constructor(@Inject(AUTHENTICATION) private readonly authentication: Authentication) {}

  /** `null` for an account without a second factor, which has no codes at all. */
  @Get()
  @RequiresSession()
  async left(@CurrentUser() user: SignedInUser): Promise<{ readonly left: number | null }> {
    try {
      const { backupCodes } = await this.authentication.api.viewBackupCodes({
        body: { userId: user.userId },
      })

      return { left: backupCodes.length }
    } catch {
      return { left: null }
    }
  }
}
