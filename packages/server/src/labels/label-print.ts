import type { LabelFormat } from '@opengewerk/domain'
import { type LabelFace, labelPrintJob, type PrintJob } from '@opengewerk/platform-server'

/**
 * The QR label of an installation as it is printed (#308): the QR code at the
 * left, the business, the installation, its site and the code of the label at
 * the right. The page itself is the foundation's (`labelPrintJob`); here is
 * what the three lines of an installation's label say.
 */
export interface InstallationLabelPrint {
  /** Who keeps the installation: the name on the documents, or the business. */
  readonly business: string
  readonly installation: string
  /** The site as a short line, `Rheinstraße 12`, or null. */
  readonly site: string | null
  readonly code: string
  /** The address of the instance the QR points to. */
  readonly origin: string
  readonly format: LabelFormat
  /** How often the one label is printed. */
  readonly count: number
  /** The first free field of a sheet, counted from 1; always 1 on a roll. */
  readonly start: number
}

/** The print job for the renderer: the one label, `count` times. */
export function installationLabelPrintJob(print: InstallationLabelPrint): PrintJob {
  const face: LabelFace = {
    code: print.code,
    keeper: print.business,
    name: print.installation,
    place: print.site,
  }

  return labelPrintJob({
    labels: Array.from({ length: print.count }, () => face),
    origin: print.origin,
    format: print.format,
    start: print.start,
    title: 'QR-Etikett',
  })
}
