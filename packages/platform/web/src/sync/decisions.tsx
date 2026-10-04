import type { ConflictReason, SyncConflict, SyncValue } from '@opengewerk/platform-domain'
import { Server, Smartphone } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useId, useState } from 'react'
import type { ReactNode } from 'react'

import { useApplication } from '../application.js'
import type { RecordWords } from '../application.js'
import { Button } from '../components/button.js'
import { Panel, TablePanel } from '../components/panel.js'
import { Card, useEntry } from '../components/surface.js'
import { Cell, Column } from '../components/table.js'
import { moment } from '../format.js'
import { refusalFor, refusalText } from './client.js'
import type { RefusedOperation, SyncSnapshot } from './client.js'
import { useSync, useSyncStatus } from './provider.js'

/**
 * What somebody has to decide about the exchange, in both entries: the
 * conflicts with both versions beside each other, and the entry the server
 * refused outright. The screens around them are `SyncScreen` in the office
 * and `ConflictScreen` on site.
 *
 * What a record is called, how its values are written, which conflicts no
 * version settles and what other way out there is, the application says
 * (`records` in its value, ADR 0010).
 */

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
 * A value the way the application's screens show it. What neither the
 * foundation nor the application knows stays raw, which is visibly a gap and
 * better than an empty cell.
 */
function shown(words: RecordWords, field: string, value: SyncValue | undefined): string {
  if (value === null || value === undefined) {
    return 'leer'
  }

  if (typeof value === 'boolean') {
    return value ? 'ja' : 'nein'
  }

  return words.valueText(field, value) ?? String(value)
}

/**
 * A conflict in the office, as the board "Abgleich und Konflikt" frames it: a
 * red edge, and in a red head what kind of record, which one and why.
 */
function ConflictFrame({
  kind,
  title,
  reason,
  children,
}: {
  readonly kind: string
  readonly title: string
  readonly reason: string
  readonly children: ReactNode
}) {
  const heading = useId()

  return (
    <section
      aria-labelledby={heading}
      className="min-w-0 overflow-clip rounded-[6px] border-2 border-conflict bg-surface [--surface-here:var(--color-surface)]"
    >
      <div className="border-b border-conflict-edge bg-conflict-fill px-4 py-3">
        <p className="font-condensed text-[12px] font-semibold tracking-[1.1px] text-conflict uppercase">
          {kind}
        </p>
        <h2 id={heading} className="text-[16px] font-bold text-conflict [overflow-wrap:anywhere]">
          {title}
        </h2>
        <p className="mt-[3px] text-[14px] text-conflict-ink">{reason}</p>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3.5">{children}</div>
    </section>
  )
}

/** The name of a field at the head of its row, as a row header. */
function FieldName({ children }: { readonly children: string }) {
  return (
    <th
      scope="row"
      className="border-b border-row px-2 py-[7px] text-left font-medium leading-[1.2] text-ink first:pl-3.5 max-lg:py-3"
    >
      {children}
    </th>
  )
}

/**
 * Where a conflicting change was made, as far as a person can tell: on this
 * device or on another one. The key of a device is a UUID and says nothing to
 * anybody who reads it (#271).
 */
