import type { ConflictReason, SyncConflict, SyncValue } from '@opengewerk/domain'
import { Check, Clock, RefreshCw, Server, Smartphone, TriangleAlert, WifiOff } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useId, useState } from 'react'
import type { ReactNode } from 'react'

import { Button, Card, Cell, Column, Panel, TablePanel, useEntry } from '../components/index.js'
import { type RefusedOperation, refusalFor, refusalText } from '../sync/client.js'
import { useSync, useSyncStatus } from '../sync/provider.js'
import { draftFromFixed, fixedDocumentOf } from './fixed-draft.js'
import { amount, clockTime, euros, moment } from './format.js'
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
      className="min-w-0 overflow-hidden rounded-[6px] border-2 border-conflict bg-surface [--surface-here:var(--color-surface)]"
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
/**
 * Where a conflicting change was made, as far as a person can tell: on this
 * device or on another one. The key of a device is a UUID and says nothing to
 * anybody who reads it (#271).
 */
function madeOn(conflict: SyncConflict, deviceId: string): string {
  return conflict.deviceId === deviceId ? 'auf diesem Gerät' : 'auf einem anderen Gerät'
}

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
  const entry = useEntry()

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
  )

  if (entry === 'office') {
    const name = titleOf(conflict.entity, record)

    return (
      <ConflictFrame
        kind={entityLabel(conflict.entity)}
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
              title: fieldLabel(field),
              sub: `Auf dem Gerät: ${shown(field, conflict.wanted[field])}`,
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
                  <FieldName>{fieldLabel(field)}</FieldName>
                  <Cell className="font-semibold">{shown(field, conflict.wanted[field])}</Cell>
                </tr>
              ))}
            </tbody>
          </TablePanel>
        ) : (
          <TablePanel
            caption={`Die beiden Stände von ${name}`}
            cards={involved.map((field) => ({
              key: field,
              title: fieldLabel(field),
              sub: (
                <>
                  <span className="block">{`Auf dem Gerät: ${shown(field, conflict.wanted[field])}`}</span>
                  <span className="block">{`Im System: ${shown(field, conflict.found[field])}`}</span>
                  <span className="block">{`Das Gerät sah: ${shown(field, conflict.seen[field])}`}</span>
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
                  <FieldName>{fieldLabel(field)}</FieldName>
                  <Cell className="font-semibold">{shown(field, conflict.wanted[field])}</Cell>
                  <Cell className="font-semibold">{shown(field, conflict.found[field])}</Cell>
                  <Cell>{shown(field, conflict.seen[field])}</Cell>
                </tr>
              ))}
            </tbody>
          </TablePanel>
        )}

        {fixedDocument ? (
          <p className="text-[14px] leading-[1.5] text-ink">
            Der Beleg ist inzwischen festgeschrieben und wird nicht mehr geändert. Was auf diesem
            Gerät dazukam oder geändert wurde, lässt sich als neuer Entwurf für denselben Kunden und
            Auftrag anlegen; sein Betreff nennt den festgeschriebenen Beleg. Sonst bleibt es beim
            Stand im System.
          </p>
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
          {fixedDocument ? (
            <Button
              tone="dark"
              wide
              height={56}
              disabled={working}
              onClick={() => void asDraft(fixedDocument)}
            >
              Als neuen Entwurf anlegen
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
      kind={entityLabel(conflict.entity)}
      title={titleOf(conflict.entity, record)}
      reason={reasonText(conflict.reason)}
    >
      {settled ? (
        <p className="text-[17px] leading-[1.45]">{settled}</p>
      ) : deleting ? (
        <p className="text-[17px] leading-[1.45]">Das Gerät wollte den Eintrag löschen.</p>
      ) : (
        involved.map((field) => (
          <div key={field} className="flex flex-col gap-2">
            <SiteFieldHead>{`Feld: ${fieldLabel(field)}`}</SiteFieldHead>
            <SiteVersion icon={Smartphone} head="Auf dem Gerät">
              {shown(field, conflict.wanted[field])}
            </SiteVersion>
            {onlyOnDevice ? null : (
              <>
                <SiteVersion icon={Server} head="Im System">
                  {shown(field, conflict.found[field])}
                </SiteVersion>
                <p className="text-[15px] text-ink-muted">
                  {`Das Gerät sah: ${shown(field, conflict.seen[field])}`}
                </p>
              </>
            )}
          </div>
        ))
      )}

      {fixedDocument ? (
        <p className="text-[16px] leading-[1.45]">
          Der Beleg ist inzwischen festgeschrieben und wird nicht mehr geändert. Was auf diesem
          Gerät dazukam oder geändert wurde, lässt sich als neuer Entwurf für denselben Kunden und
          Auftrag anlegen; sein Betreff nennt den festgeschriebenen Beleg. Sonst bleibt es beim
          Stand im System.
        </p>
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
      className="overflow-hidden rounded-[6px] border-2 border-conflict bg-surface [--surface-here:var(--color-surface)]"
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
  const [working, setWorking] = useState(false)
  const { operation, message } = refused
  const title = titleOf(operation.entity, client.get(operation.entity, operation.recordId))
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
      <RefusedFrame kind={entityLabel(operation.entity)} title={title}>
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
              title: fieldLabel(patch.field),
              sub: `Auf dem Gerät: ${shown(patch.field, patch.to)}`,
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
                  <FieldName>{fieldLabel(patch.field)}</FieldName>
                  <Cell>{shown(patch.field, patch.to)}</Cell>
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
          <SiteFieldHead>{entityLabel(operation.entity)}</SiteFieldHead>
          <h2 className="mt-0.5 text-[20px] font-bold [overflow-wrap:anywhere]">{title}</h2>
          <p className="mt-1 text-[16px] font-semibold text-conflict">{message}</p>
        </div>
        <p className="text-[16px] leading-[1.45]">{explanation}</p>
        {operation.kind === 'delete' ? (
          <p className="text-[16px] leading-[1.45]">Das Gerät wollte den Eintrag löschen.</p>
        ) : (
          operation.patches.map((patch) => (
            <div key={patch.field} className="flex flex-col gap-2">
              <SiteFieldHead>{`Feld: ${fieldLabel(patch.field)}`}</SiteFieldHead>
              <SiteVersion icon={Smartphone} head="Auf dem Gerät">
                {shown(patch.field, patch.to)}
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
 * record in small capitals over its name, as the board draws the "Belegposition".
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

/** One line of "Stand des Abgleichs": a symbol, what is so, perhaps a time. */
function StateLine({
  icon: Icon,
  tone,
  strong = false,
  aside,
  children,
}: {
  readonly icon: LucideIcon
  readonly tone: 'done' | 'waiting' | 'conflict'
  readonly strong?: boolean
  readonly aside?: string
  readonly children: ReactNode
}) {
  const colour =
    tone === 'done' ? 'text-done' : tone === 'waiting' ? 'text-waiting' : 'text-conflict'

  return (
    <li className="flex items-center gap-2.5">
      <Icon size={18} strokeWidth={2.3} aria-hidden="true" className={`shrink-0 ${colour}`} />
      <span className={`grow text-[14px] ${strong ? `font-semibold ${colour}` : 'text-ink'}`}>
        {children}
      </span>
      {aside ? <span className="numeric text-[13px] text-ink-faint">{aside}</span> : null}
    </li>
  )
}

/**
 * "Stand des Abgleichs", the side card of the board: when this device last
 * exchanged with the system, what waits on it, and what somebody has to decide.
 */
export function SyncStateCard() {
  const status = useSyncStatus()
  const { conflicts, refused, pending, lastSyncedAt } = status
  const offline = status.state === 'offline' && status.trouble !== null

  return (
    <Panel title="Stand des Abgleichs">
      <ul className="flex flex-col gap-[9px]">
        <StateLine
          icon={Check}
          tone="done"
          {...(lastSyncedAt ? { aside: clockTime(lastSyncedAt) } : {})}
        >
          {lastSyncedAt ? 'Zuletzt abgeglichen' : 'Noch nicht abgeglichen'}
        </StateLine>
        {offline ? (
          <StateLine icon={WifiOff} tone="waiting">
            Keine Verbindung. Übertragen wird, sobald wieder Netz da ist.
          </StateLine>
        ) : null}
        {pending > 0 ? (
          <StateLine icon={Clock} tone="waiting">
            {pending === 1 ? '1 Vorgang wartet' : `${String(pending)} Vorgänge warten`}
          </StateLine>
        ) : null}
        {refused ? (
          <StateLine icon={TriangleAlert} tone="conflict" strong>
            Eine Änderung abgelehnt, bitte entscheiden
          </StateLine>
        ) : null}
        {conflicts.length > 0 ? (
          <StateLine icon={TriangleAlert} tone="conflict" strong>
            {conflicts.length === 1
              ? '1 Konflikt, bitte entscheiden'
              : `${String(conflicts.length)} Konflikte, bitte entscheiden`}
          </StateLine>
        ) : null}
        {pending === 0 && conflicts.length === 0 && !refused && !offline ? (
          <StateLine icon={Check} tone="done">
            Nichts wartet, nichts zu entscheiden
          </StateLine>
        ) : null}
      </ul>
    </Panel>
  )
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
 * outbox is stuck on, then the conflicts. The drafts made from a conflict are
 * said once they exist: the conflict that led to one is gone from the list,
 * and without this the draft would appear somewhere else with nobody told
 * where.
 */
export function useDecisions(): {
  readonly drafted: ReactNode
  readonly cards: ReactNode
  readonly empty: boolean
} {
  const { conflicts, refused } = useSyncStatus()
  const [drafted, setDrafted] = useState<readonly string[]>([])

  return {
    drafted:
      drafted.length > 0 ? (
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
      ) : null,
    cards: (
      <>
        {refused ? <RefusedCard key={refused.operation.id} refused={refused} /> : null}
        {conflicts.map((conflict) => (
          <ConflictCard
            key={conflict.id}
            conflict={conflict}
            onDrafted={(subject) => {
              setDrafted((before) => [...before, subject])
            }}
          />
        ))}
      </>
    ),
    empty: conflicts.length === 0 && !refused,
  }
}

/** One line of the state on site: a symbol and a sentence, 16 pixels. */
function SiteStateLine({
  icon: Icon,
  tone,
  strong = false,
  children,
}: {
  readonly icon: LucideIcon
  readonly tone: 'done' | 'waiting' | 'conflict'
  readonly strong?: boolean
  readonly children: ReactNode
}) {
  const colour =
    tone === 'done' ? 'text-done' : tone === 'waiting' ? 'text-waiting' : 'text-conflict'

  return (
    <li className="flex items-center gap-2.5">
      <Icon size={20} strokeWidth={2.3} aria-hidden="true" className={`shrink-0 ${colour}`} />
      <span
        className={`text-[16px] leading-[1.4] ${strong ? `font-semibold ${colour}` : 'text-ink'}`}
      >
        {children}
      </span>
    </li>
  )
}

/**
 * The list somebody has to work through on site, the board "Konflikte", and
 * the only screen in the application that is allowed to be empty and still
 * worth opening: when this device last exchanged, what waits on it, what is
 * to decide, and a way to try again.
 */
export function ConflictScreen() {
  const client = useSync()
  const status = useSyncStatus()
  const { drafted, cards, empty } = useDecisions()
  const { conflicts, refused, pending, lastSyncedAt } = status
  const offline = status.state === 'offline'
  const [working, setWorking] = useState(false)

  return (
    <div className="flex min-w-0 flex-col gap-3 p-4">
      <div>
        <p className="font-condensed text-[15px] font-semibold tracking-[1.2px] text-ink-faint uppercase">
          Abgleich
        </p>
        <h1 className="mt-0.5 text-[27px] leading-[1.15] font-bold">Konflikte</h1>
      </div>

      <Panel>
        <ul aria-label="Stand des Abgleichs" className="flex flex-col gap-2">
          <SiteStateLine icon={Check} tone="done">
            {lastSyncedAt
              ? `Zuletzt abgeglichen um ${clockTime(lastSyncedAt)}.`
              : 'Noch nicht abgeglichen.'}
          </SiteStateLine>
          {offline ? (
            <SiteStateLine icon={WifiOff} tone="waiting">
              Keine Verbindung. Übertragen wird, sobald wieder Netz da ist.
            </SiteStateLine>
          ) : null}
          {pending > 0 ? (
            <SiteStateLine icon={Clock} tone="waiting">
              {pending === 1
                ? '1 Änderung wartet auf dem Gerät.'
                : `${String(pending)} Änderungen warten auf dem Gerät.`}
            </SiteStateLine>
          ) : null}
          {refused ? (
            <SiteStateLine icon={TriangleAlert} tone="conflict" strong>
              Eine Änderung wurde abgelehnt und wartet auf eine Entscheidung.
            </SiteStateLine>
          ) : null}
          {conflicts.length > 0 ? (
            <SiteStateLine icon={TriangleAlert} tone="conflict" strong>
              {conflicts.length === 1
                ? 'Ein Konflikt wartet auf eine Entscheidung.'
                : `${String(conflicts.length)} Konflikte warten auf eine Entscheidung.`}
            </SiteStateLine>
          ) : null}
        </ul>
      </Panel>

      {drafted}

      {empty ? (
        <Panel title="Keine Konflikte">
          <NothingToDecide />
        </Panel>
      ) : (
        cards
      )}

      <Button
        wide
        height={52}
        icon={RefreshCw}
        disabled={working}
        onClick={() => {
          setWorking(true)
          void client.synchronise().finally(() => {
            setWorking(false)
          })
        }}
      >
        Erneut versuchen
      </Button>
    </div>
  )
}
