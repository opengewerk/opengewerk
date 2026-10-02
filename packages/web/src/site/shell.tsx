import { SiteFrame } from '@opengewerk/platform-web/site'
import type { SiteTab } from '@opengewerk/platform-web/site'
import { Calendar, Clock, ScanLine } from 'lucide-react'

import { usePushRefresh } from '../app/push-state.js'
import { SitePush } from './push.js'
import { StopwatchBar } from './screens/time.js'

/**
 * The places of the site, as on the boards. "Aufträge" stays lit on every
 * screen of a job, which is where the way back leads, and "Scannen" on the
 * installation a QR label opened and below it (#308). Everybody records their
 * own time, so "Zeiten" is there for every role. The conflicts and the menu
 * the frame adds itself.
 */
const tabs: readonly SiteTab[] = [
  { to: '/', label: 'Aufträge', icon: Calendar, also: ['/auftraege'] },
  { to: '/scannen', label: 'Scannen', icon: ScanLine, also: ['/anlagen'] },
  { to: '/zeiten', label: 'Zeiten', icon: Clock },
]

/**
 * What every screen on site sits in. The frame is the foundation's (ADR
 * 0010): the strips, the header of a screen, the tabs where the thumb is and
 * the menu. This application hands in what is its own: its places, the
 * stopwatch, which runs under the header on every screen, as the boards on
 * the page "Baustelle" draw it, and push on this device in the menu (#284).
 */
export function SiteShell() {
  usePushRefresh('site')

  return <SiteFrame tabs={tabs} underHeader={<StopwatchBar />} menu={<SitePush />} />
}
