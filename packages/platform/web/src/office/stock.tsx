import { stockUnitLabel } from '@opengewerk/platform-domain'
import { keepPreviousData, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Check, ClipboardList, Pencil, Plus, RefreshCw, Truck, Warehouse } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'

import { Button, IconButton } from '../components/button.js'
import { Dialog, DialogActions } from '../components/dialog.js'
import { Field, SelectField } from '../components/field.js'
import { cardLink, TablePanel } from '../components/panel.js'
import { Status } from '../components/status.js'
import { Cell, Column } from '../components/table.js'
import { amount, moment, parseQuantity } from '../format.js'
import {
  bookCount,
  bookReceipt,
  bookTransfer,
  keepArticle,
  type MovementRow,
  movementsOf,
  newStore,
  type StockRow,
  storeOf,
  storesOf,
  type StoreSummary,
} from '../session/stock.js'
import { Empty, NoteBox, PageHead, Screen } from './kit.js'

/**
 * The stores of the office (ADR 0011, opengewerk#298): the list with what is
 * wrong in them, one store with its stock and its bookings, and the bookings
 * the office makes, as a receipt, a transfer from another store and a count
 * that sets the stock to what was found and says why. A booking is never
 * changed; a correction is a new one.
 *
 * What a booking is called, the short name of a unit, where an article and
 * a store are found, who an account is and what a withdrawal was for are the
 * application's words. Whether a store may be a vehicle with a number plate
 * as well: an application whose concept knows vehicles says so.
 */

/** An article to take into a store or book for one, as a search of the application finds it. */
export interface StockArticleChoice {
  readonly id: string
  readonly number: string
  readonly designation: string
  readonly unit: string
}

export interface StockWords {
  /** What a booking is called, by its kind: "Zugang", "Abgang", "Umlagerung", "Zählung". */
  readonly kinds: Readonly<Record<string, string>>
  /** The short name of a unit, "m" or "Stk.". The foundation's names where it is not given. */
  readonly unit?: (unit: string) => string
}

export interface StockPaths {
  readonly stores: string
  readonly store: (storeId: string) => string
  readonly article: (articleId: string) => string
}

export interface StockScreenProps {
  readonly words: StockWords
  readonly paths: StockPaths
  /** Whether the person may keep the stores and book, as the application's right says. */
  readonly mayWrite: boolean
  /** Whether a store may be a service vehicle with a number plate. */
  readonly vehicles?: boolean
}

export interface StoreScreenProps extends StockScreenProps {
  readonly storeId: string
  /** The articles of a search, for a receipt or a place in the store. */
  readonly findArticles: (text: string) => Promise<readonly StockArticleChoice[]>
  /** What a booking was for, beyond what the stock says itself: a job, a report. */
  readonly why?: (row: MovementRow) => ReactNode
  /** The name of an account, as the application knows its people. */
  readonly who?: (userId: string) => string
}

const stockKey = ['stock'] as const
const pageSize = 20

function unitOf(words: StockWords, unit: string): string {
  return words.unit?.(unit) ?? (stockUnitLabel as Readonly<Record<string, string>>)[unit] ?? unit
}

function quantity(words: StockWords, milli: number, unit: string): string {
  return `${amount(milli)} ${unitOf(words, unit)}`
}

function problemOf(error: unknown): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : 'Das ließ sich nicht buchen.'
}

function Count({ value, tone }: { readonly value: number; readonly tone: 'waiting' | 'conflict' }) {
  return value === 0 ? (
    <span className="text-ink-faint">0</span>
  ) : (
    <Status tone={tone}>{String(value)}</Status>
  )
}

function kindOfStore(store: Pick<StoreSummary, 'vehicle' | 'plate'>): string {
  return store.vehicle ? ['Fahrzeug', store.plate].filter(Boolean).join(', ') : 'Lager'
}

/** A store with the sign of its kind before its name, a building or a vehicle. */
function StoreName({ store }: { readonly store: Pick<StoreSummary, 'name' | 'vehicle'> }) {
  const Sign = store.vehicle ? Truck : Warehouse

  return (
    <span className="inline-flex items-center gap-2">
      <Sign size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
      {store.name}
    </span>
  )
}

