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
  deducts,
  lineNetCents,
  lineUnits,
  outlineRows,
  RuleError,
  shippedRules,
  showsPrices,
  totalsFor,
  vatRates,
} from '@opengewerk/domain'
import { useQuery } from '@tanstack/react-query'
import { Fragment, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import {
  Button,
  Card,
  Cell,
  Column,
  Field,
  IconButton,
  SelectField,
  Table,
  TextArea,
} from '../../components/index.js'
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
import { refusalText } from '../../sync/client.js'
import type { EditResult } from '../../sync/client.js'
import { count, maybeText, text } from '../../sync/fields.js'
import { useRelated, useSync } from '../../sync/provider.js'
import { RequestRefused } from '../../sync/transport.js'
import { Nothing, Section } from '../layout.js'
import { SnippetPicker } from './snippet-picker.js'

/** A line as the screen works with it: the record, and what is read off it. */
interface ShownLine {
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
function inOrder(records: readonly RecordState[]): readonly ShownLine[] {
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

/** The totals, or the sentence the rules answer with for a date they do not cover. */
function totalsOf(document: RecordState, lines: readonly ShownLine[]): DocumentTotals | string {
  try {
    return totalsFor(shippedRules, lines, {
      documentDate: text(document, 'documentDate'),
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
        setTrouble(refusalText[result.reason])
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-4 py-2"
      onSubmit={(event) => {
        void save(event)
      }}
    >
      <SnippetPicker
        purpose="line"
        label={item ? 'Position aus Textbaustein' : 'Titel aus Textbaustein'}
        onPick={(snippet) => {
          setDesignation(snippet.title)
          setDescription(snippet.text)
        }}
      />
      <Field
        label={item ? 'Bezeichnung' : 'Titel'}
        value={designation}
        problem={problems['designation']}
        onChange={(event) => {
          setDesignation(event.target.value)
        }}
      />
      <TextArea
        label="Beschreibung"
        rows={3}
        value={description}
        onChange={(event) => {
          setDescription(event.target.value)
        }}
      />
      {item ? (
        <div className="grid gap-4 sm:grid-cols-4">
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

      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" tone="primary" disabled={working}>
          {working ? 'Wird gespeichert' : submitLabel}
        </Button>
        <Button tone="quiet" disabled={working} onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </form>
  )
}

/**
 * The lines and what they add up to, laid out the way the printed document
 * lays them out: titles over their positions, the positions numbered below
 * them, a sum under each title. `outlineRows` does the numbering for both, so
 * position 2.3 on the screen is position 2.3 on paper.
 *
 * A report has no prices on paper and none here: quantity and what it was,
 * no price, no sum, no tax. The same `showsPrices` decides both, so the screen
 * cannot show a figure the printed report leaves out.
 */
export function LinesSection({
  document,
  editable,
}: {
  readonly document: RecordState
  readonly editable: boolean
}) {
  const client = useSync()
  const documentId = String(document['id'])
  const records = useRelated('document_lines', 'documentId', documentId)
  const lines = useMemo(() => inOrder(records), [records])
  const kind = documentKindOf(document)
  const priced = showsPrices(kind)
  const deducting = deducts(kind)
  // What earlier progress invoices billed, as they froze it. Only the server
  // holds that; everything else on this screen comes out of the local store.
  const deductions = useQuery({
    queryKey: ['deductions', documentId],
    queryFn: () => deductionsOf(documentId),
    enabled: deducting,
  })
  const taxed = priced && taxTreatmentOf(document) === 'standard'
  const rows = outlineRows(lines).filter((row) => priced || row.row !== 'subtotal')
  const totals = totalsOf(document, lines)
  const rateOf = new Map(
    typeof totals === 'string' ? [] : totals.byRate.map((entry) => [entry.rate, entry.basisPoints]),
  )
  const width = (priced ? 5 : 3) + (taxed ? 1 : 0) + (editable ? 1 : 0)
  const [adding, setAdding] = useState<LineKind | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)

  /**
   * Moves a line one step and numbers the whole list afresh. Afresh rather
   * than by swapping two numbers: after a deletion the numbers have gaps, and
   * two lines appended on two devices can share one, and a swap of two equal
   * numbers moves nothing.
   */
  async function move(id: string, step: -1 | 1) {
    const order = [...lines]
    const from = order.findIndex((line) => line.id === id)
    const [moved] = order.splice(from, 1)

    if (!moved) {
      return
    }

    order.splice(from + step, 0, moved)
    setTrouble(null)

    for (const [index, line] of order.entries()) {
      if (count(line.record, 'position') !== index + 1) {
        const result = await client.update('document_lines', line.id, { position: index + 1 })

        if (result.outcome === 'refused') {
          setTrouble(refusalText[result.reason])

          return
        }
      }
    }
  }

  async function remove(id: string) {
    setRemoving(null)

    const result = await client.remove('document_lines', id)

    setTrouble(result.outcome === 'refused' ? refusalText[result.reason] : null)
  }

  const nextPosition =
    lines.reduce((highest, line) => Math.max(highest, count(line.record, 'position')), 0) + 1

  return (
    <Section title="Positionen">
      <div className="flex flex-col gap-4">
        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}

        {lines.length === 0 ? (
          <Nothing>Noch keine Position.</Nothing>
        ) : (
          <div className="overflow-x-auto">
            <Table caption="Positionen des Belegs">
              <thead>
                <tr>
                  <Column>Pos.</Column>
                  <Column>Bezeichnung</Column>
                  <Column numeric>Menge</Column>
                  {priced ? <Column numeric>Einzelpreis</Column> : null}
                  {taxed ? <Column numeric>USt.</Column> : null}
                  {priced ? <Column numeric>Gesamt</Column> : null}
                  {editable ? <Column>Ändern</Column> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  if (row.row === 'subtotal') {
                    return (
                      <tr key={`sum-${row.number}`}>
                        <Cell> </Cell>
                        <Cell colSpan={taxed ? 4 : 3} className="font-semibold">
                          {`Summe Titel ${row.number}: ${row.designation}`}
                        </Cell>
                        <Cell numeric className="font-semibold">
                          {euros(row.netCents)}
                        </Cell>
                        {editable ? <Cell> </Cell> : null}
                      </tr>
                    )
                  }

                  const { line } = row

                  if (editing === line.id) {
                    return (
                      <tr key={line.id}>
                        <Cell colSpan={width}>
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
                        </Cell>
                      </tr>
                    )
                  }

                  const description = maybeText(line.record, 'description')
                  const title = row.row === 'title'
                  const index = lines.indexOf(line)

                  return (
                    <tr key={line.id} className={title ? 'bg-surface-sunken' : undefined}>
                      <Cell className={title ? 'font-semibold' : 'text-ink-muted'}>
                        {row.number}
                      </Cell>
                      <Cell colSpan={title ? width - 1 - (editable ? 1 : 0) : undefined}>
                        <span className={title ? 'font-semibold' : undefined}>
                          {line.designation}
                        </span>
                        {description ? (
                          <span className="block whitespace-pre-line text-table text-ink-muted">
                            {description}
                          </span>
                        ) : null}
                      </Cell>
                      {title ? null : (
                        <>
                          <Cell numeric>
                            {`${amount(count(line.record, 'quantityMilli'))} ${lineUnitShort[lineUnitOf(line.record)]}`}
                          </Cell>
                          {priced ? (
                            <Cell numeric>{euros(count(line.record, 'unitPriceCents'))}</Cell>
                          ) : null}
                          {taxed ? (
                            <Cell numeric>
                              {rateOf.has(line.vatRate)
                                ? percent(rateOf.get(line.vatRate) ?? 0)
                                : vatRateLabel[line.vatRate]}
                            </Cell>
                          ) : null}
                          {priced ? <Cell numeric>{euros(line.netCents)}</Cell> : null}
                        </>
                      )}
                      {editable ? (
                        <Cell>
                          {removing === line.id ? (
                            <span className="inline-flex flex-wrap gap-2">
                              <Button tone="danger" onClick={() => void remove(line.id)}>
                                Entfernen
                              </Button>
                              <Button
                                tone="quiet"
                                onClick={() => {
                                  setRemoving(null)
                                }}
                              >
                                Behalten
                              </Button>
                            </span>
                          ) : (
                            <span className="inline-flex flex-wrap gap-1">
                              <IconButton
                                label={`${row.number} nach oben`}
                                title="Nach oben"
                                disabled={index === 0}
                                onClick={() => void move(line.id, -1)}
                              >
                                ↑
                              </IconButton>
                              <IconButton
                                label={`${row.number} nach unten`}
                                title="Nach unten"
                                disabled={index === lines.length - 1}
                                onClick={() => void move(line.id, 1)}
                              >
                                ↓
                              </IconButton>
                              <IconButton
                                label={`${row.number} bearbeiten`}
                                title="Bearbeiten"
                                onClick={() => {
                                  setAdding(null)
                                  setEditing(line.id)
                                }}
                              >
                                ✎
                              </IconButton>
                              <IconButton
                                label={`${row.number} entfernen`}
                                title="Entfernen"
                                onClick={() => {
                                  setRemoving(line.id)
                                }}
                              >
                                ✕
                              </IconButton>
                            </span>
                          )}
                        </Cell>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          </div>
        )}

        {priced ? (
          <Totals
            totals={totals}
            taxed={taxed}
            kind={kind}
            taxTreatment={taxTreatmentOf(document)}
            deductions={deducting && Array.isArray(deductions.data) ? deductions.data : []}
            deductionTrouble={
              deductions.error
                ? deductions.error instanceof RequestRefused
                  ? deductions.error.message
                  : 'Die Abzüge früherer Abschlagsrechnungen ließen sich ohne Verbindung nicht laden.'
                : null
            }
          />
        ) : null}

        {editable && adding === null ? (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setEditing(null)
                setAdding('item')
              }}
            >
              Position hinzufügen
            </Button>
            <Button
              onClick={() => {
                setEditing(null)
                setAdding('title')
              }}
            >
              Titel hinzufügen
            </Button>
          </div>
        ) : null}

        {editable && adding !== null ? (
          <Card label={adding === 'item' ? 'Neue Position' : 'Neuer Titel'} tone="sunken">
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
          </Card>
        ) : null}
      </div>
    </Section>
  )
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
 * The figures under the lines, in the order the printed document has them:
 * the net sum, the tax per rate with the amount it is on, the total. Without
 * tax only the total, and the sentence that says why.
 *
 * An invoice that takes off earlier progress invoices goes on the way the
 * paper does: each of them with its number, date and what it billed, and then
 * what this one asks for. The arithmetic is `billedAfter` from `domain`, the
 * same the server prints with.
 */
function Totals({
  totals,
  taxed,
  kind,
  taxTreatment,
  deductions,
  deductionTrouble,
}: {
  readonly totals: DocumentTotals | string
  readonly taxed: boolean
  readonly kind: DocumentKind
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
    ? kind === 'progress_invoice'
      ? 'Leistungsstand gesamt'
      : 'Gesamtleistung'
    : 'Gesamtbetrag'

  return (
    <div className="flex flex-col items-end gap-2">
      <dl className="grid w-full max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-body">
        {taxed ? (
          <>
            <dt className="text-ink-muted">Summe netto</dt>
            <dd className="numeric text-right">{euros(totals.netCents)}</dd>
            {totals.byRate.map((entry) => (
              <Fragment key={entry.rate}>
                <dt className="text-ink-muted">
                  {`Umsatzsteuer ${percent(entry.basisPoints)} auf ${euros(entry.netCents)}`}
                </dt>
                <dd className="numeric text-right">{euros(entry.taxCents)}</dd>
              </Fragment>
            ))}
          </>
        ) : null}
        <dt className="font-semibold">{whole}</dt>
        <dd className="numeric text-right font-semibold">{euros(totals.grossCents)}</dd>
        {deductions.map((deduction) => (
          <Fragment key={deduction.number}>
            <dt className="text-ink-muted">
              {`abzüglich Abschlagsrechnung ${deduction.number} vom ${date(deduction.documentDate)}`}
              {taxed ? (
                <span className="block text-table">
                  {`netto ${euros(deduction.billed.netCents)}, Umsatzsteuer ${euros(deduction.billed.taxCents)}`}
                </span>
              ) : null}
            </dt>
            <dd className="numeric text-right">{euros(-deduction.billed.grossCents)}</dd>
          </Fragment>
        ))}
        {billed !== null && typeof billed !== 'string' ? (
          <>
            {taxed
              ? billed.byRate.map((entry) => {
                  const group =
                    billed.byRate.length === 1 ? '' : ` zu ${percent(entry.basisPoints)}`

                  return (
                    <Fragment key={entry.rate}>
                      <dt className="text-ink-muted">{`Rechnungsbetrag netto${group}`}</dt>
                      <dd className="numeric text-right">{euros(entry.netCents)}</dd>
                      <dt className="text-ink-muted">{`Umsatzsteuer${group}`}</dt>
                      <dd className="numeric text-right">{euros(entry.taxCents)}</dd>
                    </Fragment>
                  )
                })
              : null}
            <dt className="font-semibold">Rechnungsbetrag</dt>
            <dd className="numeric text-right font-semibold">{euros(billed.grossCents)}</dd>
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
