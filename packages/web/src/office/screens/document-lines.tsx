import type {
  BilledAmount,
  DeductionContent,
  DocumentKind,
  DocumentTotals,
  LineKind,
  RecordState,
  TaxTreatment,
  VatRate,
} from '@opengewerk/domain'
import {
  billedAfter,
  deductedPart,
  deducts,
  lineNetCents,
  lineUnits,
  movedInOutline,
  outlineRows,
  RuleError,
  shippedRules,
  showsPrices,
  totalsFor,
  vatRates,
} from '@opengewerk/domain'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, Plus } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import {
  Button,
  Cell,
  Column,
  Confirm,
  Field,
  SelectField,
  TablePanel,
  TextArea,
} from '../../components/index.js'
import type { TableCard } from '../../components/index.js'
import {
  amount,
  centsAsInput,
  date,
  euros,
  largestStored,
  parseEuros,
  parseQuantity,
  percent,
} from '../../app/format.js'
import {
  documentKindOf,
  lineKindOf,
  lineUnitLabel,
  lineUnitOf,
  lineUnitShort,
  taxTreatmentOf,
  vatRateLabel,
  vatRateOf,
} from '../../app/labels.js'
import { asTextOrNull } from '../../app/record-form.js'
import { deductionsOf } from '../../session/documents.js'
import { refusalFor } from '../../sync/client.js'
import type { EditResult } from '../../sync/client.js'
import { count, maybeText, text } from '../../sync/fields.js'
import { useRecord, useRelated, useSync } from '../../sync/provider.js'
import { RequestRefused } from '../../sync/transport.js'
import { Reorder } from './boards.js'
import { SnippetPicker } from './snippet-picker.js'

/** A line as the screen works with it: the record, and what is read off it. */
export interface ShownLine {
  readonly id: string
  readonly record: RecordState
  readonly kind: LineKind
  readonly designation: string
  readonly netCents: number
  readonly vatRate: VatRate
}

/**
 * The lines in the order they stand. The id breaks a tie, because two
 * devices can each append a line at the same position.
 */
export function inOrder(records: readonly RecordState[]): readonly ShownLine[] {
  return [...records]
    .sort(
      (left, right) =>
        count(left, 'position') - count(right, 'position') ||
        String(left['id']).localeCompare(String(right['id'])),
    )
    .map((record) => ({
      id: String(record['id']),
      record,
      kind: lineKindOf(record),
      designation: text(record, 'designation'),
      // Worked out here rather than read. A line this device added is still
      // in the outbox and has no total yet, because the total is the server's
      // to write. It is the same function the server uses, so the figure is
      // the one the server will store.
      netCents: lineNetCents({
        quantityMilli: count(record, 'quantityMilli'),
        unitPriceCents: count(record, 'unitPriceCents'),
      }),
      vatRate: vatRateOf(record),
    }))
}

/**
 * What the lines add up to, by the rules of the date the tax belongs to: the
 * document's own, or for a cancellation the date of the invoice it takes back.
 * The totals, or the sentence the rules answer with for a date they do not
 * cover.
 *
 * A cancellation undoes the tax that invoice stated, and should a rate change
 * between the two, its own date would work out a different tax from the same
 * lines. The server does not work it out at all, it mirrors what the invoice
 * froze; counting by the invoice's date is how the screen comes to the same.
 */
export function totalsOf(
  document: RecordState,
  lines: readonly ShownLine[],
  original: RecordState | null,
): DocumentTotals | string {
  try {
    return totalsFor(shippedRules, lines, {
      documentDate: text(original ?? document, 'documentDate'),
      taxTreatment: taxTreatmentOf(document),
    })
  } catch (error) {
    if (error instanceof RuleError) {
      return error.message
    }

    throw error
  }
}

/**
 * What a document bills after its deductions, or the sentence the rule answers
 * with when the progress invoices do not fit it.
 */
function billedOrRefusal(
  totals: DocumentTotals,
  deductions: readonly DeductionContent[],
  taxTreatment: TaxTreatment,
): BilledAmount | string {
  try {
    return billedAfter(totals, deductions, taxTreatment)
  } catch (error) {
    if (error instanceof RuleError) {
      return error.message
    }

    throw error
  }
}

