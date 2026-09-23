import type { ConflictReason, SyncConflict, SyncValue } from '@opengewerk/domain'
import { useState } from 'react'

import { Button, Card, Cell, Column, FieldLabel, Table } from '../components/index.js'
import { type RefusedOperation, refusalText } from '../sync/client.js'
import { useSync, useSyncStatus } from '../sync/provider.js'
import { draftFromFixed, fixedDocumentOf } from './fixed-draft.js'
import { amount, euros, moment } from './format.js'
import { lineUnitLabel, vatRateLabel } from './labels.js'
import { entityLabel, fieldLabel, titleOf } from './naming.js'

/**
 * Why the two sides disagree, said once, in words somebody can act on.
 *
 * The same sentences the refusal on the device uses, because it is the same
 * question answered at two moments: before sending, when the device could work
 * it out itself, and after, when only the server could.
 */
function reasonText(reason: ConflictReason): string {
  return refusalText[reason]
}

/**
 * Conflicts that taking the device's version cannot settle, with what to do
 * instead.
 *
 * A signature is the one so far. It is refused when the report changed while
 * the customer was signing, and taken anyway it would stand under a page the
 * customer never saw, which is the whole of what the refusal prevents. The way
 * on is a new signature on the report as it is now, and that is what the card
 * says instead of offering a choice that is not one.
 */
const settledOnSite: Readonly<Record<string, string>> = {
  document_signatures:
    'Die Unterschrift gilt nicht, weil sich der Bericht geändert hat, während unterschrieben ' +
    'wurde. Der Bericht ist wieder offen; bitte ansehen und noch einmal unterschreiben lassen.',
}

/**
 * A value the way the document screen shows it: a line reads "2" and
 * "48,50 €", not 2000 and 4850. What this build does not know stays raw,
 * which is visibly a gap and better than an empty cell (see `naming.ts`).
 */
function shown(field: string, value: SyncValue | undefined): string {
  if (value === null || value === undefined) {
    return 'leer'
  }

  if (typeof value === 'boolean') {
    return value ? 'ja' : 'nein'
  }

  if (typeof value === 'number' && field === 'quantityMilli') {
    return amount(value)
  }

  if (typeof value === 'number' && field === 'unitPriceCents') {
    return euros(value)
  }

  if (typeof value === 'string' && field === 'unit' && Object.hasOwn(lineUnitLabel, value)) {
    return lineUnitLabel[value as keyof typeof lineUnitLabel]
  }

  if (typeof value === 'string' && field === 'vatRate' && Object.hasOwn(vatRateLabel, value)) {
    return vatRateLabel[value as keyof typeof vatRateLabel]
  }

  return String(value)
}

/**
 * Fields of a line that say where it hangs and where it sits, not what it
 * says. On the card for an issued document they would be rows nobody can do
 * anything with, and the new draft sets all three itself.
 */
const placement = new Set(['documentId', 'position', 'kind'])

/**
 * The order of the document screen, head first and a line as it reads.
 *
 * What the device wanted arrives as `jsonb`, and PostgreSQL hands its keys back
 * shortest first: a line would read unit, rate, designation. Fields not in the
 * list keep their order behind the rest.
 */
const documentOrder = [
  'subject',
  'introText',
  'closingText',
  'serviceFrom',
  'serviceUntil',
  'paymentTermDays',
  'designation',
  'description',
  'quantityMilli',
  'unit',
  'unitPriceCents',
  'vatRate',
]

function inDocumentOrder(fields: readonly string[]): string[] {
  const rank = (field: string) => {
    const at = documentOrder.indexOf(field)

    return at === -1 ? documentOrder.length : at
  }

  return [...fields].sort((left, right) => rank(left) - rank(right))
}

