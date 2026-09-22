import { Controller, Get, Inject } from '@nestjs/common'

import { RequiresPermission } from './authorization.js'
import { MAIL, type MailSettings } from './handed-in.js'

/** What the screen shows about the mail of this instance. */
export interface MailStatus {
  /** Whether a mail server is set up. Without one nothing is sent. */
  readonly configured: boolean
  /** The address messages leave from, when there is one. */
  readonly from: string | null
}

/**
 * Whether this instance sends mail, for the screen "E-Mail" in the office.
 *
 * Read only, and nothing more than the sender. The mail server is set up in
 * the .env of the instance, by whoever runs it; its name, its port and its
 * login are the operator's business and do not reach a browser.
 */
@Controller('settings/mail')
export class MailSettingsController {
  constructor(@Inject(MAIL) private readonly mail: MailSettings | null) {}

  @Get()
  @RequiresPermission('settings.read')
  status(): MailStatus {
    return this.mail === null
      ? { configured: false, from: null }
      : { configured: true, from: this.mail.from }
  }
}
