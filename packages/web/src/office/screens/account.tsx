import {
  AccountScreen as Account,
  PushPanel,
  type PushPanelWords,
} from '@opengewerk/platform-web/office'

import { BusinessesPanel } from './account-businesses.js'

/** What this application says on the card "Benachrichtigungen" of the foundation. */
const pushWords: PushPanelWords = {
  about:
    'Push-Nachrichten kommen auch, wenn OpenGewerk geschlossen ist. Sie sagen nur, was ansteht; ' +
    'Namen und Anschriften stehen erst in OpenGewerk.',
  keyMissing: 'Der Betreiber bekommt ihn mit dem nächsten Start über „sh docker/start.sh“.',
  footnote:
    'Auf dem iPhone und dem iPad kommen Push-Nachrichten nur, wenn OpenGewerk über „Zum ' +
    'Home-Bildschirm“ als App installiert ist.',
}

/**
 * "Konto" in the office. The screen is the foundation's (ADR 0010): light or
 * dark, the second factor, the passkeys, the password and the devices somebody
 * is signed in on. This application adds two cards between the passkeys and
 * the password, as the board "Konto" draws them: the businesses somebody
 * works in, with a further one for an owner (#142, #242), which is its own,
 * and push on this device (#284), which is the foundation's and says here
 * what only this application knows.
 */
export function AccountScreen() {
  return (
    <Account>
      <BusinessesPanel />
      <PushPanel entry="office" words={pushWords} />
    </Account>
  )
}