/**
 * The figures of a document, worked out once for the screen: its lines, what
 * they add up to, what earlier progress invoices took off and what is left to
 * ask for. The table of lines shows them, and the head says from them when an
 * invoice is due.
 */
export interface DocumentFigures {
  readonly lines: readonly ShownLine[]
  /** A report has no prices on paper and none here. */
  readonly priced: boolean
  readonly taxed: boolean
  /** The invoice a cancellation takes back, and null for every other document. */
  readonly original: RecordState | null
  readonly totals: DocumentTotals | string
  readonly deductions: readonly DeductionContent[]
  readonly deductionTrouble: string | null
  /** What the document asks for in the end, in cents; null where that is not known. */
  readonly billedCents: number | null
}

export function useDocumentFigures(document: RecordState): DocumentFigures {
  const documentId = String(document['id'])
  const records = useRelated('document_lines', 'documentId', documentId)
  const lines = useMemo(() => inOrder(records), [records])
  const kind = documentKindOf(document)
  const priced = showsPrices(kind)
  const cancelling = kind === 'cancellation_invoice'
  // The invoice a cancellation takes back. Its kind names the figures, its
  // date says which rates they were taxed at.
  const original = useRecord(
    'documents',
    cancelling ? (maybeText(document, 'predecessorDocumentId') ?? undefined) : undefined,
  )
  // A cancellation has no chain of its own to take off. What it shows are the
  // deductions of its invoice turned round, and the server answers with those
  // out of what the cancellation froze.
  const deducting = deducts(kind) || cancelling
  // What earlier progress invoices billed, as they froze it. Only the server
  // holds that; everything else on this screen comes out of the local store.
  const answer = useQuery({
    queryKey: ['deductions', documentId],
    queryFn: () => deductionsOf(documentId),
    enabled: deducting,
  })
  const deductions = deducting && Array.isArray(answer.data) ? answer.data : []
  const totals = totalsOf(document, lines, original)
  const taxTreatment = taxTreatmentOf(document)
  const billed =
    typeof totals === 'string' ? null : billedOrRefusal(totals, deductions, taxTreatment)

  return {
    lines,
    priced,
    taxed: priced && taxTreatment === 'standard',
    original,
    totals,
    deductions,
    deductionTrouble: answer.error
      ? answer.error instanceof RequestRefused
        ? answer.error.message
        : 'Die Abzüge früherer Abschlagsrechnungen ließen sich ohne Verbindung nicht laden.'
      : null,
    billedCents: priced && billed !== null && typeof billed !== 'string' ? billed.grossCents : null,
  }
}

/**
 * What a line form hands back, ready for the outbox. A type and not an
 * interface, so that it passes as the plain record of values the outbox takes.
 */
type LineValues = {
  readonly kind: LineKind
  readonly designation: string
  readonly description: string | null
  readonly quantityMilli: number
  readonly unit: string
  readonly unitPriceCents: number
  readonly vatRate: string
}

const unitOptions = lineUnits.map((unit) => ({ value: unit, label: lineUnitLabel[unit] }))
const rateOptions = vatRates.map((rate) => ({ value: rate, label: vatRateLabel[rate] }))

/**
 * One line, new or changed. A title asks for its heading and nothing else:
 * it carries no amount, and the server refuses one that does. On a document
 * without prices, a report, a position asks for no price either.
 */