/**
 * One conflict, both versions beside each other.
 *
 * Three columns and not two, and the third is the one that explains the other
 * two. `seen` is what the device had in front of it when somebody made the
 * change; without it a person sees two values and no reason why anyone would
 * have typed either. With it the story is complete: it said this, I made it
 * that, and meanwhile it had become something else.
 *
 * The decision is made here, on the device, which ADR 0005 asks for and the
 * site entry needs: a technician on a roof cannot wait for an office to
 * arbitrate. Taking the device's version is an ordinary change and goes
 * through the outbox like any other, so it is subject to the same rules and
 * lands in the same audit log. Nothing about deciding a conflict is a back
 * door.
 *
 * A change to a document that was issued in the meantime cannot win: the
 * document is not changed any more, and taking the device's version is
 * refused again. There the choice is a new draft or the state in the system
 * (#139, ADR 0005 point 4), and the new draft takes every such change to the
 * same document at once, see `draftFromFixed`.
 */
function ConflictCard({
  conflict,
  onDrafted,
}: {
  readonly conflict: SyncConflict
  readonly onDrafted: (subject: string) => void
}) {
  const client = useSync()
  const { conflicts } = useSyncStatus()
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const fixedDocument = fixedDocumentOf(client, conflict)

  // A record the server refused to create is on neither side, and then what
  // the device wanted is the only thing that can name it.
  const known = client.get(conflict.entity, conflict.recordId)
  const record = known ?? conflict.wanted
  const settled = settledOnSite[conflict.entity]

  // At an issued document the server names the field that stops the change,
  // the status of the document, and that is no row anybody can decide on.
  // What the device wrote is: a new line with its values, a changed one with
  // the values beside what the system holds.
  const involved = fixedDocument
    ? inDocumentOrder(Object.keys(conflict.wanted).filter((field) => !placement.has(field)))
    : conflict.fields.length > 0
      ? conflict.fields
      : Object.keys(conflict.wanted)
  const onlyOnDevice = fixedDocument !== null && known === null
  const deleting = fixedDocument !== null && Object.keys(conflict.wanted).length === 0

  async function decide(takeMine: boolean) {
    setWorking(true)
    setTrouble(null)

    try {
      if (takeMine) {
        const again = await client.update(conflict.entity, conflict.recordId, conflict.wanted)

        if (again.outcome === 'refused') {
          // It can be refused a second time, and then the device's version
          // simply cannot stand: an issued document is the usual case. Saying
          // so and leaving the conflict open beats marking it decided when
          // nothing was decided.
          setTrouble(refusalText[again.reason])

          return
        }
      }

      await client.resolveConflict(conflict.id)
    } catch {
      setTrouble('Die Entscheidung ließ sich nicht übertragen. Ohne Verbindung geht das nicht.')
    } finally {
      setWorking(false)
    }
  }

  async function asDraft(documentId: string) {
    setWorking(true)
    setTrouble(null)

    try {
      const result = await draftFromFixed(client, conflicts, documentId)

      if (result.outcome === 'refused') {
        setTrouble(result.message)

        return
      }

      onDrafted(result.subject)

      // Closed only after the draft exists, and each conflict of the document
      // with it. Without a connection they stay open, and closing them later
      // with "Stand im System behalten" makes no second draft.
      try {
        for (const entry of conflicts) {
          if (fixedDocumentOf(client, entry) === documentId) {
            await client.resolveConflict(entry.id)
          }
        }
      } catch {
        setTrouble(
          'Der Entwurf ist angelegt. Die Konflikte lassen sich erst mit Verbindung schließen, ' +
            'dann mit "Stand im System behalten".',
        )
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <Card
      label={`Konflikt an ${entityLabel(conflict.entity)} ${titleOf(conflict.entity, record)}`}
      heading={
        <div className="flex flex-col gap-1">
          <FieldLabel>{entityLabel(conflict.entity)}</FieldLabel>
          <h2 className="text-title font-semibold">{titleOf(conflict.entity, record)}</h2>
          <p className="text-body text-ink-muted">{reasonText(conflict.reason)}</p>
        </div>
      }
    >
      {settled ? (
        <p className="text-body text-ink">{settled}</p>
      ) : deleting ? (
        <p className="text-body text-ink">Das Gerät wollte den Eintrag löschen.</p>
      ) : onlyOnDevice ? (
        <Table caption={`Was das Gerät an ${titleOf(conflict.entity, record)} schreiben wollte`}>
          <thead>
            <tr>
              <Column>Feld</Column>
              <Column>Auf dem Gerät</Column>
            </tr>
          </thead>
          <tbody>
            {involved.map((field) => (
              <tr key={field}>
                <th scope="row" className="px-3 py-2 border-b border-line text-left font-medium">
                  {fieldLabel(field)}
                </th>
                <Cell>{shown(field, conflict.wanted[field])}</Cell>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <Table caption={`Die beiden Stände von ${titleOf(conflict.entity, record)}`}>
          <thead>
            <tr>
              <Column>Feld</Column>
              <Column>Auf dem Gerät</Column>
              <Column>Im System</Column>
              <Column>Das Gerät sah</Column>
            </tr>
          </thead>
          <tbody>
            {involved.map((field) => (
              <tr key={field}>
                <th scope="row" className="px-3 py-2 border-b border-line text-left font-medium">
                  {fieldLabel(field)}
                </th>
                <Cell>{shown(field, conflict.wanted[field])}</Cell>
                <Cell>{shown(field, conflict.found[field])}</Cell>
                <Cell className="text-ink-muted">{shown(field, conflict.seen[field])}</Cell>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {fixedDocument ? (
        <p className="mt-3 text-body text-ink">
          Der Beleg ist inzwischen festgeschrieben und wird nicht mehr geändert. Was auf diesem
          Gerät dazukam oder geändert wurde, lässt sich als neuer Entwurf für denselben Kunden und
          Auftrag anlegen; sein Betreff nennt den festgeschriebenen Beleg. Sonst bleibt es beim
          Stand im System.
        </p>
      ) : null}

      <p className="mt-3 text-table text-ink-muted">
        {`Erfasst ${moment(conflict.recordedAt)} auf Gerät ${conflict.deviceId}.`}
      </p>

      {trouble ? (
        <p role="alert" className="mt-3 text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        {settled ? (
          <Button
            tone="primary"
            disabled={working}
            onClick={() => {
              void decide(false)
            }}
          >
            Verstanden
          </Button>
        ) : (
          <>
            {fixedDocument ? (
              <Button
                tone="primary"
                disabled={working}
                onClick={() => {
                  void asDraft(fixedDocument)
                }}
              >
                Als neuen Entwurf anlegen
              </Button>
            ) : (
              <Button
                tone="primary"
                disabled={working}
                onClick={() => {
                  void decide(true)
                }}
              >
                Fassung vom Gerät übernehmen
              </Button>
            )}
            <Button
              tone="secondary"
              disabled={working}
              onClick={() => {
                void decide(false)
              }}
            >
              Stand im System behalten
            </Button>
          </>
        )}
      </div>
    </Card>
  )
}

/**
 * An operation the server refused outright, and the decision it leaves.
 *
 * Nothing to weigh against anything: nobody else changed the record, the
 * operation is wrong in itself, and the server has said why. What a person
 * can do is let it go on this device, so that the rest of the outbox gets out,
 * or send it again when the reason is gone, a right that was missing and has
 * been given since. Correcting it is not on offer: an entry already queued
 * cannot be changed, only followed by another one (#120).
 */
function RefusedCard({ refused }: { readonly refused: RefusedOperation }) {
  const client = useSync()
  const [working, setWorking] = useState(false)
  const { operation, message } = refused
  const title = titleOf(operation.entity, client.get(operation.entity, operation.recordId))
  const creating = operation.kind === 'create'

  async function act(work: () => Promise<void>) {
    setWorking(true)

    try {
      await work()
    } finally {
      setWorking(false)
    }
  }

  return (
    <Card
      label={`Abgelehnte Änderung an ${title}`}
      heading={
        <div className="flex flex-col gap-1">
          <FieldLabel>{entityLabel(operation.entity)}</FieldLabel>
          <h2 className="text-title font-semibold">{title}</h2>
          <p className="text-body text-ink-muted">{message}</p>
        </div>
      }
    >
      <p className="text-body text-ink">
        {creating
          ? 'Der Server nimmt diesen Eintrag nicht an, und bis er entschieden ist, geht nichts ' +
            'hinaus, was danach auf diesem Gerät erfasst wurde. Verwerfen nimmt ihn samt den ' +
            'späteren Änderungen an ihm von diesem Gerät; im System war er nie.'
          : 'Der Server nimmt diese Änderung nicht an, und bis sie entschieden ist, geht nichts ' +
            'hinaus, was danach auf diesem Gerät erfasst wurde. Verwerfen nimmt sie von diesem ' +
            'Gerät; im System bleibt der Eintrag, wie er ist.'}
      </p>

      {operation.kind === 'delete' ? (
        <p className="mt-3 text-body text-ink">Das Gerät wollte den Eintrag löschen.</p>
      ) : (
        <Table caption={`Was das Gerät an ${title} schreiben wollte`}>
          <thead>
            <tr>
              <Column>Feld</Column>
              <Column>Auf dem Gerät</Column>
            </tr>
          </thead>
          <tbody>
            {operation.patches.map((patch) => (
              <tr key={patch.field}>
                <th scope="row" className="px-3 py-2 border-b border-line text-left font-medium">
                  {fieldLabel(patch.field)}
                </th>
                <Cell>{shown(patch.field, patch.to)}</Cell>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <p className="mt-3 text-table text-ink-muted">
        {`Erfasst ${moment(operation.recordedAt)} auf diesem Gerät. Erneut senden hilft nur, ` +
          'wenn der Grund inzwischen behoben ist, etwa ein Recht, das gefehlt hat.'}
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          tone="primary"
          disabled={working}
          onClick={() => {
            void act(() => client.discard(operation.id))
          }}
        >
          {creating ? 'Eintrag verwerfen' : 'Änderung verwerfen'}
        </Button>
        <Button
          tone="secondary"
          disabled={working}
          onClick={() => {
            void act(() => client.synchronise())
          }}
        >
          Erneut senden
        </Button>
      </div>
    </Card>
  )
}

/**
 * The list somebody has to work through, and the only screen in the
 * application that is allowed to be empty and still worth opening.
 */
export function ConflictScreen() {
  const { conflicts, refused } = useSyncStatus()
  // The drafts made here, said once they exist: the conflict that led to one
  // is gone from the list, and without this the draft would appear somewhere
  // else with nobody told where.
  const [drafted, setDrafted] = useState<readonly string[]>([])

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-title font-semibold">Konflikte</h1>

      {drafted.length > 0 ? (
        <Card label="Als neuer Entwurf angelegt" tone="sunken">
          <ul role="status" className="flex flex-col gap-1 text-body">
            {drafted.map((subject) => (
              <li key={subject}>
                {`Entwurf angelegt: ${subject}. Er gehört zum selben Kunden und Auftrag wie der ` +
                  'festgeschriebene Beleg.'}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {refused ? <RefusedCard key={refused.operation.id} refused={refused} /> : null}

      {conflicts.length === 0 && !refused ? (
        <Card label="Keine Konflikte" tone="sunken">
          <p className="text-body">
            Nichts zu entscheiden. Änderungen von zwei Geräten sind hier gelandet, wenn beide
            dasselbe Feld angefasst haben.
          </p>
        </Card>
      ) : (
        conflicts.map((conflict) => (
          <ConflictCard
            key={conflict.id}
            conflict={conflict}
            onDrafted={(subject) => {
              setDrafted((before) => [...before, subject])
            }}
          />
        ))
      )}
    </div>
  )
}
