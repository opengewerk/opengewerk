import type { Id, Label, Synced } from '@opengewerk/platform-domain'
import type { InstallationId } from './identifier.js'

export type InstallationLabelId = Id<'installation-label'>

/**
 * The QR label of an installation (#308): a sticker in the meter cabinet or on
 * the inverter whose scan opens the installation.
 *
 * What a label is, its code, its address and how it is printed, is the
 * foundation's (`Label` and what stands beside it there). Here is what it
 * hangs on: an installation has at most one valid label, printed as often as
 * it is needed; a blocked one opens nothing any more, in the app or in the
 * browser, and stays as a row so that the app can say so.
 *
 * Made and blocked at a route of the office, never changed otherwise; a device
 * reads them to open an installation by its label without a network.
 */
export interface InstallationLabel extends Synced, Label {
  readonly id: InstallationLabelId
  readonly installationId: InstallationId
}