function LineForm({
  kind,
  record,
  taxed,
  priced,
  submitLabel,
  onSave,
  onCancel,
}: {
  readonly kind: LineKind
  readonly record?: RecordState
  readonly taxed: boolean
  readonly priced: boolean
  readonly submitLabel: string
  readonly onSave: (values: LineValues) => Promise<EditResult>
  readonly onCancel: () => void
}) {
  const [designation, setDesignation] = useState(text(record, 'designation'))
  const [description, setDescription] = useState(text(record, 'description'))
  const [quantity, setQuantity] = useState(record ? amount(count(record, 'quantityMilli')) : '1')
  const [unit, setUnit] = useState<string>(record ? lineUnitOf(record) : 'piece')
  const [price, setPrice] = useState(record ? centsAsInput(count(record, 'unitPriceCents')) : '')
  const [rate, setRate] = useState<string>(record ? vatRateOf(record) : 'standard')
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const item = kind === 'item'

  async function save(event: FormEvent) {
    event.preventDefault()

    const found: Record<string, string> = {}
    const quantityMilli = item ? parseQuantity(quantity) : 0
    const unitPriceCents = item && priced ? parseEuros(price) : 0

    if (designation.trim() === '') {
      found['designation'] = 'Eine Bezeichnung braucht es.'
    }

    if (quantityMilli === null) {
      found['quantity'] = 'Eine Zahl mit höchstens drei Nachkommastellen, zum Beispiel 2,5.'
    }

    if (unitPriceCents === null) {
      found['price'] = 'Ein Betrag mit höchstens zwei Nachkommastellen, zum Beispiel 49,90.'
    } else if (
      quantityMilli !== null &&
      Math.abs(lineNetCents({ quantityMilli, unitPriceCents })) > largestStored
    ) {
      found['price'] = 'Menge mal Preis ergibt mehr, als ein Beleg fassen kann.'
    }

    setProblems(found)

    if (Object.keys(found).length > 0 || quantityMilli === null || unitPriceCents === null) {
      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      const result = await onSave({
        kind,
        designation: designation.trim(),
        description: asTextOrNull(description),
        quantityMilli,
        unit: item ? unit : 'flat_rate',
        unitPriceCents,
        vatRate: item ? rate : 'standard',
      })

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        void save(event)
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={item ? 'Bezeichnung' : 'Titel'}
          value={designation}
          problem={problems['designation']}
          onChange={(event) => {
            setDesignation(event.target.value)
          }}
        />
        <SnippetPicker
          purpose="line"
          label={item ? 'Position aus Textbaustein' : 'Titel aus Textbaustein'}
          onPick={(snippet) => {
            setDesignation(snippet.title)
            setDescription(snippet.text)
          }}
        />
      </div>
      <TextArea
        label="Beschreibung"
        rows={3}
        value={description}
        onChange={(event) => {
          setDescription(event.target.value)
        }}
      />
      {item ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Menge"
            inputMode="decimal"
            numeric
            value={quantity}
            problem={problems['quantity']}
            onChange={(event) => {
              setQuantity(event.target.value)
            }}
          />
          <SelectField label="Einheit" value={unit} options={unitOptions} onChange={setUnit} />
          {priced ? (
            <Field
              label="Einzelpreis in Euro"
              inputMode="decimal"
              numeric
              value={price}
              problem={problems['price']}
              onChange={(event) => {
                setPrice(event.target.value)
              }}
            />
          ) : null}
          {priced && taxed ? (
            <SelectField label="Steuersatz" value={rate} options={rateOptions} onChange={setRate} />
          ) : null}
        </div>
      ) : null}

      {item && priced && taxed && rate === 'zero' ? (
        // The conditions of section 12 (3) UStG, because whether a line meets
        // them is the business's to judge and nothing here can check it (#127).
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          0 % nach § 12 Abs. 3 UStG, seit 2023: für Solarmodule, die für den Betrieb wesentlichen
          Komponenten und Speicher samt ihrer Installation, geliefert an den Betreiber einer Anlage
          auf oder bei Wohnungen oder Gebäuden, die dem Gemeinwohl dienen. Bei höchstens 30 kWp laut
          Marktstammdatenregister gelten die Voraussetzungen als erfüllt. Ob sie vorliegen,
          entscheidet der Betrieb.
        </p>
      ) : null}

      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" icon={record ? Check : Plus} disabled={working}>
          {working ? 'Wird gespeichert' : submitLabel}
        </Button>
        <Button tone="quiet" disabled={working} onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </form>
  )
}

/** A position or title as a sentence names it: "Position 1.2", "Titel 2". */
function lineName(kind: LineKind, number: string): string {
  return `${kind === 'title' ? 'Titel' : 'Position'} ${number}`
}

/**
 * "Positionen", the table of the boards "Angebot, Entwurf" and
 * "Schlussrechnung, festgeschrieben": titles over their positions, the
 * positions numbered below them, a sum under each title, and under the table
 * what they add up to. `outlineRows` does the numbering for the printed
 * document as well, so position 2.3 on the screen is position 2.3 on paper.
 *
 * On a draft the head of the card adds a position or a title, and the column
 * "Ändern" moves, changes and removes a line. A report has no prices on paper
 * and none here: quantity and what it was, no price, no sum, no tax. The same
 * `showsPrices` decides both.
 *
 * On a phone every row is a box, as tables are there (#218).
 */
