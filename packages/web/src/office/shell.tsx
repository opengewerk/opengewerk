import { OfficeFrame } from '@opengewerk/platform-web/office'
import { useRouterState } from '@tanstack/react-router'

import { usePushRefresh } from '../app/push-state.js'
import { useNavigation } from './navigation.js'
import { BackupBar } from './screens/backup.js'

/**
 * The screens one works in rather than passes through: the structure of an
 * installation, electrical or PV (#300). From 1024 pixels they take the width
 * of the navigation and put their path into the header, as `structure_page()`
 * of the canvas does; narrower, nothing changes, the navigation is behind
 * "Menü" anyway.
 */
function isFocus(path: string): boolean {
  return ['/verteiler/', '/stromkreise/', '/wechselrichter/', '/strings/'].some((start) =>
    path.startsWith(start),
  )
}

/**
 * What every office screen sits in. The frame is the foundation's (ADR 0010):
 * the header in slate, the strips, the navigation beside the screen and
 * behind "Menü" on a phone. This application hands in what is its own: the
 * entries of its navigation, which screens are worked in rather than passed
 * through, and the strip for a backup that is behind, which stands with what
 * cannot wait, before the offers, as on the board "Leisten im Büro".
 */
export function OfficeShell() {
  const focus = isFocus(useRouterState({ select: (state) => state.location.pathname }))
  const navigation = useNavigation()

  usePushRefresh('office')

  return <OfficeFrame navigation={navigation} focus={focus} strips={<BackupBar />} />
}
