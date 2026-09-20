import type { ConflictReason, SyncConflict, SyncValue } from '@opengewerk/domain'
import { useState } from 'react'

import { Button, Card, Cell, Column, FieldLabel, Table } from '../components/index.js'
import { refusalText } from '../sync/client.js'
import { useSync, useSyncStatus } from '../sync/provider.js'
import { moment } from './format.js'
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

function shown(value: SyncValue | undefined): string {
  if (value === null || value === undefined) {
    return 'leer'
  }

  if (typeof value === 'boolean') {
    return value ? 'ja' : 'nein'
  }

  return String(value)
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
 */
function ConflictCard({ conflict }: { readonly conflict: SyncConflict }) {
  const client = useSync()
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  const record = client.get(conflict.entity, conflict.recordId)
  const involved = conflict.fields.length > 0 ? conflict.fields : Object.keys(conflict.wanted)

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
              <Cell>{shown(conflict.wanted[field])}</Cell>
              <Cell>{shown(conflict.found[field])}</Cell>
              <Cell className="text-ink-muted">{shown(conflict.seen[field])}</Cell>
            </tr>
          ))}
        </tbody>
      </Table>

      <p className="mt-3 text-table text-ink-muted">
        {`Erfasst ${moment(conflict.recordedAt)} auf Gerät ${conflict.deviceId}.`}
      </p>

      {trouble ? (
        <p role="alert" className="mt-3 text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          tone="primary"
          disabled={working}
          onClick={() => {
            void decide(true)
          }}
        >
          Fassung vom Gerät übernehmen
        </Button>
        <Button
          tone="secondary"
          disabled={working}
          onClick={() => {
            void decide(false)
          }}
        >
          Stand im System behalten
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
  const { conflicts } = useSyncStatus()

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-title font-semibold">Konflikte</h1>

      {conflicts.length === 0 ? (
        <Card label="Keine Konflikte" tone="sunken">
          <p className="text-body">
            Nichts zu entscheiden. Änderungen von zwei Geräten sind hier gelandet, wenn beide
            dasselbe Feld angefasst haben.
          </p>
        </Card>
      ) : (
        conflicts.map((conflict) => <ConflictCard key={conflict.id} conflict={conflict} />)
      )}
    </div>
  )
}