export function LinesPanel({
  document,
  editable,
  figures,
}: {
  readonly document: RecordState
  readonly editable: boolean
  readonly figures: DocumentFigures
}) {
  const client = useSync()
  const documentId = String(document['id'])
  const kind = documentKindOf(document)
  const { lines, priced, taxed, totals } = figures
  const rows = outlineRows(lines).filter((row) => priced || row.row !== 'subtotal')
  const rateOf = new Map(
    typeof totals === 'string' ? [] : totals.byRate.map((entry) => [entry.rate, entry.basisPoints]),
  )
  const width = (priced ? 5 : 3) + (taxed ? 1 : 0) + (editable ? 1 : 0)
  // The widths of the boards: a draft has the room of the whole page, a fixed
  // document shares it with the side column and draws its figures narrower.
  const widths = editable
    ? {
        position: 'w-[50px]',
        quantity: 'w-[100px]',
        price: 'w-[100px]',
        rate: 'w-[60px]',
        total: 'w-[100px]',
      }
    : priced
      ? {
          position: 'w-[44px]',
          quantity: 'w-[90px]',
          price: 'w-[88px]',
          rate: 'w-[48px]',
          total: 'w-[92px]',
        }
      : { position: 'w-[50px]', quantity: 'w-[110px]', price: '', rate: '', total: '' }
  const [adding, setAdding] = useState<LineKind | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ id: string; name: string; title: boolean } | null>(
    null,
  )
  const [trouble, setTrouble] = useState<string | null>(null)

  /**
   * Moves a line one step, a title with its section (`movedInOutline`), and
   * numbers the whole list afresh. Afresh rather than by swapping two numbers:
   * after a deletion the numbers have gaps, and two lines appended on two
   * devices can share one, and a swap of two equal numbers moves nothing.
   */
  async function move(id: string, step: -1 | 1) {
    const order = movedInOutline(
      lines,
      lines.findIndex((line) => line.id === id),
      step,
    )

    if (!order) {
      return
    }

    setTrouble(null)

    for (const [index, line] of order.entries()) {
      if (count(line.record, 'position') !== index + 1) {
        const result = await client.update('document_lines', line.id, { position: index + 1 })

        if (result.outcome === 'refused') {
          setTrouble(refusalFor(result))

          return
        }
      }
    }
  }

  async function remove(id: string) {
    setRemoving(null)

    const result = await client.remove('document_lines', id)

    setTrouble(result.outcome === 'refused' ? refusalFor(result) : null)
  }

  const nextPosition =
    lines.reduce((highest, line) => Math.max(highest, count(line.record, 'position')), 0) + 1

  function editForm(line: ShownLine) {
    return (
      <LineForm
        kind={line.kind}
        record={line.record}
        taxed={taxed}
        priced={priced}
        submitLabel="Speichern"
        onCancel={() => {
          setEditing(null)
        }}
        onSave={async (values) => {
          const saved = await client.update('document_lines', line.id, values)

          if (saved.outcome === 'queued') {
            setEditing(null)
          }

          return saved
        }}
      />
    )
  }

  function changeButtons(line: ShownLine, number: string) {
    const index = lines.indexOf(line)

    return (
      <Reorder
        name={number}
        canUp={Boolean(movedInOutline(lines, index, -1))}
        canDown={Boolean(movedInOutline(lines, index, 1))}
        onMove={(step) => void move(line.id, step)}
        onEdit={() => {
          setAdding(null)
          setEditing(line.id)
        }}
        onRemove={() => {
          setRemoving({
            id: line.id,
            name: lineName(line.kind, number),
            title: line.kind === 'title',
          })
        }}
      />
    )
  }

  const quantityOf = (line: ShownLine) =>
    `${amount(count(line.record, 'quantityMilli'))} ${lineUnitShort[lineUnitOf(line.record)]}`
  const rateText = (line: ShownLine) =>
    rateOf.has(line.vatRate) ? percent(rateOf.get(line.vatRate) ?? 0) : vatRateLabel[line.vatRate]

  const cards: TableCard[] = rows.map((row) => {
    if (row.row === 'subtotal') {
      return {
        key: `sum-${row.number}`,
        title: (
          <span className="text-ink-muted">{`Summe Titel ${row.number}: ${row.designation}`}</span>
        ),
        right: <span className="numeric font-semibold text-ink">{euros(row.netCents)}</span>,
      }
    }

    const { line } = row

    if (editing === line.id) {
      return { key: line.id, title: line.designation, form: editForm(line) }
    }

    const description = maybeText(line.record, 'description')
    const heading = (
      <>
        <span className={row.row === 'title' ? 'font-semibold' : undefined}>
          {`${row.number} ${line.designation}`}
        </span>
        {description ? (
          <span className="block whitespace-pre-line text-[13px] text-ink-muted">
            {description}
          </span>
        ) : null}
      </>
    )

    if (row.row === 'title') {
      return {
        key: line.id,
        title: heading,
        ...(editable ? { actions: changeButtons(line, row.number) } : {}),
      }
    }

    return {
      key: line.id,
      title: heading,
      sub: [
        quantityOf(line),
        ...(priced ? [`je ${euros(count(line.record, 'unitPriceCents'))}`] : []),
        ...(taxed ? [rateText(line)] : []),
      ].join(' · '),
      ...(priced
        ? { right: <span className="numeric font-semibold text-ink">{euros(line.netCents)}</span> }
        : {}),
      ...(editable ? { actions: changeButtons(line, row.number) } : {}),
    }
  })

  const lead =
    trouble !== null || (editable && adding !== null) ? (
      <div className="flex flex-col gap-3">
        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        {editable && adding !== null ? (
          <div role="group" aria-label={adding === 'item' ? 'Neue Position' : 'Neuer Titel'}>
            <p
              aria-hidden="true"
              className="mb-2 font-condensed text-[12px] font-semibold tracking-[1.1px] text-ink-faint uppercase"
            >
              {adding === 'item' ? 'Neue Position' : 'Neuer Titel'}
            </p>
            <LineForm
              kind={adding}
              taxed={taxed}
              priced={priced}
              submitLabel={adding === 'item' ? 'Position hinzufügen' : 'Titel hinzufügen'}
              onCancel={() => {
                setAdding(null)
              }}
              onSave={async (values) => {
                const made = await client.create('document_lines', {
                  ...values,
                  documentId,
                  // At the end. Where it belongs is a move away.
                  position: nextPosition,
                })

                if (made.outcome === 'queued') {
                  setAdding(null)
                }

                return made
              }}
            />
          </div>
        ) : null}
      </div>
    ) : undefined

  return (
    <>
      <TablePanel
        title="Positionen"
        caption="Positionen des Belegs"
        action={
          editable && adding === null ? (
            <span className="flex flex-wrap gap-1.5">
              <Button
                size="small"
                icon={Plus}
                onClick={() => {
                  setEditing(null)
                  setAdding('item')
                }}
              >
                Position hinzufügen
              </Button>
              <Button
                size="small"
                icon={Plus}
                onClick={() => {
                  setEditing(null)
                  setAdding('title')
                }}
              >
                Titel hinzufügen
              </Button>
            </span>
          ) : null
        }
        lead={lead}
        cards={cards}
        cardsEmpty="Noch keine Position."
        note={
          priced ? (
            <Totals
              totals={totals}
              taxed={taxed}
              kind={kind}
              original={figures.original ? documentKindOf(figures.original) : null}
              taxTreatment={taxTreatmentOf(document)}
              deductions={figures.deductions}
              deductionTrouble={figures.deductionTrouble}
            />
          ) : undefined
        }
      >
        <thead>
          <tr>
            <Column className={widths.position}>Pos.</Column>
            <Column>Bezeichnung</Column>
            <Column numeric className={widths.quantity}>
              Menge
            </Column>
            {priced ? (
              <Column numeric className={widths.price}>
                Einzelpreis
              </Column>
            ) : null}
            {taxed ? (
              <Column numeric className={widths.rate}>
                USt.
              </Column>
            ) : null}
            {priced ? (
              <Column numeric className={widths.total}>
                Gesamt
              </Column>
            ) : null}
            {editable ? (
              <Column numeric className="w-[120px]">
                Ändern
              </Column>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <Cell colSpan={width} className="text-ink-muted">
                Noch keine Position.
              </Cell>
            </tr>
          ) : null}
          {rows.map((row) => {
            if (row.row === 'subtotal') {
              return (
                <tr key={`sum-${row.number}`}>
                  <Cell> </Cell>
                  <Cell className="text-ink-muted">{`Summe Titel ${row.number}: ${row.designation}`}</Cell>
                  <Cell> </Cell>
                  <Cell> </Cell>
                  {taxed ? <Cell> </Cell> : null}
                  <Cell numeric className="font-semibold">
                    {centsAsInput(row.netCents)}
                  </Cell>
                  {editable ? <Cell> </Cell> : null}
                </tr>
              )
            }

            const { line } = row

            if (editing === line.id) {
              return (
                <tr key={line.id}>
                  <Cell colSpan={width}>{editForm(line)}</Cell>
                </tr>
              )
            }

            const description = maybeText(line.record, 'description')
            const title = row.row === 'title'

            return (
              <tr key={line.id}>
                <Cell className={title ? 'font-semibold' : undefined}>{row.number}</Cell>
                <Cell>
                  <span className={title ? 'font-semibold' : undefined}>{line.designation}</span>
                  {description ? (
                    <span className="block whitespace-pre-line text-[12px] text-ink-faint">
                      {description}
                    </span>
                  ) : null}
                </Cell>
                {title ? (
                  <>
                    <Cell> </Cell>
                    {priced ? <Cell> </Cell> : null}
                    {taxed ? <Cell> </Cell> : null}
                    {priced ? <Cell> </Cell> : null}
                  </>
                ) : (
                  <>
                    <Cell numeric>{quantityOf(line)}</Cell>
                    {priced ? (
                      <Cell numeric>{centsAsInput(count(line.record, 'unitPriceCents'))}</Cell>
                    ) : null}
                    {taxed ? <Cell numeric>{rateText(line)}</Cell> : null}
                    {priced ? (
                      <Cell numeric className="font-semibold">
                        {centsAsInput(line.netCents)}
                      </Cell>
                    ) : null}
                  </>
                )}
                {editable ? <Cell numeric>{changeButtons(line, row.number)}</Cell> : null}
              </tr>
            )
          })}
        </tbody>
      </TablePanel>

      <Confirm
        open={removing !== null}
        title={`${removing?.name ?? 'Position'} entfernen?`}
        confirm="Entfernen"
        onConfirm={() => {
          if (removing) {
            void remove(removing.id)
          }
        }}
        onCancel={() => {
          setRemoving(null)
        }}
      >
        {removing?.title
          ? 'Der Titel verschwindet aus dem Entwurf, seine Positionen bleiben stehen.'
          : 'Die Position verschwindet aus dem Entwurf.'}
      </Confirm>
    </>
  )
}

