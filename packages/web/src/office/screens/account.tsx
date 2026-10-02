import { AccountScreen as Account } from '@opengewerk/platform-web/office'

import { BusinessesPanel } from './account-businesses.js'
import { PushPanel } from './account-push.js'

/**
 * "Konto" in the office. The screen is the foundation's (ADR 0010): light or
 * dark, the second factor, the passkeys, the password and the devices somebody
 * is signed in on. This application adds its own two cards between the
 * passkeys and the password, as the board "Konto" draws them: the businesses
 * somebody works in, with a further one for an owner (#142, #242), and push on
 * this device (#284).
 */
export function AccountScreen() {
  return (
    <Account>
      <BusinessesPanel />
      <PushPanel />
    </Account>
  )
}
