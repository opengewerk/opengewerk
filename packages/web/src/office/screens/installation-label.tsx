import { LabelCard } from '@opengewerk/platform-web/office'
import type { CardLabel, LabelCardWords } from '@opengewerk/platform-web/office'
import { maybeText, text, useSync, useSyncStatus } from '@opengewerk/platform-web/sync'

import {
  blockLabel,
  createLabel,
  labelPdfAddress,
  useInstallationLabels,
} from '../../app/installation-labels.js'
import { useMay } from '../../app/queries.js'

/** What this application says on the card of a label. */
const words: LabelCardWords = {
  title: 'QR-Etikett',
  none: 'Noch kein Etikett. Ein Etikett im Zählerschrank oder am Wechselrichter öffnet diese Anlage, wenn es jemand mit der App oder der Kamera des Telefons scannt.',
  blocking: (code) =>
    `Das Etikett ${code} öffnet danach nichts mehr, auch kein Exemplar, das schon klebt: weder in der App noch im Browser. Sperren lässt sich nicht zurücknehmen; ein neues Etikett legst du danach an.`,
  sheetNote: 'Im Zählerschrank hält Folie länger als Papier.',
}

/**
 * "QR-Etikett", the card of the label in the side column of an installation
 * (#308), as the boards "Anlagenakte mit QR-Etikett" and "Die Karte
 * QR-Etikett" draw it. The card is the foundation's (`LabelCard`); here is
 * what a label hangs on in this application, who may make and block one, and
 * the routes of the installation that do it.
 */
export function LabelPanel({ installationId }: { readonly installationId: string }) {
  const client = useSync()
  const { online } = useSyncStatus()
  const mayWrite = useMay('installation.write')
  const { valid, lastBlocked } = useInstallationLabels(installationId)
  const blockedAt = maybeText(lastBlocked, 'blockedAt')

  return (
    <LabelCard
      words={words}
      valid={
        valid
          ? {
              id: String(valid['id']),
              code: text(valid, 'code'),
              createdAt: maybeText(valid, 'createdAt'),
            }
          : null
      }
      lastBlocked={lastBlocked && blockedAt ? { code: text(lastBlocked, 'code'), blockedAt } : null}
      online={online}
      mayMake={mayWrite}
      mayBlock={mayWrite}
      onMake={async () => {
        await createLabel(installationId)
        await client.synchronise()
      }}
      onBlock={async (label: CardLabel) => {
        await blockLabel(installationId, label.id)
        await client.synchronise()
      }}
      pdfAddress={(label, format, count, start) =>
        labelPdfAddress(installationId, label.id, format, count, start)
      }
    />
  )
}