/**
 * The small print under a deduction, in the words of the PDF. Since #189 a
 * final invoice takes off what came in on a progress invoice, and says so
 * with the day of the last payment, and says what was billed where that was
 * more; then net and tax of what is taken off, unless that is nothing.
 */
function deductionDetail(deduction: DeductionContent, taxed: boolean): string {
  const part = deductedPart(deduction)
  // A deduction from before #189 has no `received` at all.
  const received = deduction.received ?? null
  const came =
    received === null
      ? []
      : received.grossCents === 0
        ? [`gestellt ${euros(deduction.billed.grossCents)}, nichts eingegangen`]
        : [
            ...(received.grossCents === deduction.billed.grossCents
              ? []
              : [`gestellt ${euros(deduction.billed.grossCents)}`]),
            deduction.receivedOn === null
              ? 'eingegangen'
              : `eingegangen bis ${date(deduction.receivedOn)}`,
          ]
  const figures =
    taxed && part.grossCents !== 0
      ? [`netto ${euros(part.netCents)}`, `Umsatzsteuer ${euros(part.taxCents)}`]
      : []

  return [...came, ...figures].join(', ')
}

/** One row of the totals: a name at the left, a figure at the right. */
function Sum({
  strong = false,
  label,
  detail,
  children,
}: {
  readonly strong?: boolean
  readonly label: string
  /** Under the name, smaller: what a deduction took off. */
  readonly detail?: string
  readonly children: ReactNode
}) {
  return (
    <div
      className={clsx(
        'flex items-start justify-between gap-4',
        strong ? 'border-t border-line pt-[5px] text-[16px] font-bold text-ink' : 'text-ink-muted',
      )}
    >
      <dt>
        {label}
        {detail ? <span className="block text-[12px]">{detail}</span> : null}
      </dt>
      <dd className="numeric shrink-0 text-right">{children}</dd>
    </div>
  )
}

