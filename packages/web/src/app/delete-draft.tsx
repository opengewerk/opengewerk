import { type IsoDate, mayDeleteDraft, type RecordState } from '@opengewerk/domain'
import { Button, Confirm } from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import { maybeText, refusalFor, text, useSync } from '@opengewerk/platform-web/sync'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'

import { documentStatusOf } from './labels.js'
import { useMay } from './queries.js'
import { useMe } from './time.js'

/**
 * "Entwurf löschen" (#786), as the boards "Angebot im Entwurf, Entwurf
 * löschen" and "Regiebericht im Entwurf, Entwurf löschen" draw it: in the
 * head of a draft in the office, quiet and red under a report on site. For
 * whoever made the draft, somebody else's only with the right to delete the
 * drafts of others, never a fixed one. Deleted through the outbox like every
 * change, without a network too, and the server asks the same rule; the
 * change log keeps who did it.
 */
export function DeleteDraft({
  document,
  kind,
  customerName,
  onDeleted,
  look = 'office',
}: {
  readonly document: RecordState
  /** "Angebot", "Regiebericht": what the question names. */
  readonly kind: string
  readonly customerName: string | null
  readonly onDeleted: () => void
  /** The button of the office's head, or the wide quiet one at the end of a report on site. */
  readonly look?: 'office' | 'site'
}) {
  const client = useSync()
  const me = useMe()
  const writes = useMay('document.write')
  const deletesOthers = useMay('document.delete')
  const [asking, setAsking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const may = mayDeleteDraft(
    { status: documentStatusOf(document), createdBy: maybeText(document, 'createdBy') },
    me,
    (right) => (right === 'document.write' ? writes : deletesOthers),
  )

  if (!may) {
    return null
  }

  async function remove() {
    setAsking(false)

    const result = await client.remove('documents', String(document['id']))

    if (result.outcome === 'refused') {
      setTrouble(refusalFor(result))

      return
    }

    onDeleted()
  }

  const open = () => {
    setTrouble(null)
    setAsking(true)
  }

  const named = [
    `${kind} vom ${date(text(document, 'documentDate') as IsoDate)}`,
    customerName ? `für ${customerName}` : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      {look === 'office' ? (
        <Button size="small" tone="danger" icon={Trash2} onClick={open}>
          Entwurf löschen
        </Button>
      ) : (
        <Button
          tone="quiet"
          wide
          height={44}
          icon={Trash2}
          className="text-conflict!"
          onClick={open}
        >
          Entwurf löschen
        </Button>
      )}
      {trouble ? (
        <span role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </span>
      ) : null}
      <Confirm
        open={asking}
        title="Entwurf löschen?"
        confirm="Entwurf löschen"
        tone="danger"
        onConfirm={() => {
          void remove()
        }}
        onCancel={() => {
          setAsking(false)
        }}
      >
        {look === 'office'
          ? `Der Entwurf „${named}“ verschwindet aus den Listen, am Auftrag und auf den Geräten. ` +
            'Eine Nummer hatte er noch nicht. Das Änderungsprotokoll hält fest, wer den Entwurf wann gelöscht hat.'
          : `Der Entwurf „${named}“ verschwindet auf diesem Gerät und, sobald es Netz hat, im Büro. ` +
            'Unterschrieben war er nicht. Das Änderungsprotokoll hält fest, wer den Entwurf wann gelöscht hat.'}
      </Confirm>
    </>
  )
}
