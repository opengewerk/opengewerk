import { Controller, Get, Inject, NotFoundException, Optional, Param, Post } from '@nestjs/common'

import { PublicRoute } from '../api/authorization.js'
import { Database } from '../database/database.js'
import { ACCOUNT_MESSAGES, type AccountMessages, accountMails } from '../instance/account-mail.js'
import { MAIL, type MailContext } from '../mail/context.js'
import { type AddressOffer, addressOfferOf, confirmAddress } from './address-confirmation.js'
import { looksLikeAToken } from './invitation.js'

/**
 * The far end of the link in the mail to an address (N28 of the security
 * audit, opengewerk#754).
 *
 * Public, like the invitation, because the link may be opened on any device
 * and signed in as nobody, and registered only where the authentication is,
 * like the invitation: a closed instance has no way in that needs no
 * identity. What stands in for one is the token, 32 random bytes in a mail to
 * that address and nowhere else, good once and for a day.
 *
 * The page shows the address before anything is confirmed, and confirms only
 * on the button: a scanner of mails that opens every link confirms nothing by
 * itself.
 */
@Controller('auth/address')
export class AddressController {
  constructor(
    private readonly database: Database,
    @Optional() @Inject(MAIL) private readonly mail?: MailContext | null,
    @Optional() @Inject(ACCOUNT_MESSAGES) private readonly messages?: AccountMessages | null,
  ) {}

  @Get(':token')
  @PublicRoute()
  offer(@Param('token') token: string): Promise<AddressOffer> {
    if (!looksLikeAToken(token)) {
      return Promise.resolve({ state: 'gone', name: '', email: '' })
    }

    return addressOfferOf(this.database, token)
  }

  @Post(':token')
  @PublicRoute()
  async confirm(
    @Param('token') token: string,
  ): Promise<{ readonly email: string; readonly changed: boolean }> {
    if (!looksLikeAToken(token)) {
      throw new NotFoundException()
    }

    return confirmAddress(
      this.database,
      this.mail && this.messages
        ? accountMails(this.database, this.mail, this.messages).addressMail
        : null,
      token,
    )
  }
}