/**
 * The figures under the lines, in the order the printed document has them and
 * in its words: the net sum, the tax per rate with the amount it is on, the
 * total. Without tax only the total, and the sentence that says why.
 *
 * An invoice that takes off earlier progress invoices goes on the way the
 * paper does: each of them with its number, date and what it billed, and then
 * what this one asks for. The arithmetic is `billedAfter` from `domain`, the
 * same the server prints with.
 *
 * A cancellation shows the same rows as its invoice with every figure turned
 * round, and names them as its invoice did: a progress invoice's work so far
 * stays the work so far. What the invoice took off, the cancellation gives
 * back, and says so.
 */
function Totals({
  totals,
  taxed,
  kind,
  original,
  taxTreatment,
  deductions,
  deductionTrouble,
}: {
  readonly totals: DocumentTotals | string
  readonly taxed: boolean
  readonly kind: DocumentKind
  /** The kind of the invoice a cancellation takes back, and null otherwise. */
  readonly original: DocumentKind | null
  readonly taxTreatment: TaxTreatment
  readonly deductions: readonly DeductionContent[]
  readonly deductionTrouble: string | null
}) {
  if (typeof totals === 'string') {
    return (
      <p role="alert" className="text-body font-semibold text-conflict">
        {totals}
      </p>
    )
  }

  const deducting = deductions.length > 0
  const billed = deducting ? billedOrRefusal(totals, deductions, taxTreatment) : null
  const whole = deducting
    ? (original ?? kind) === 'progress_invoice'
      ? 'Leistungsstand gesamt'
      : 'Gesamtleistung'
    : 'Gesamtbetrag'
  const deducted =
    kind === 'cancellation_invoice'
      ? 'zurückgenommener Abzug der Abschlagsrechnung'
      : 'abzüglich Abschlagsrechnung'

  return (
    <div className="flex flex-col items-end gap-2">
      <dl
        className={clsx(
          'flex w-full flex-col gap-[5px] text-[13px]',
          deducting ? 'max-w-[420px]' : 'max-w-[330px]',
        )}
      >
        {taxed ? (
          <>
            <Sum label="Summe netto">{euros(totals.netCents)}</Sum>
            {totals.byRate.map((entry) => (
              <Sum
                key={entry.rate}
                label={`Umsatzsteuer ${percent(entry.basisPoints)} auf ${euros(entry.netCents)}`}
              >
                {euros(entry.taxCents)}
              </Sum>
            ))}
          </>
        ) : null}
        <Sum strong label={whole}>
          {euros(totals.grossCents)}
        </Sum>
        {deductions.map((deduction) => {
          const part = deductedPart(deduction)
          const detail = deductionDetail(deduction, taxed)

          return (
            <Sum
              key={deduction.number}
              label={`${deducted} ${deduction.number} vom ${date(deduction.documentDate)}`}
              {...(detail === '' ? {} : { detail })}
            >
              {euros(part.grossCents === 0 ? 0 : -part.grossCents)}
            </Sum>
          )
        })}
        {billed !== null && typeof billed !== 'string' ? (
          <>
            {taxed
              ? billed.byRate.map((entry) => {
                  const group =
                    billed.byRate.length === 1 ? '' : ` zu ${percent(entry.basisPoints)}`

                  return (
                    <Fragment key={entry.rate}>
                      <Sum label={`Rechnungsbetrag netto${group}`}>{euros(entry.netCents)}</Sum>
                      <Sum label={`Umsatzsteuer${group}`}>{euros(entry.taxCents)}</Sum>
                    </Fragment>
                  )
                })
              : null}
            <Sum strong label="Rechnungsbetrag">
              {euros(billed.grossCents)}
            </Sum>
          </>
        ) : null}
      </dl>
      {typeof billed === 'string' ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {billed}
        </p>
      ) : null}
      {deductionTrouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {deductionTrouble}
        </p>
      ) : null}
      {totals.taxNote ? <p className="text-table text-ink-muted">{totals.taxNote}</p> : null}
    </div>
  )
}
