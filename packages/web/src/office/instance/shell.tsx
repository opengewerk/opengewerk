import { InstanceFrame } from '@opengewerk/platform-web/instance'
import type { InstanceEntry } from '@opengewerk/platform-web/instance'
import { History, House, Settings, Shield } from 'lucide-react'

/**
 * The screens of the area of the instance (#188), `INSTANCE_NAV` of the
 * canvas, by this application's words: the businesses on it, and the
 * operators for whoever runs it.
 */
const navigation: readonly InstanceEntry[] = [
  { to: '/instanz', label: 'Betriebe', icon: House },
  { to: '/instanz/einstellungen', label: 'Einstellungen', icon: Settings },
  { to: '/instanz/betreiber', label: 'Betreiber', icon: Shield },
  { to: '/instanz/protokoll', label: 'Protokoll', icon: History },
]

/**
 * The area of the instance in the office. Its frame is the foundation's
 * (ADR 0010); the router mounts this as the route over the screens of the
 * area, which are the foundation's as well, except for the log.
 */
export function InstanceShell() {
  return <InstanceFrame navigation={navigation} />
}