/** The stores, each with how many articles it keeps and what lies below its minimum or below zero. */
export function StoresScreen({ paths, mayWrite: writes, vehicles = false }: StockScreenProps) {
  const stores = useQuery({ queryKey: [...stockKey, 'stores'], queryFn: storesOf })
  const [adding, setAdding] = useState(false)
  // The stores in the buildings first, then the vehicles, each by name as the
  // server sends them.
  const rows = [...(stores.data ?? [])].sort(
    (left, right) => Number(left.vehicle === true) - Number(right.vehicle === true),
  )

  return (
    <Screen>
      <PageHead
        title="Lager"
        count={stores.isSuccess ? `${String(rows.length)} Lagerorte` : undefined}
        actions={
          writes ? (
            <Button
              tone="primary"
              icon={Plus}
              onClick={() => {
                setAdding(true)
              }}
            >
              Neuer Lagerort
            </Button>
          ) : null
        }
      />
      {stores.isSuccess && rows.length === 0 ? (
        <Empty>
          Noch kein Lagerort. Ein Lagerort ist ein Lager oder ein Fahrzeug; sein Bestand entsteht
          aus Bewegungen.
        </Empty>
      ) : (
        <TablePanel
          caption="Lagerorte"
          cards={rows.map((row) => ({
            key: row.id,
            title: (
              <Link to={paths.store(row.id)} className={cardLink}>
                {row.name}
              </Link>
            ),
            sub: [kindOfStore(row), `${String(row.articles)} Artikel`].join(' · '),
            right:
              row.belowZero > 0 ? (
                <Status tone="conflict">Unter null</Status>
              ) : row.belowMinimum > 0 ? (
                <Status tone="waiting">Nachbestellen</Status>
              ) : undefined,
          }))}
          note="Unter dem Mindestbestand bekommt das Büro eine Aufgabe, nachzubestellen. Unter null fällt ein Bestand, wenn ohne Netz mehr entnommen wurde, als da war; das Material ist verbaut, gesperrt wird nichts."
        >
          <thead>
            <tr>
              <Column className="min-w-[220px]">Lagerort</Column>
              <Column className="w-[210px] min-w-[150px]">Art</Column>
              <Column numeric className="w-[90px]">
                Artikel
              </Column>
              <Column numeric className="w-[180px]">
                Unter Mindestbestand
              </Column>
              <Column numeric className="w-[130px]">
                Unter null
              </Column>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <Cell>
                  <Link to={paths.store(row.id)} className="text-ink no-underline hover:underline">
                    <StoreName store={row} />
                  </Link>
                </Cell>
                <Cell className="text-ink-muted">{kindOfStore(row)}</Cell>
                <Cell numeric>{String(row.articles)}</Cell>
                <Cell numeric>
                  <Count value={row.belowMinimum} tone="waiting" />
                </Cell>
                <Cell numeric>
                  <Count value={row.belowZero} tone="conflict" />
                </Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}
      {adding ? (
        <NewStoreDialog
          vehicles={vehicles}
          onClose={() => {
            setAdding(false)
          }}
        />
      ) : null}
    </Screen>
  )
}

function NewStoreDialog({
  vehicles,
  onClose,
}: {
  readonly vehicles: boolean
  readonly onClose: () => void
}) {
  const queries = useQueryClient()
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [vehicle, setVehicle] = useState(false)
  const [plate, setPlate] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()

    try {
      await newStore({
        name,
        location,
        ...(vehicles ? { vehicle, plate: vehicle ? plate : null } : {}),
      })
      await queries.invalidateQueries({ queryKey: stockKey })
      onClose()
    } catch (error) {
      setProblem(problemOf(error))
    }
  }

  return (
    <Dialog title="Neuer Lagerort" onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
        <Field
          label="Bezeichnung"
          value={name}
          onChange={(event) => {
            setName(event.target.value)
          }}
          required
        />
        <Field
          label="Ort"
          value={location}
          onChange={(event) => {
            setLocation(event.target.value)
          }}
        />
        {vehicles ? (
          <>
            <label className="flex items-center gap-2 text-[14px]">
              <input
                type="checkbox"
                checked={vehicle}
                onChange={(event) => {
                  setVehicle(event.target.checked)
                }}
              />
              Servicefahrzeug
            </label>
            {vehicle ? (
              <Field
                label="Kennzeichen"
                value={plate}
                onChange={(event) => {
                  setPlate(event.target.value)
                }}
              />
            ) : null}
          </>
        ) : null}
        {problem ? (
          <p role="alert" className="m-0 text-[13px] font-semibold text-conflict">
            {problem}
          </p>
        ) : null}
        <DialogActions>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button type="submit" tone="primary" icon={Plus}>
            Anlegen
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

type Asking =
  | { readonly kind: 'transfer' }
  | { readonly kind: 'count'; readonly articleId: string | null }
  | { readonly kind: 'receipt' }
  | { readonly kind: 'keep'; readonly row: StockRow | null }

/** One store: below zero first, then its stock with place and minimum, then its bookings. */
export function StoreScreen(props: StoreScreenProps) {
  const { storeId, words, paths, mayWrite: writes, why, who } = props
  const [page, setPage] = useState(0)
  const [asking, setAsking] = useState<Asking | null>(null)
  const store = useQuery({
    queryKey: [...stockKey, 'store', storeId],
    queryFn: () => storeOf(storeId),
  })
  const moves = useQuery({
    queryKey: [...stockKey, 'movements', storeId, page],
    queryFn: () => movementsOf(storeId, page * pageSize, pageSize),
    placeholderData: keepPreviousData,
  })

  if (store.isError) {
    return (
      <Screen>
        <PageHead title="Nicht gefunden" crumbs={[{ to: paths.stores, label: 'Lager' }]} />
        <Empty>Diesen Lagerort gibt es nicht oder nicht mehr.</Empty>
      </Screen>
    )
  }

  const current = store.data
  const rows = current?.stock ?? []
  const below = rows.filter((row) => row.levelMilli < 0)
  const total = moves.data?.total ?? 0

  return (
    <Screen>
      <PageHead
        title={current?.name ?? ''}
        crumbs={[{ to: paths.stores, label: 'Lager' }]}
        badges={current?.vehicle ? <Status tone="neutral">Fahrzeug</Status> : undefined}
        sub={
          [current?.plate ? `Kennzeichen ${current.plate}` : null, current?.location ?? null]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        actions={
          writes ? (
            <>
              <Button
                icon={RefreshCw}
                onClick={() => {
                  setAsking({ kind: 'transfer' })
                }}
              >
                Umlagern
              </Button>
              <Button
                icon={ClipboardList}
                onClick={() => {
                  setAsking({ kind: 'count', articleId: null })
                }}
              >
                Zählen
              </Button>
              <Button
                tone="primary"
                icon={Plus}
                onClick={() => {
                  setAsking({ kind: 'receipt' })
                }}
              >
                Zugang buchen
              </Button>
            </>
          ) : null
        }
      />
      {below.map((row) => (
        <NoteBox
          key={row.articleId}
          tone="conflict"
          action={
            writes ? (
              <Button
                size="small"
                onClick={() => {
                  setAsking({ kind: 'count', articleId: row.articleId })
                }}
              >
                Zählen
              </Button>
            ) : undefined
          }
        >
          {`${row.designation} steht bei ${quantity(words, row.levelMilli, row.unit)}. Ohne Netz wurde mehr entnommen, als hier war. Eine Zählung setzt den Bestand auf das, was da ist.`}
        </NoteBox>
      ))}
      <TablePanel
        title="Bestand"
        caption="Bestand des Lagerorts"
        action={
          writes ? (
            <Button
              size="small"
              icon={Plus}
              onClick={() => {
                setAsking({ kind: 'keep', row: null })
              }}
            >
              Artikel aufnehmen
            </Button>
          ) : null
        }
        cards={rows.map((row) => ({
          key: row.articleId,
          title: (
            <Link to={paths.article(row.articleId)} className={cardLink}>
              {row.designation}
            </Link>
          ),
          sub: [row.number, row.bin].filter(Boolean).join(' · '),
          right: <span className="numeric">{quantity(words, row.levelMilli, row.unit)}</span>,
        }))}
      >
        <thead>
          <tr>
            <Column className="w-[80px]">Nummer</Column>
            <Column className="min-w-[220px]">Bezeichnung</Column>
            <Column className="w-[130px]">Lagerplatz</Column>
            <Column numeric className="w-[100px]">
              Bestand
            </Column>
            <Column numeric className="w-[130px]">
              Mindestbestand
            </Column>
            <Column className="w-[200px]">
              <span className="sr-only">Zustand</span>
            </Column>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const low =
              row.levelMilli >= 0 && row.minimumMilli !== null && row.levelMilli < row.minimumMilli

            return (
              <tr key={row.articleId}>
                <Cell>{row.number}</Cell>
                <Cell>
                  <Link
                    to={paths.article(row.articleId)}
                    className="text-ink no-underline hover:underline"
                  >
                    {row.designation}
                  </Link>
                </Cell>
                <Cell className="text-ink-muted">{row.bin ?? ''}</Cell>
                <Cell
                  numeric
                  className={row.levelMilli < 0 ? 'font-semibold text-conflict' : 'font-semibold'}
                >
                  {quantity(words, row.levelMilli, row.unit)}
                </Cell>
                <Cell numeric className="text-ink-muted">
                  {row.minimumMilli === null ? '' : quantity(words, row.minimumMilli, row.unit)}
                </Cell>
                <Cell>
                  <span className="flex items-center gap-2">
                    {row.levelMilli < 0 ? (
                      <Status tone="conflict">Unter null</Status>
                    ) : low ? (
                      <Status tone="waiting">Unter Mindestbestand</Status>
                    ) : null}
                    {writes ? (
                      <IconButton
                        label={`Lagerplatz und Mindestbestand von ${row.designation} ändern`}
                        onClick={() => {
                          setAsking({ kind: 'keep', row })
                        }}
                      >
                        <Pencil size={16} aria-hidden="true" />
                      </IconButton>
                    ) : null}
                  </span>
                </Cell>
              </tr>
            )
          })}
        </tbody>
      </TablePanel>
      <TablePanel
        title="Bewegungen"
        caption="Bewegungen des Lagerorts"
        cards={(moves.data?.rows ?? []).map((row) => ({
          key: row.id,
          title: `${words.kinds[row.kind] ?? row.kind} · ${row.article_designation}`,
          sub: moment(row.created_at),
          right: (
            <span className="numeric">{quantity(words, row.quantity_milli, row.article_unit)}</span>
          ),
        }))}
        footer={
          <span className="flex w-full items-center gap-2">
            <span>
              Eine Bewegung wird nicht geändert; eine Korrektur ist eine neue, etwa eine Zählung.
            </span>
            <span className="grow" />
            <Button
              size="small"
              disabled={page === 0}
              onClick={() => {
                setPage(page - 1)
              }}
            >
              Zurück
            </Button>
            <Button
              size="small"
              disabled={(page + 1) * pageSize >= total}
              onClick={() => {
                setPage(page + 1)
              }}
            >
              Weiter
            </Button>
          </span>
        }
      >
        <thead>
          <tr>
            <Column className="w-[150px]">Gebucht</Column>
            <Column className="w-[110px]">Art</Column>
            <Column className="w-[80px]">Artikel</Column>
            <Column numeric className="w-[90px]">
              Menge
            </Column>
            <Column className="min-w-[200px]">Woher oder wofür</Column>
            <Column className="w-[140px]">Von</Column>
          </tr>
        </thead>
        <tbody>
          {(moves.data?.rows ?? []).map((row) => (
            <tr key={row.id}>
              <Cell className="text-ink-muted">{moment(row.created_at)}</Cell>
              <Cell>{words.kinds[row.kind] ?? row.kind}</Cell>
              <Cell>{row.article_number}</Cell>
              <Cell numeric className="font-semibold">
                {quantity(words, row.quantity_milli, row.article_unit)}
              </Cell>
              <Cell className="text-ink-muted">{whyOf(row, why)}</Cell>
              <Cell className="text-ink-muted">
                {row.booked_by ? (who?.(row.booked_by) ?? '') : ''}
              </Cell>
            </tr>
          ))}
        </tbody>
      </TablePanel>
      {asking && current ? (
        <BookingDialog
          {...props}
          asking={asking}
          storeName={current.name}
          stock={rows}
          onClose={() => {
            setAsking(null)
          }}
        />
      ) : null}
    </Screen>
  )
}