function madeOn(conflict: SyncConflict, deviceId: string): string {
  return conflict.deviceId === deviceId ? 'auf diesem Gerät' : 'auf einem anderen Gerät'
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
 * site entry needs: whoever works away from a desk cannot wait for an office
 * to arbitrate. Taking the device's version is an ordinary change and goes
 * through the outbox like any other, so it is subject to the same rules and
 * lands in the same audit log. Nothing about deciding a conflict is a back
 * door.
 *
 * Where the application has another way out (#139, ADR 0005 point 4), the
 * card offers it in place of the device's version, which could not win there,
 * and the way takes every conflict of its group at once.
 */
function ConflictCard({
  conflict,
  onMade,
}: {
  readonly conflict: SyncConflict
  readonly onMade: (summary: string) => void
}) {
  const client = useSync()
  const { records: words } = useApplication()
  const { conflicts } = useSyncStatus()
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const way = words.otherWay
  const group = way ? way.groupOf(client, conflict) : null

  // A record the server refused to create is on neither side, and then what
  // the device wanted is the only thing that can name it.
  const known = client.get(conflict.entity, conflict.recordId)
  const record = known ?? conflict.wanted
  const settled = words.settledElsewhere[conflict.entity]

  // Where the other way is open, the server names the field that stops the
  // change, and that is no row anybody can decide on. What the device wrote
  // is: the fields the way chooses, beside what the system holds.
  const involved =
    way && group !== null
      ? way.fields(conflict.wanted)
      : conflict.fields.length > 0
        ? conflict.fields
        : Object.keys(conflict.wanted)
  const onlyOnDevice = group !== null && known === null
  const deleting = group !== null && Object.keys(conflict.wanted).length === 0
  const entry = useEntry()

  async function decide(takeMine: boolean) {
    setWorking(true)
    setTrouble(null)

    try {
      if (takeMine) {
        const again = await client.update(conflict.entity, conflict.recordId, conflict.wanted)

        if (again.outcome === 'refused') {
          // It can be refused a second time, and then the device's version
          // simply cannot stand. Saying so and leaving the conflict open beats
          // marking it decided when nothing was decided.
          setTrouble(refusalFor(again))

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

  async function takeWay(chosen: string) {
    if (!way) {
      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      const result = await way.take(client, conflicts, chosen)

      if (result.outcome === 'refused') {
        setTrouble(result.message)

        return
      }

      onMade(result.summary)

      // Closed only after what the way made exists, and each conflict of the
      // group with it. Without a connection they stay open, and closing them
      // later with "Stand im System behalten" makes nothing a second time.
      try {
        for (const other of conflicts) {
          if (way.groupOf(client, other) === chosen) {
            await client.resolveConflict(other.id)
          }
        }
      } catch {
        setTrouble(way.stillOpen)
      }
    } finally {
      setWorking(false)
    }
  }

  const buttons = (
    <div className="flex flex-wrap gap-2">
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
          {way && group !== null ? (
            <Button
              tone="primary"
              disabled={working}
              onClick={() => {
                void takeWay(group)
              }}
            >
              {way.action}
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
  )

  if (entry === 'office') {
    const name = words.titleOf(conflict.entity, record)

    return (
      <ConflictFrame
        kind={words.entityLabel(conflict.entity)}
        title={name}
        reason={reasonText(conflict.reason)}
      >
        {settled ? (
          <p className="text-[14px] leading-[1.5] text-ink">{settled}</p>
        ) : deleting ? (
          <p className="text-[14px] leading-[1.5] text-ink">
            Das Gerät wollte den Eintrag löschen.
          </p>
        ) : onlyOnDevice ? (
          <TablePanel
            caption={`Was das Gerät an ${name} schreiben wollte`}
            cards={involved.map((field) => ({
              key: field,
              title: words.fieldLabel(field),
              sub: `Auf dem Gerät: ${shown(words, field, conflict.wanted[field])}`,
            }))}
          >
            <thead>
              <tr>
                <Column className="w-[160px]">Feld</Column>
                <Column>Auf dem Gerät</Column>
              </tr>
            </thead>
            <tbody>
              {involved.map((field) => (
                <tr key={field}>
                  <FieldName>{words.fieldLabel(field)}</FieldName>
                  <Cell className="font-semibold">
                    {shown(words, field, conflict.wanted[field])}
                  </Cell>
                </tr>
              ))}
            </tbody>
          </TablePanel>
        ) : (
          <TablePanel
            caption={`Die beiden Stände von ${name}`}
            cards={involved.map((field) => ({
              key: field,
              title: words.fieldLabel(field),
              sub: (
                <>
                  <span className="block">{`Auf dem Gerät: ${shown(words, field, conflict.wanted[field])}`}</span>
                  <span className="block">{`Im System: ${shown(words, field, conflict.found[field])}`}</span>
                  <span className="block">{`Das Gerät sah: ${shown(words, field, conflict.seen[field])}`}</span>
                </>
              ),
            }))}
          >
            <thead>
              <tr>
                <Column className="w-[160px]">Feld</Column>
                <Column>Auf dem Gerät</Column>
                <Column>Im System</Column>
                <Column>Das Gerät sah</Column>
              </tr>
            </thead>
            <tbody>
              {involved.map((field) => (
                <tr key={field}>
                  <FieldName>{words.fieldLabel(field)}</FieldName>
                  <Cell className="font-semibold">
                    {shown(words, field, conflict.wanted[field])}
                  </Cell>
                  <Cell className="font-semibold">
                    {shown(words, field, conflict.found[field])}
                  </Cell>
                  <Cell>{shown(words, field, conflict.seen[field])}</Cell>
                </tr>
              ))}
            </tbody>
          </TablePanel>
        )}

        {way && group !== null ? (
          <p className="text-[14px] leading-[1.5] text-ink">{way.explanation}</p>
        ) : null}

        <p className="text-[13px] text-ink-faint">
          {`Erfasst ${moment(conflict.recordedAt)} ${madeOn(conflict, client.deviceId)}.`}
        </p>

        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}

        {buttons}
      </ConflictFrame>
    )
  }

  const siteButtons = (
    <div className="mt-1.5 flex flex-col gap-2">
      {settled ? (
        <Button tone="dark" wide height={56} disabled={working} onClick={() => void decide(false)}>
          Verstanden
        </Button>
      ) : (
        <>
          {way && group !== null ? (
            <Button
              tone="dark"
              wide
              height={56}
              disabled={working}
              onClick={() => void takeWay(group)}
            >
              {way.action}
            </Button>
          ) : (
            <Button
              tone="dark"
              wide
              height={56}
              disabled={working}
              onClick={() => void decide(true)}
            >
              Fassung vom Gerät übernehmen
            </Button>
          )}
          <Button wide height={56} disabled={working} onClick={() => void decide(false)}>
            Stand im System behalten
          </Button>
        </>
      )}
    </div>
  )

  // On site the card of the board "Konflikte": a red frame, the record in a
  // red head with what happened, then each field with the two versions one
  // over the other, which a phone has room for where a table has none.
  return (
    <SiteConflictFrame
      kind={words.entityLabel(conflict.entity)}
      title={words.titleOf(conflict.entity, record)}
      reason={reasonText(conflict.reason)}
    >
      {settled ? (
        <p className="text-[17px] leading-[1.45]">{settled}</p>
      ) : deleting ? (
        <p className="text-[17px] leading-[1.45]">Das Gerät wollte den Eintrag löschen.</p>
      ) : (
        involved.map((field) => (
          <div key={field} className="flex flex-col gap-2">
            <SiteFieldHead>{`Feld: ${words.fieldLabel(field)}`}</SiteFieldHead>
            <SiteVersion icon={Smartphone} head="Auf dem Gerät">
              {shown(words, field, conflict.wanted[field])}
            </SiteVersion>
            {onlyOnDevice ? null : (
              <>
                <SiteVersion icon={Server} head="Im System">
                  {shown(words, field, conflict.found[field])}
                </SiteVersion>
                <p className="text-[15px] text-ink-muted">
                  {`Das Gerät sah: ${shown(words, field, conflict.seen[field])}`}
                </p>
              </>
            )}
          </div>
        ))
      )}

      {way && group !== null ? (
        <p className="text-[16px] leading-[1.45]">{way.explanation}</p>
      ) : null}

      <p className="numeric text-[14px] text-ink-faint">
        {`Erfasst ${moment(conflict.recordedAt)} ${madeOn(conflict, client.deviceId)}.`}
      </p>

      {trouble ? (
        <p role="alert" className="text-[16px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      {siteButtons}
    </SiteConflictFrame>
  )
}

/** Small capitals over a field of a conflict on site: "Feld: Bezeichnung". */
function SiteFieldHead({ children }: { readonly children: string }) {
  return (
    <p className="font-condensed text-[13px] font-semibold tracking-[1.1px] text-ink-faint uppercase">
      {children}
    </p>
  )
}

/** One version of a field, on the device or in the system, in a box of its own. */
function SiteVersion({
  icon: Icon,
  head,
  children,
}: {
  readonly icon: LucideIcon
  readonly head: string
  readonly children: string
}) {
  return (
    <div className="rounded-[6px] border border-line bg-ground px-3 py-2.5">
      <p className="flex items-center gap-1.5 font-condensed text-[14px] font-semibold tracking-[1px] text-ink-faint uppercase">
        <Icon size={15} strokeWidth={2.2} aria-hidden="true" />
        {head}
      </p>
      <p className="mt-1 text-[18px] leading-[1.3] font-bold [overflow-wrap:anywhere]">
        {children}
      </p>
    </div>
  )
}

/**
 * A conflict on site, `konflikte()` of the canvas: 2 pixels of red around it,
 * the kind in small capitals and the name in red in a pale red head, the
 * reason under it.
 */
function SiteConflictFrame({
  kind,
  title,
  reason,
  children,
}: {
  readonly kind: string
  readonly title: string
  readonly reason: string
  readonly children: ReactNode
}) {
  const heading = useId()

  return (
    <section
      aria-labelledby={heading}
      className="overflow-clip rounded-[6px] border-2 border-conflict bg-surface [--surface-here:var(--color-surface)]"
    >
      <div className="bg-conflict-fill px-3.5 py-3">
        <SiteFieldHead>{kind}</SiteFieldHead>
        <h2
          id={heading}
          className="mt-0.5 text-[20px] font-bold text-conflict [overflow-wrap:anywhere]"
        >
          {title}
        </h2>
        <p className="mt-1 text-[16px] leading-[1.4] text-conflict-ink">{reason}</p>
      </div>
      <div className="flex flex-col gap-2 px-3.5 py-3">{children}</div>
    </section>
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
  const { records: words } = useApplication()
  const [working, setWorking] = useState(false)
  const { operation, message } = refused
  const title = words.titleOf(operation.entity, client.get(operation.entity, operation.recordId))
  const creating = operation.kind === 'create'
  const entry = useEntry()

  async function act(work: () => Promise<void>) {
    setWorking(true)

    try {
      await work()
    } finally {
      setWorking(false)
    }
  }

  const explanation = creating
    ? 'Der Server nimmt diesen Eintrag nicht an, und bis er entschieden ist, geht nichts ' +
      'hinaus, was danach auf diesem Gerät erfasst wurde. Verwerfen nimmt ihn samt den ' +
      'späteren Änderungen an ihm von diesem Gerät; im System war er nie.'
    : 'Der Server nimmt diese Änderung nicht an, und bis sie entschieden ist, geht nichts ' +
      'hinaus, was danach auf diesem Gerät erfasst wurde. Verwerfen nimmt sie von diesem ' +
      'Gerät; im System bleibt der Eintrag, wie er ist.'
  const actions = (
    <div className="flex flex-wrap gap-2">
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
  )

  if (entry === 'office') {
    return (
      <RefusedFrame kind={words.entityLabel(operation.entity)} title={title}>
        <p className="text-[14px] font-semibold text-conflict">{message}</p>
        <p className="text-[14px] leading-[1.5] text-ink">{explanation}</p>
        {operation.kind === 'delete' ? (
          <p className="text-[14px] leading-[1.5] text-ink">
            Das Gerät wollte den Eintrag löschen.
          </p>
        ) : (
          <TablePanel
            caption={`Was das Gerät an ${title} schreiben wollte`}
            cards={operation.patches.map((patch) => ({
              key: patch.field,
              title: words.fieldLabel(patch.field),
              sub: `Auf dem Gerät: ${shown(words, patch.field, patch.to)}`,
            }))}
          >
            <thead>
              <tr>
                <Column className="w-[160px]">Feld</Column>
                <Column>Auf dem Gerät</Column>
              </tr>
            </thead>
            <tbody>
              {operation.patches.map((patch) => (
                <tr key={patch.field}>
                  <FieldName>{words.fieldLabel(patch.field)}</FieldName>
                  <Cell>{shown(words, patch.field, patch.to)}</Cell>
                </tr>
              ))}
            </tbody>
          </TablePanel>
        )}
        <p className="text-[13px] text-ink-faint">
          {`Erfasst ${moment(operation.recordedAt)} auf diesem Gerät. Erneut senden hilft nur, ` +
            'wenn der Grund inzwischen behoben ist, etwa ein Recht, das gefehlt hat.'}
        </p>
        {actions}
      </RefusedFrame>
    )
  }

  // On site a plain card with the kind over the name and the reason in red,
  // as the office has it, at the size of the site.
  return (
    <Panel>
      <div className="flex flex-col gap-2">
        <div>
          <SiteFieldHead>{words.entityLabel(operation.entity)}</SiteFieldHead>
          <h2 className="mt-0.5 text-[20px] font-bold [overflow-wrap:anywhere]">{title}</h2>
          <p className="mt-1 text-[16px] font-semibold text-conflict">{message}</p>
        </div>
        <p className="text-[16px] leading-[1.45]">{explanation}</p>
        {operation.kind === 'delete' ? (
          <p className="text-[16px] leading-[1.45]">Das Gerät wollte den Eintrag löschen.</p>
        ) : (
          operation.patches.map((patch) => (
            <div key={patch.field} className="flex flex-col gap-2">
              <SiteFieldHead>{`Feld: ${words.fieldLabel(patch.field)}`}</SiteFieldHead>
              <SiteVersion icon={Smartphone} head="Auf dem Gerät">
                {shown(words, patch.field, patch.to)}
              </SiteVersion>
            </div>
          ))
        )}
        <p className="numeric text-[14px] text-ink-faint">
          {`Erfasst ${moment(operation.recordedAt)} auf diesem Gerät. Erneut senden hilft nur, ` +
            'wenn der Grund inzwischen behoben ist, etwa ein Recht, das gefehlt hat.'}
        </p>
        <div className="mt-1.5 flex flex-col gap-2">
          <Button
            tone="dark"
            wide
            height={56}
            disabled={working}
            onClick={() => {
              void act(() => client.discard(operation.id))
            }}
          >
            {creating ? 'Eintrag verwerfen' : 'Änderung verwerfen'}
          </Button>
          <Button
            wide
            height={56}
            disabled={working}
            onClick={() => {
              void act(() => client.synchronise())
            }}
          >
            Erneut senden
          </Button>
        </div>
      </div>
    </Panel>
  )
}

/**
 * An entry the server refused, in the office: a plain card with the kind of
 * record in small capitals over its name.
 */
function RefusedFrame({
  kind,
  title,
  children,
}: {
  readonly kind: string
  readonly title: string
  readonly children: ReactNode
}) {
  const heading = useId()

  return (
    <section
      aria-labelledby={heading}
      className="flex min-w-0 flex-col gap-2.5 rounded-[6px] border border-line bg-surface px-4 py-3.5 [--surface-here:var(--color-surface)]"
    >
      <div>
        <p className="font-condensed text-[12px] font-semibold tracking-[1.1px] text-ink-faint uppercase">
          {kind}
        </p>
        <h2 id={heading} className="text-[15px] font-semibold [overflow-wrap:anywhere]">
          {title}
        </h2>
      </div>
      {children}
    </section>
  )
}

/**
 * Whether "Keine Verbindung" stands in the state of the exchange: whenever
 * the last attempt left a reason behind.
 *
 * Asked of the reason and not of the state of the client. The state names
 * what needs somebody first, a refused change before a conflict before a
 * missing connection, so a device with a conflict and no network said nothing
 * of the network, and whoever decided the conflict learned only at its card
 * that the decision did not get out (#494). One question for both entries:
 * the site asked the state alone, and with it claimed a missing connection
 * over every change that was simply on its way.
 */
export function noConnection(status: Pick<SyncSnapshot, 'trouble'>): boolean {
  return status.trouble !== null
}

/** The sentence for a list with nothing in it. */
export function NothingToDecide() {
  return (
    <p className="text-body">
      Nichts zu entscheiden. Änderungen von zwei Geräten sind hier gelandet, wenn beide dasselbe
      Feld angefasst haben.
    </p>
  )
}

/**
 * What is to decide, in the order it has to be decided: first the entry the
 * outbox is stuck on, then the conflicts. What another way out made is said
 * once it exists: the conflict that led to it is gone from the list, and
 * without this it would appear somewhere else with nobody told where.
 */
export function useDecisions(): {
  readonly made: ReactNode
  readonly cards: ReactNode
  readonly empty: boolean
} {
  const { conflicts, refused } = useSyncStatus()
  const way = useApplication().records.otherWay
  const [made, setMade] = useState<readonly string[]>([])

  return {
    made:
      way && made.length > 0 ? (
        <Card label={way.madeLabel} tone="sunken">
          <ul role="status" className="flex flex-col gap-1 text-body">
            {made.map((summary) => (
              <li key={summary}>{way.made(summary)}</li>
            ))}
          </ul>
        </Card>
      ) : null,
    cards: (
      <>
        {refused ? <RefusedCard key={refused.operation.id} refused={refused} /> : null}
        {conflicts.map((conflict) => (
          <ConflictCard
            key={conflict.id}
            conflict={conflict}
            onMade={(summary) => {
              setMade((before) => [...before, summary])
            }}
          />
        ))}
      </>
    ),
    empty: conflicts.length === 0 && !refused,
  }
}