/** What a booking was for: the application's words first, then the other store, the supplier or the reason. */
function whyOf(row: MovementRow, why: StoreScreenProps['why']): ReactNode {
  const own = why?.(row)

  if (own !== undefined && own !== null && own !== '') {
    return own
  }

  if (row.counterpart_name) {
    return row.kind === 'transfer_in'
      ? `aus ${row.counterpart_name}`
      : `nach ${row.counterpart_name}`
  }

  return row.supplier_name ?? (row.reason ? `„${row.reason}“` : '')
}

interface BookingDialogProps extends StoreScreenProps {
  readonly asking: Asking
  readonly storeName: string
  readonly stock: readonly StockRow[]
  readonly onClose: () => void
}

function BookingDialog(props: BookingDialogProps) {
  const { asking, storeId, storeName, stock, words, findArticles, onClose } = props
  const queries = useQueryClient()
  const others = useQuery({ queryKey: [...stockKey, 'stores'], queryFn: storesOf })
  const [articleId, setArticleId] = useState<string | null>(
    asking.kind === 'count'
      ? asking.articleId
      : asking.kind === 'keep'
        ? (asking.row?.articleId ?? null)
        : null,
  )
  const [picked, setPicked] = useState<StockArticleChoice | null>(null)
  const [fromId, setFromId] = useState('')
  const [quantityText, setQuantityText] = useState('')
  const [reason, setReason] = useState('')
  const [bin, setBin] = useState(asking.kind === 'keep' ? (asking.row?.bin ?? '') : '')
  const [minimum, setMinimum] = useState(
    asking.kind === 'keep' && asking.row?.minimumMilli != null
      ? amount(asking.row.minimumMilli)
      : '',
  )
  const [problem, setProblem] = useState<string | null>(null)
  // For a transfer, the other stores with what each holds of the article, as
  // the board "Lagerort: Umlagern" has it: the article first, then where from.
  const sources = useQueries({
    queries:
      asking.kind === 'transfer'
        ? (others.data ?? [])
            .filter((row) => row.id !== storeId)
            .map((row) => ({
              queryKey: [...stockKey, 'store', row.id],
              queryFn: () => storeOf(row.id),
            }))
        : [],
  })
  const holding = sources.flatMap((source) => {
    const held = source.data?.stock.find((row) => row.articleId === articleId)

    return source.data && held ? [{ store: source.data, held }] : []
  })
  const chosen = stock.find((row) => row.articleId === articleId)
  const counted = quantityText.trim() === '' ? null : parseQuantity(quantityText)
  const unit =
    chosen?.unit ?? picked?.unit ?? (asking.kind === 'keep' ? (asking.row?.unit ?? '') : '')
  const searching = asking.kind === 'receipt' || (asking.kind === 'keep' && asking.row === null)
  const titles = {
    transfer: 'Umlagern',
    count: 'Zählen',
    receipt: 'Zugang buchen',
    keep: 'Lagerplatz und Mindestbestand',
  }

  async function save(event: FormEvent) {
    event.preventDefault()

    const article = articleId ?? picked?.id ?? null
    const milli = parseQuantity(quantityText)

    try {
      if (article === null) {
        throw new Error('Erst einen Artikel wählen.')
      }

      if (asking.kind === 'keep') {
        await keepArticle(storeId, article, {
          bin: bin.trim() === '' ? null : bin.trim(),
          minimumMilli: minimum.trim() === '' ? null : parseQuantity(minimum),
        })
      } else if (milli === null) {
        throw new Error('Die Menge ist eine Zahl ab null.')
      } else if (asking.kind === 'transfer') {
        await bookTransfer(fromId, { articleId: article, quantityMilli: milli, toStoreId: storeId })
      } else if (asking.kind === 'count') {
        await bookCount(storeId, { articleId: article, quantityMilli: milli, reason })
      } else {
        await bookReceipt(storeId, { articleId: article, quantityMilli: milli })
      }

      await queries.invalidateQueries({ queryKey: stockKey })
      onClose()
    } catch (error) {
      setProblem(problemOf(error))
    }
  }

  return (
    <Dialog
      title={titles[asking.kind]}
      sub={
        asking.kind === 'transfer'
          ? 'Bucht zwei Bewegungen: einen Abgang aus dem einen Lagerort und einen Zugang in diesen.'
          : undefined
      }
      onClose={onClose}
    >
      <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
        {searching ? (
          <ArticlePicker find={findArticles} picked={picked} onPick={setPicked} />
        ) : asking.kind === 'keep' && asking.row ? (
          <Field
            label="Artikel"
            value={`${asking.row.number} ${asking.row.designation}`}
            readOnly
          />
        ) : (
          <SelectField
            label="Artikel"
            value={articleId ?? ''}
            onChange={(value) => {
              setArticleId(value === '' ? null : value)
              setFromId('')
            }}
            options={[
              { value: '', label: 'Artikel wählen' },
              ...stock.map((row) => ({
                value: row.articleId,
                label: `${row.number} ${row.designation}`,
              })),
            ]}
          />
        )}
        {asking.kind === 'transfer' ? (
          <>
            <SelectField
              label="Aus"
              value={fromId}
              disabled={articleId === null}
              hint={
                articleId !== null && holding.length === 0
                  ? 'Kein anderer Lagerort führt diesen Artikel.'
                  : undefined
              }
              onChange={setFromId}
              options={[
                { value: '', label: 'Lagerort wählen' },
                ...holding.map(({ store, held }) => ({
                  value: store.id,
                  label: `${store.name}, Bestand ${quantity(words, held.levelMilli, held.unit)}`,
                })),
              ]}
            />
            <Field label="Nach" value={storeName} readOnly />
          </>
        ) : null}
        {asking.kind === 'keep' ? (
          <>
            <Field
              label="Lagerplatz"
              value={bin}
              onChange={(event) => {
                setBin(event.target.value)
              }}
            />
            <Field
              label="Mindestbestand"
              value={minimum}
              numeric
              unit={unitOf(words, unit)}
              inputMode="decimal"
              onChange={(event) => {
                setMinimum(event.target.value)
              }}
            />
          </>
        ) : (
          <Field
            label={asking.kind === 'count' ? 'Gezählt' : 'Menge'}
            value={quantityText}
            numeric
            unit={unitOf(words, chosen?.unit ?? picked?.unit ?? '')}
            inputMode="decimal"
            required
            hint={
              asking.kind === 'count' && chosen
                ? `Bisher ${quantity(words, chosen.levelMilli, chosen.unit)}. Der Bestand steht danach bei ${
                    counted === null
                      ? 'dem, was gezählt ist'
                      : quantity(words, counted, chosen.unit)
                  }.`
                : undefined
            }
            onChange={(event) => {
              setQuantityText(event.target.value)
            }}
          />
        )}
        {asking.kind === 'count' ? (
          <Field
            label="Grund"
            value={reason}
            required
            onChange={(event) => {
              setReason(event.target.value)
            }}
          />
        ) : null}
        {problem ? (
          <p role="alert" className="m-0 text-[13px] font-semibold text-conflict">
            {problem}
          </p>
        ) : null}
        <DialogActions>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            type="submit"
            tone="primary"
            icon={
              asking.kind === 'count'
                ? Check
                : asking.kind === 'transfer'
                  ? RefreshCw
                  : asking.kind === 'receipt'
                    ? Plus
                    : undefined
            }
          >
            {asking.kind === 'count'
              ? 'Bestand setzen'
              : asking.kind === 'keep'
                ? 'Speichern'
                : titles[asking.kind]}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/** A search for an article not yet in the store, with the hits to tap. */
function ArticlePicker({
  find,
  picked,
  onPick,
}: {
  readonly find: StoreScreenProps['findArticles']
  readonly picked: StockArticleChoice | null
  readonly onPick: (article: StockArticleChoice | null) => void
}) {
  const [text, setText] = useState('')
  const hits = useQuery({
    queryKey: [...stockKey, 'choice', text],
    queryFn: () => find(text),
    enabled: text.trim().length >= 2 && picked === null,
  })

  if (picked) {
    return (
      <Field
        label="Artikel"
        value={`${picked.number} ${picked.designation}`}
        readOnly
        hint={
          <button
            type="button"
            className="text-copper-text underline"
            onClick={() => {
              onPick(null)
            }}
          >
            Anderen Artikel wählen
          </button>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <Field
        label="Artikel suchen"
        type="search"
        value={text}
        placeholder="Nummer, Bezeichnung oder EAN"
        onChange={(event) => {
          setText(event.target.value)
        }}
      />
      {(hits.data ?? []).slice(0, 8).map((hit) => (
        <button
          key={hit.id}
          type="button"
          className="flex items-center gap-2 rounded-[4px] border border-line bg-surface px-3 py-2 text-left text-[14px]"
          onClick={() => {
            onPick(hit)
          }}
        >
          <Warehouse size={16} aria-hidden="true" />
          <span className="font-semibold">{hit.number}</span>
          <span>{hit.designation}</span>
        </button>
      ))}
    </div>
  )
}
