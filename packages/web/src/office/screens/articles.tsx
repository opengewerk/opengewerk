import {
  articleProblems,
  articleUnitProblem,
  type IsoDate,
  type LineUnit,
  lineUnits,
  type PriceBase,
  priceBaseOf,
  priceBases,
  priceOn,
  priceProblems,
  priceStanding,
  supplierNumberProblem,
} from '@opengewerk/domain'
import {
  Button,
  Cell,
  Column,
  Confirm,
  Field,
  IconButton,
  Panel,
  SelectField,
  Status,
  TablePanel,
  TextArea,
  useBand,
  useButtonLook,
} from '@opengewerk/platform-web'
import { RequestRefused, text, useRecords } from '@opengewerk/platform-web/sync'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import clsx from 'clsx'
import { Check, Pencil, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, type ReactNode, useDeferredValue, useState } from 'react'

import { date, euros, parseEuros, today } from '../../app/format.js'
import { lineUnitLabel, lineUnitShort, priceBaseLabel, priceBaseText } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import {
  addArticlePrice,
  addArticleSupplier,
  addPurchasePrice,
  type ArticleFields,
  articleGroups,
  articleOf,
  articlePage,
  type ArticleQuery,
  type ArticleView,
  createArticle,
  type PriceFields,
  type PriceView,
  removeArticle,
  removeArticlePrice,
  removeArticleSupplier,
  removePurchasePrice,
  type SupplierLinkView,
  updateArticle,
  updateArticleSupplier,
} from '../../session/articles.js'
import { Chip, Empty, FactList, FilterSelect, PageHead, RecordColumns, Screen } from '../kit.js'
import { SortChoice } from '../list.js'
import { ChangesButton } from './audit-log.js'

/** What a refusal says, or a sentence for a request that never got an answer. */
export function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/** "0,92 €", or a word where there is no price. */
export function priceText(cents: number | null): string {
  return cents === null ? 'kein Preis' : euros(cents)
}

/**
 * A price and, under it, how many units it is for when that is more than one
 * (#456): "3,50 €" over "je 100 Stk.". With `always` a price for one unit
 * names its unit as well, where prices for different units share a column.
 */
export function PriceWithBase({
  cents,
  base,
  unit,
  always = false,
}: {
  readonly cents: number
  readonly base: PriceBase
  readonly unit: LineUnit
  readonly always?: boolean
}) {
  const per = always ? `je ${priceBaseLabel(base, unit)}` : priceBaseText(base, unit)

  return (
    <>
      {priceText(cents)}
      {per ? <span className="block text-[12px] font-normal text-ink-faint">{per}</span> : null}
    </>
  )
}

/** What one unit costs at a price for several, for comparing two prices (#456). */
function perUnit(price: {
  readonly unitPriceCents: number
  readonly priceBase: PriceBase
}): number {
  return price.unitPriceCents / price.priceBase
}

/**
 * The price unit of the newest of some prices, which the next one most likely
 * has as well: a form that starts at one would turn a price per 100 into one
 * per piece whenever somebody overlooks the choice (#456).
 */
function newestBase(
  prices: readonly { readonly validFrom: IsoDate; readonly priceBase: PriceBase }[],
): PriceBase {
  let newest = prices[0]

  for (const price of prices) {
    if (newest === undefined || price.validFrom > newest.validFrom) {
      newest = price
    }
  }

  return newest?.priceBase ?? 1
}

/**
 * The widest price unit among the selling and purchase prices of an article,
 * which decides whether it may become a lump sum (#456). Purchase prices a
 * role does not read are left to the server, which asks the same rule.
 */
function widestBase(article: ArticleView): PriceBase {
  const bases = [
    ...article.prices.map((price) => price.priceBase),
    ...article.suppliers.flatMap((link) =>
      (link.purchasePrices ?? []).map((price) => price.priceBase),
    ),
  ]

  return priceBaseOf(Math.max(1, ...bases))
}

/** The choices of "Preis je" for a unit: "1 Stk." to "1.000 Stk.". */
function baseOptions(unit: LineUnit) {
  return priceBases.map((base) => ({ value: String(base), label: priceBaseLabel(base, unit) }))
}

/** The mark beside a frequent article, as the tags stand beside a customer. */
export function Frequent() {
  return (
    <span className="inline-flex items-center rounded-[3px] border border-line bg-surface-sunken px-1.5 text-[12px] font-semibold whitespace-nowrap text-ink-muted">
      Häufig
    </span>
  )
}

const unitOptions = lineUnits.map((unit) => ({ value: unit, label: lineUnitLabel[unit] }))

/** How many rows one page of a list of the catalogue asks for. */
export const pageSize = 25

/**
 * Under a table the server pages: "26 bis 50 von 1.284", back and on. The
 * catalogue is not on the device, so its lists come a page at a time.
 */
export function PageFooter({
  page,
  total,
  onPage,
}: {
  readonly page: number
  readonly total: number
  readonly onPage: (page: number) => void
}) {
  const first = total === 0 ? 0 : page * pageSize + 1
  const last = Math.min(total, (page + 1) * pageSize)

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <span className="numeric">
        {total === 0
          ? 'Keine Treffer'
          : `${first.toLocaleString('de-DE')} bis ${last.toLocaleString('de-DE')} von ${total.toLocaleString('de-DE')}`}
      </span>
      <div className="grow" />
      <Button
        size="small"
        disabled={page === 0}
        onClick={() => {
          onPage(Math.max(0, page - 1))
        }}
      >
        Zurück
      </Button>
      <Button
        size="small"
        disabled={last >= total}
        onClick={() => {
          onPage(page + 1)
        }}
      >
        Weiter
      </Button>
    </div>
  )
}

/**
 * The list "Artikel" (#296), `artikel_liste()` of the canvas: the search, the
 * frequent ones as a chip, the group of goods as a choice, and the table page
 * by page, since the catalogue comes from the server and not from the device.
 */
export function ArticleListScreen() {
  const reads = useMay('article.read')
  const writes = useMay('article.write')
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [frequent, setFrequent] = useState(false)
  const [group, setGroup] = useState('')
  const [sort, setSort] = useState<ArticleQuery['sort']>('number')
  const [page, setPage] = useState(0)
  const wanted = useDeferredValue(search)
  const query: ArticleQuery = {
    search: wanted,
    frequent,
    group,
    sort,
    offset: page * pageSize,
    limit: pageSize,
  }
  const list = useQuery({
    queryKey: ['articles', 'list', query],
    queryFn: () => articlePage(query),
    enabled: reads,
    placeholderData: keepPreviousData,
  })
  const groups = useQuery({
    queryKey: ['articles', 'groups'],
    queryFn: articleGroups,
    enabled: reads,
    staleTime: 60_000,
  })
  const total = list.data?.total ?? 0
  const rows = list.data?.rows ?? []

  // A new search or filter starts at the first page again.
  const narrowing =
    (change: () => void): (() => void) =>
    () => {
      change()
      setPage(0)
    }

  return (
    // As tall as the window, so that the pages of the list stand at its foot
    // as they do under every other list.
    <Screen className="grow">
      <PageHead
        title="Artikel"
        {...(list.isSuccess ? { count: `${total.toLocaleString('de-DE')} Einträge` } : {})}
        actions={
          writes ? (
            <Button
              tone="primary"
              icon={Plus}
              onClick={() => {
                void navigate({ to: '/artikel/neu' })
              }}
            >
              Neuer Artikel
            </Button>
          ) : null
        }
      />
      {!reads ? (
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          Artikel sehen darf dieser Zugang nicht.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-[9px]">
            <label className="sr-only" htmlFor="artikel-suche">
              Artikel durchsuchen
            </label>
            <input
              id="artikel-suche"
              type="search"
              value={search}
              placeholder="Nummer, Bezeichnung, EAN, Lieferant …"
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(0)
              }}
              className="h-8 w-[300px] rounded-control border border-line-strong bg-surface px-2.5 text-[14px] text-ink max-lg:h-10 max-lg:w-full"
            />
            <Chip
              pressed={!frequent}
              onPress={narrowing(() => {
                setFrequent(false)
              })}
            >
              Alle
            </Chip>
            <Chip
              pressed={frequent}
              onPress={narrowing(() => {
                setFrequent(true)
              })}
            >
              Häufig
            </Chip>
            <FilterSelect
              label="Nach Warengruppe filtern"
              width="w-[210px]"
              value={group}
              onChange={(value) => {
                setGroup(value)
                setPage(0)
              }}
              options={[
                { value: '', label: 'Alle Warengruppen' },
                ...(Array.isArray(groups.data) ? groups.data : []).map((entry) => ({
                  value: entry,
                  label: entry,
                })),
              ]}
            />
            <div className="grow max-lg:hidden" />
            <div className="max-lg:hidden">
              <SortChoice
                options={[
                  { id: 'number', label: 'Nummer' },
                  { id: 'designation', label: 'Bezeichnung' },
                ]}
                value={sort}
                onChange={(value) => {
                  setSort(value === 'designation' ? 'designation' : 'number')
                  setPage(0)
                }}
              />
            </div>
          </div>

          {list.isPending ? (
            <p className="text-[13px] text-ink-muted">Wird geladen.</p>
          ) : list.isError ? (
            <p className="text-[13px] text-ink-muted">
              {saidWhy(
                list.error,
                'Die Artikel kamen nicht an. Die Liste braucht eine Verbindung.',
              )}
            </p>
          ) : total === 0 && wanted.trim() === '' && !frequent && group === '' ? (
            <Panel>
              <Empty>
                Noch kein Artikel. Ein Artikel übernimmt in eine Position Bezeichnung, Einheit und
                den Preis des Belegdatums.
              </Empty>
            </Panel>
          ) : (
            <TablePanel
              caption="Artikel"
              grow
              cards={rows.map((row) => ({
                key: row.id,
                title: (
                  <Link
                    to={`/artikel/${row.id}`}
                    className="text-inherit no-underline hover:underline"
                  >
                    {row.designation}
                  </Link>
                ),
                sub: [row.number, row.groupOfGoods, row.supplierName].filter(Boolean).join(' · '),
                right: (
                  <span className="numeric">
                    {row.priceCents === null ? null : (
                      <PriceWithBase
                        cents={row.priceCents}
                        base={row.priceBase ?? 1}
                        unit={row.unit}
                      />
                    )}
                  </span>
                ),
              }))}
              cardsEmpty="Kein Artikel passt zur Suche."
              footer={<PageFooter page={page} total={total} onPage={setPage} />}
            >
              <thead>
                <tr>
                  <Column className="w-[90px] min-w-[76px]">Nummer</Column>
                  <Column className="min-w-[220px]">Bezeichnung</Column>
                  <Column className="w-[170px] min-w-[140px]">Warengruppe</Column>
                  <Column className="w-[72px] min-w-[64px]">Einheit</Column>
                  <Column numeric className="w-[120px] min-w-[104px]">
                    Verkaufspreis
                  </Column>
                  <Column className="w-[250px] min-w-[180px]">Lieferant</Column>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <Cell>{row.number}</Cell>
                    <Cell>
                      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <Link to={`/artikel/${row.id}`}>{row.designation}</Link>
                        {row.frequent ? <Frequent /> : null}
                      </span>
                    </Cell>
                    <Cell className="text-ink-muted">{row.groupOfGoods ?? ''}</Cell>
                    <Cell className="text-ink-muted">{lineUnitShort[row.unit]}</Cell>
                    <Cell numeric>
                      {row.priceCents === null ? null : (
                        <PriceWithBase
                          cents={row.priceCents}
                          base={row.priceBase ?? 1}
                          unit={row.unit}
                        />
                      )}
                    </Cell>
                    <Cell className="text-ink-muted">
                      {row.supplierName ?? ''}
                      {row.suppliers > 1 ? (
                        <span className="text-ink-faint"> +{String(row.suppliers - 1)}</span>
                      ) : null}
                    </Cell>
                  </tr>
                ))}
              </tbody>
            </TablePanel>
          )}
        </>
      )}
    </Screen>
  )
}

/**
 * One article (#296), `artikel_akte()` of the canvas: its selling prices from
 * a day on, the suppliers with their numbers and purchase prices, and what it
 * is at the side. "Bearbeiten" opens the form on a page of its own.
 */
export function ArticleScreen() {
  const { articleId } = useParams({ strict: false }) as { articleId?: string }
  const writes = useMay('article.write')
  const phone = useBand() === 'S'
  const navigate = useNavigate()
  const found = useQuery({
    queryKey: ['articles', 'one', articleId],
    queryFn: () => articleOf(articleId ?? ''),
    enabled: articleId !== undefined,
  })

  if (found.isPending) {
    return (
      <Screen>
        <p className="text-[13px] text-ink-muted">Wird geladen.</p>
      </Screen>
    )
  }

  if (found.isError) {
    return (
      <Screen>
        <PageHead title="Nicht gefunden" crumbs={[{ to: '/artikel', label: 'Artikel' }]} />
        <Empty>
          {saidWhy(
            found.error,
            'Den Artikel gibt es nicht, oder es besteht gerade keine Verbindung.',
          )}
        </Empty>
      </Screen>
    )
  }

  const article = found.data
  // On a phone, whoever only reads the article gets it to read, as the board
  // "Artikel am Telefon" draws it for a technician: the price that holds and
  // the one to come, and where it comes from.
  const reading = phone && !writes

  return (
    <Screen>
      <PageHead
        title={article.designation}
        crumbs={[{ to: '/artikel', label: 'Artikel' }]}
        phoneBack={{ to: '/artikel', label: 'Artikel' }}
        badges={article.frequent ? <Status tone="neutral">Häufig</Status> : null}
        sub={[`Nummer ${article.number}`, article.groupOfGoods, lineUnitLabel[article.unit]]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            <ChangesButton table="articles" id={article.id} />
            {writes ? (
              <Button
                icon={Pencil}
                onClick={() => {
                  void navigate({ to: `/artikel/${article.id}/bearbeiten` })
                }}
              >
                Bearbeiten
              </Button>
            ) : null}
          </>
        }
      />
      <RecordColumns
        main={
          reading ? (
            <>
              <PricesToRead article={article} />
              <SuppliersToRead article={article} />
            </>
          ) : (
            <>
              <SalePrices article={article} />
              <Suppliers article={article} />
            </>
          )
        }
        side={<ArticleFacts article={article} />}
      />
    </Screen>
  )
}

function ArticleFacts({ article }: { readonly article: ArticleView }) {
  return (
    <Panel title="Angaben">
      <FactList
        keyWidth={100}
        facts={[
          { label: 'Nummer', value: article.number },
          { label: 'EAN', value: article.ean ?? '' },
          { label: 'Einheit', value: lineUnitLabel[article.unit] },
          { label: 'Warengruppe', value: article.groupOfGoods ?? '' },
          {
            label: 'Häufig',
            value: article.frequent ? 'Ja, liegt auf jedem Gerät' : 'Nein',
          },
          { label: 'Beschreibung', value: article.description ?? '' },
        ]}
      />
    </Panel>
  )
}

/**
 * The selling price to read, `artikel_telefon()` of the canvas: the one that
 * holds and the ones to come, each with its day, and none of the earlier ones.
 */
function PricesToRead({ article }: { readonly article: ArticleView }) {
  const day = today()
  const holding = priceOn(article.prices, day)
  const coming = article.prices
    .filter((price) => price.validFrom > day)
    .sort((left, right) => (left.validFrom < right.validFrom ? -1 : 1))
  const unit = lineUnitLabel[article.unit]
  const shown = [
    ...(holding ? [{ price: holding, words: `Gilt seit ${date(holding.validFrom)}` }] : []),
    ...coming.map((price) => ({ price, words: `Ab ${date(price.validFrom)}` })),
  ]

  return (
    <Panel title="Verkaufspreis">
      {shown.length === 0 ? (
        <p className="text-[13px] text-ink-muted">Noch kein Preis.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map(({ price, words }) => (
            <li key={price.id} className="flex items-baseline justify-between gap-2.5">
              <span className="text-[14px]">{words}</span>
              <b className="numeric text-[16px] font-semibold">
                {`${priceText(price.unitPriceCents)} je ${
                  price.priceBase > 1 ? priceBaseLabel(price.priceBase, article.unit) : unit
                }`}
              </b>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** Where the article comes from, to read: each supplier and its number for it. */
function SuppliersToRead({ article }: { readonly article: ArticleView }) {
  return (
    <Panel title="Lieferanten">
      {article.suppliers.length === 0 ? (
        <p className="text-[13px] text-ink-muted">Noch kein Lieferant.</p>
      ) : (
        <ul>
          {article.suppliers.map((link) => (
            <li key={link.id} className="border-b border-row py-2">
              <Link
                to={`/lieferanten/${link.supplierId}`}
                className="text-[14px] text-copper-text underline underline-offset-2"
              >
                {link.supplierName}
              </Link>
              {link.supplierNumber ? (
                <div className="text-[13px] text-ink-faint">
                  Artikelnummer dort: {link.supplierNumber}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[13px] leading-[1.45] text-ink-faint">
        Einkaufspreise sehen Inhaber und Büro.
      </p>
    </Panel>
  )
}

/** The words beside a price: "Kommt", "Gilt", "Vorher". */
function Standing({
  price,
  prices,
}: {
  readonly price: PriceView
  readonly prices: readonly PriceView[]
}) {
  const standing = priceStanding(price, prices, today())

  if (standing === 'coming') {
    return <Status tone="waiting">Kommt</Status>
  }

  return standing === 'current' ? (
    <Status tone="done">Gilt</Status>
  ) : (
    <span className="text-ink-faint">Vorher</span>
  )
}

/**
 * The selling prices, newest first. A position takes the one of its date; a
 * new price changes no document that has the article already. The price that
 * holds and the one to come stand out, as on the board.
 */
function SalePrices({ article }: { readonly article: ArticleView }) {
  const writes = useMay('article.write')
  const client = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<PriceView | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const unit = lineUnitLabel[article.unit]
  // Prices for more than one unit say for how many, each in its cell; as
  // long as every price is for one, the column says it once (#456).
  const mixed = article.prices.some((price) => price.priceBase > 1)

  async function remove(price: PriceView) {
    setRemoving(null)

    try {
      await removeArticlePrice(article.id, price.id)
      setTrouble(null)
      await client.invalidateQueries({ queryKey: ['articles'] })
    } catch (error) {
      setTrouble(saidWhy(error, 'Der Preis ließ sich nicht entfernen. Keine Verbindung.'))
    }
  }

  const removeButton = (price: PriceView) => (
    <IconButton
      label={`Preis ab ${date(price.validFrom)} entfernen`}
      onClick={() => {
        setRemoving(price)
      }}
    >
      <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
    </IconButton>
  )
  const figure = (price: PriceView) => (
    <span
      className={clsx(
        priceStanding(price, article.prices, today()) !== 'earlier' && 'font-semibold',
      )}
    >
      <PriceWithBase
        cents={price.unitPriceCents}
        base={price.priceBase}
        unit={article.unit}
        always={mixed}
      />
    </span>
  )

  return (
    <>
      <TablePanel
        title="Verkaufspreis"
        caption="Verkaufspreis"
        action={
          writes && !adding ? (
            <Button
              size="small"
              icon={Plus}
              onClick={() => {
                setAdding(true)
              }}
            >
              Neuer Preis
            </Button>
          ) : null
        }
        lead={
          adding ? (
            <PriceForm
              submitLabel="Preis anlegen"
              unit={article.unit}
              startBase={newestBase(article.prices)}
              onCancel={() => {
                setAdding(false)
              }}
              onSave={async (price) => {
                await addArticlePrice(article.id, price)
                setAdding(false)
                await client.invalidateQueries({ queryKey: ['articles'] })
              }}
            />
          ) : null
        }
        cards={article.prices.map((price) => ({
          key: price.id,
          title: `ab ${date(price.validFrom)}`,
          right: <span className="numeric">{figure(price)}</span>,
          sub: <Standing price={price} prices={article.prices} />,
          actions: writes ? removeButton(price) : null,
        }))}
        cardsEmpty="Noch kein Preis."
        note="Eine Position nimmt den Preis, der an ihrem Belegdatum gilt, mit seiner Preiseinheit. Ein neuer Preis ändert keinen Beleg, der den Artikel schon hat."
      >
        <thead>
          <tr>
            <Column className="w-[130px] min-w-[110px]">Gültig ab</Column>
            <Column numeric className="min-w-[120px]">
              {mixed ? 'Preis' : `Preis je ${unit}`}
            </Column>
            <Column className="w-[150px] min-w-[110px]">Stand</Column>
            {writes ? (
              <Column numeric className="w-[56px] min-w-[56px]">
                <span className="sr-only">Entfernen</span>
              </Column>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {article.prices.length === 0 ? (
            <tr>
              <Cell className="text-ink-muted" colSpan={writes ? 4 : 3}>
                Noch kein Preis. Ohne Preis übernimmt eine Position 0,00 €.
              </Cell>
            </tr>
          ) : (
            article.prices.map((price) => (
              <tr key={price.id}>
                <Cell>{date(price.validFrom)}</Cell>
                <Cell numeric>{figure(price)}</Cell>
                <Cell>
                  <Standing price={price} prices={article.prices} />
                </Cell>
                {writes ? <Cell numeric>{removeButton(price)}</Cell> : null}
              </tr>
            ))
          )}
        </tbody>
      </TablePanel>
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <Confirm
        open={removing !== null}
        title={removing ? `Preis ab ${date(removing.validFrom)} entfernen?` : ''}
        confirm="Entfernen"
        tone="danger"
        onConfirm={() => {
          if (removing) {
            void remove(removing)
          }
        }}
        onCancel={() => {
          setRemoving(null)
        }}
      >
        Belege, die ihn schon haben, behalten ihren Preis. Das Änderungsprotokoll hält fest, was
        entfernt wurde.
      </Confirm>
    </>
  )
}

/** A price from a day on: the amount and the day, today unless somebody says otherwise. */
function PriceForm({
  submitLabel,
  unit,
  startBase = 1,
  onSave,
  onCancel,
  extra,
  className = 'border-b border-line px-3.5 py-3',
}: {
  readonly submitLabel: string
  /** What the article is counted in, which "Preis je" names (#456). */
  readonly unit: LineUnit
  /** The price unit "Preis je" starts at, that of the newest price. */
  readonly startBase?: PriceBase
  readonly onSave: (price: PriceFields) => Promise<void>
  readonly onCancel: () => void
  readonly extra?: ReactNode
  /** The frame around it: a strip over a table, or nothing inside another form. */
  readonly className?: string
}) {
  const [amount, setAmount] = useState('')
  const [base, setBase] = useState(String(startBase))
  const [day, setDay] = useState<IsoDate>(today())
  // A lump sum is for one of it, as on a position.
  const perUnits = unit !== 'flat_rate'
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()

    const cents = parseEuros(amount)
    const priceBase = perUnits ? priceBaseOf(Number(base)) : 1
    const found = priceProblems({ unitPriceCents: cents ?? Number.NaN, validFrom: day, priceBase })

    setProblems(found)

    if (Object.keys(found).length > 0 || cents === null) {
      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      await onSave({ unitPriceCents: cents, priceBase, validFrom: day })
    } catch (error) {
      setTrouble(saidWhy(error, 'Der Preis ließ sich nicht speichern. Keine Verbindung.'))
    } finally {
      setWorking(false)
    }
  }

  return (
    <form
      className={clsx('flex flex-col gap-3', className)}
      onSubmit={(event) => {
        void save(event)
      }}
    >
      {extra}
      <div className={clsx('grid gap-3', perUnits ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        <Field
          label="Preis in Euro"
          inputMode="decimal"
          numeric
          value={amount}
          problem={problems['unitPriceCents']}
          onChange={(event) => {
            setAmount(event.target.value)
          }}
        />
        {perUnits ? (
          <SelectField
            label="Preis je"
            value={base}
            options={baseOptions(unit)}
            onChange={setBase}
            hint="Für wie viele Einheiten der Preis gilt."
          />
        ) : null}
        <Field
          label="Gültig ab"
          type="date"
          required
          value={day}
          problem={problems['validFrom']}
          onChange={(event) => {
            setDay(event.target.value)
          }}
        />
      </div>
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" tone="primary" icon={Check} disabled={working}>
          {working ? 'Wird gespeichert' : submitLabel}
        </Button>
        <Button tone="quiet" disabled={working} onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </form>
  )
}

/** The purchase price of today among the prices of one supplier. */
function priceOnDay(prices: readonly PriceView[]): PriceView | undefined {
  const day = today()

  return prices
    .filter((price) => price.validFrom <= day)
    .sort((left, right) => (left.validFrom < right.validFrom ? 1 : -1))[0]
}

/**
 * Who sells the article, under which number, and for how much: the purchase
 * prices only for whoever may read them, and the column is not even there for
 * anybody else. Where two suppliers have a price today, the lower one stands
 * out, as on the board. "Ändern" opens the supplier's number, its purchase
 * prices and its removal over the table, one supplier at a time.
 */
function Suppliers({ article }: { readonly article: ArticleView }) {
  const writes = useMay('article.write')
  const readsPurchase = useMay('purchase.read')
  const client = useQueryClient()
  const suppliers = useRecords('suppliers')
  const [adding, setAdding] = useState(false)
  const [supplierId, setSupplierId] = useState('')
  const [number, setNumber] = useState('')
  const [changing, setChanging] = useState<string | null>(null)
  const [removing, setRemoving] = useState<SupplierLinkView | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const keepsPurchase = useMay('purchase.write')
  const linked = new Set(article.suppliers.map((link) => link.supplierId))
  const choices = suppliers
    .filter((record) => !linked.has(text(record, 'id')))
    .map((record) => ({ value: text(record, 'id'), label: text(record, 'name') }))
    .sort((left, right) => left.label.localeCompare(right.label, 'de'))
  const changed = article.suppliers.find((link) => link.id === changing) ?? null

  const refresh = () => client.invalidateQueries({ queryKey: ['articles'] })

  async function remove(link: SupplierLinkView) {
    setRemoving(null)

    try {
      await removeArticleSupplier(article.id, link.id)
      setTrouble(null)
      setChanging(null)
      await refresh()
    } catch (error) {
      setTrouble(saidWhy(error, 'Der Lieferant ließ sich nicht entfernen. Keine Verbindung.'))
    }
  }

  const current = (link: SupplierLinkView) =>
    link.purchasePrices === null ? null : (priceOnDay(link.purchasePrices) ?? null)
  // Compared per unit: 2,10 € per 100 is less than 0,03 € per piece (#456).
  const priced = article.suppliers
    .map((link) => current(link))
    .filter((price): price is PriceView => price !== null)
    .map(perUnit)
  const lowest = priced.length > 1 ? Math.min(...priced) : null
  const purchase = (link: SupplierLinkView) => {
    const price = current(link)

    return price ? (
      <span className={clsx(perUnit(price) === lowest && 'font-semibold')}>
        <PriceWithBase cents={price.unitPriceCents} base={price.priceBase} unit={article.unit} />
      </span>
    ) : (
      ''
    )
  }
  const changeButton = (link: SupplierLinkView) => (
    <Button
      size="small"
      aria-label={`${link.supplierName} ändern`}
      onClick={() => {
        setAdding(false)
        setChanging(link.id)
      }}
    >
      Ändern
    </Button>
  )

  return (
    <>
      <TablePanel
        title={readsPurchase ? 'Lieferanten und Einkaufspreise' : 'Lieferanten'}
        caption={readsPurchase ? 'Lieferanten und Einkaufspreise' : 'Lieferanten'}
        action={
          writes && !adding ? (
            <Button
              size="small"
              icon={Plus}
              disabled={choices.length === 0}
              onClick={() => {
                setChanging(null)
                setAdding(true)
                setSupplierId(choices[0]?.value ?? '')
              }}
            >
              Lieferant hinzufügen
            </Button>
          ) : null
        }
        lead={
          adding ? (
            <PriceForm
              submitLabel="Lieferant hinzufügen"
              unit={article.unit}
              extra={
                <div className="grid gap-3 sm:grid-cols-2">
                  <SelectField
                    label="Lieferant"
                    value={supplierId}
                    options={choices}
                    onChange={setSupplierId}
                  />
                  <Field
                    label="Artikelnummer dort"
                    value={number}
                    onChange={(event) => {
                      setNumber(event.target.value)
                    }}
                  />
                </div>
              }
              onCancel={() => {
                setAdding(false)
              }}
              onSave={async (price) => {
                await addArticleSupplier(article.id, {
                  supplierId,
                  supplierNumber: number,
                  price: keepsPurchase ? price : null,
                })
                setAdding(false)
                setNumber('')
                await refresh()
              }}
            />
          ) : changed ? (
            <SupplierLinkForm
              key={changed.id}
              articleId={article.id}
              unit={article.unit}
              link={changed}
              onRemove={setRemoving}
              onClose={() => {
                setChanging(null)
              }}
            />
          ) : null
        }
        cards={article.suppliers.map((link) => ({
          key: link.id,
          title: <Link to={`/lieferanten/${link.supplierId}`}>{link.supplierName}</Link>,
          sub: link.supplierNumber ? `Artikelnummer dort: ${link.supplierNumber}` : undefined,
          right: readsPurchase ? <span className="numeric">{purchase(link)}</span> : undefined,
          actions: writes ? changeButton(link) : null,
        }))}
        cardsEmpty="Noch kein Lieferant."
        note={
          readsPurchase
            ? 'Einkaufspreise sehen Inhaber und Büro. Auf der Baustelle und in der Rolle Monteur stehen sie nirgends.'
            : 'Einkaufspreise sehen Inhaber und Büro.'
        }
      >
        <thead>
          <tr>
            <Column className="min-w-[180px]">Lieferant</Column>
            <Column className="w-[150px] min-w-[120px]">Artikelnummer dort</Column>
            {readsPurchase ? (
              <>
                <Column numeric className="w-[110px] min-w-[100px]">
                  Einkaufspreis
                </Column>
                <Column className="w-[100px] min-w-[96px]">Gültig ab</Column>
              </>
            ) : null}
            {writes ? (
              <Column numeric className="w-[88px] min-w-[88px]">
                <span className="sr-only">Ändern</span>
              </Column>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {article.suppliers.length === 0 ? (
            <tr>
              <Cell
                className="text-ink-muted"
                colSpan={2 + (readsPurchase ? 2 : 0) + (writes ? 1 : 0)}
              >
                Noch kein Lieferant.
              </Cell>
            </tr>
          ) : (
            article.suppliers.map((link) => {
              const price = current(link)

              return (
                <tr key={link.id}>
                  <Cell>
                    <Link to={`/lieferanten/${link.supplierId}`}>{link.supplierName}</Link>
                  </Cell>
                  <Cell>{link.supplierNumber ?? ''}</Cell>
                  {readsPurchase ? (
                    <>
                      <Cell numeric>{purchase(link)}</Cell>
                      <Cell>{price ? date(price.validFrom) : ''}</Cell>
                    </>
                  ) : null}
                  {writes ? <Cell numeric>{changeButton(link)}</Cell> : null}
                </tr>
              )
            })
          )}
        </tbody>
      </TablePanel>
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <Confirm
        open={removing !== null}
        title={removing ? `„${removing.supplierName}“ entfernen?` : ''}
        confirm="Entfernen"
        tone="danger"
        onConfirm={() => {
          if (removing) {
            void remove(removing)
          }
        }}
        onCancel={() => {
          setRemoving(null)
        }}
      >
        Der Lieferant führt den Artikel dann nicht mehr, und seine Einkaufspreise für ihn gehen mit.
      </Confirm>
    </>
  )
}

/**
 * One supplier of the article, opened over the table: its number for the
 * article, its purchase prices from a day on for whoever keeps them, and the
 * way to take it off the article.
 */
function SupplierLinkForm({
  articleId,
  unit,
  link,
  onRemove,
  onClose,
}: {
  readonly articleId: string
  readonly unit: LineUnit
  readonly link: SupplierLinkView
  readonly onRemove: (link: SupplierLinkView) => void
  readonly onClose: () => void
}) {
  const client = useQueryClient()
  const keepsPurchase = useMay('purchase.write')
  const [number, setNumber] = useState(link.supplierNumber ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const [pricing, setPricing] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const prices = link.purchasePrices ?? []

  const refresh = () => client.invalidateQueries({ queryKey: ['articles'] })

  async function saveNumber(event: FormEvent) {
    event.preventDefault()

    const found = supplierNumberProblem(number)

    setProblem(found)

    if (found) {
      return
    }

    try {
      await updateArticleSupplier(articleId, link.id, number)
      await refresh()
    } catch (error) {
      setProblem(saidWhy(error, 'Die Nummer ließ sich nicht speichern. Keine Verbindung.'))
    }
  }

  async function removePrice(price: PriceView) {
    try {
      await removePurchasePrice(articleId, link.id, price.id)
      setTrouble(null)
      await refresh()
    } catch (error) {
      setTrouble(saidWhy(error, 'Der Preis ließ sich nicht entfernen. Keine Verbindung.'))
    }
  }

  return (
    <section
      aria-label={`${link.supplierName} ändern`}
      className="flex flex-col gap-3 border-b border-line px-3.5 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold">{link.supplierName}</h3>
        <div className="grow" />
        <Button size="small" tone="quiet" onClick={onClose}>
          Schließen
        </Button>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          void saveNumber(event)
        }}
      >
        <div className="min-w-[200px] grow">
          <Field
            label="Artikelnummer dort"
            value={number}
            problem={problem ?? undefined}
            onChange={(event) => {
              setNumber(event.target.value)
            }}
          />
        </div>
        <Button type="submit" size="small" icon={Check}>
          Nummer speichern
        </Button>
      </form>
      {keepsPurchase ? (
        <div className="flex flex-col gap-2">
          <h4 className="font-condensed text-[12px] font-semibold tracking-[1.1px] text-ink-faint uppercase">
            Einkaufspreise
          </h4>
          {prices.length === 0 ? (
            <p className="text-[13px] text-ink-muted">Noch kein Einkaufspreis.</p>
          ) : (
            <ul className="flex flex-col">
              {prices.map((price) => (
                <li
                  key={price.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-row py-1 text-[14px] last:border-b-0"
                >
                  <span className="numeric w-[96px]">ab {date(price.validFrom)}</span>
                  <span className="numeric w-[96px] text-right">
                    <PriceWithBase
                      cents={price.unitPriceCents}
                      base={price.priceBase}
                      unit={unit}
                    />
                  </span>
                  <Standing price={price} prices={prices} />
                  <div className="grow" />
                  <IconButton
                    label={`Einkaufspreis ab ${date(price.validFrom)} entfernen`}
                    onClick={() => {
                      void removePrice(price)
                    }}
                  >
                    <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
          {pricing ? (
            <PriceForm
              className=""
              submitLabel="Einkaufspreis anlegen"
              unit={unit}
              startBase={newestBase(prices)}
              onCancel={() => {
                setPricing(false)
              }}
              onSave={async (price) => {
                await addPurchasePrice(articleId, link.id, price)
                setPricing(false)
                await refresh()
              }}
            />
          ) : (
            <div>
              <Button
                size="small"
                icon={Plus}
                onClick={() => {
                  setPricing(true)
                }}
              >
                Neuer Einkaufspreis
              </Button>
            </div>
          )}
        </div>
      ) : null}
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <div>
        <Button
          size="small"
          tone="danger"
          icon={Trash2}
          onClick={() => {
            onRemove(link)
          }}
        >
          Lieferant entfernen
        </Button>
      </div>
    </section>
  )
}

/** The fields of the form, as typed. */
interface ArticleDraft {
  readonly number: string
  readonly designation: string
  readonly description: string
  readonly ean: string
  readonly unit: LineUnit
  readonly groupOfGoods: string
  readonly frequent: boolean
}

function draftOf(article: ArticleView | null): ArticleDraft {
  return {
    number: article?.number ?? '',
    designation: article?.designation ?? '',
    description: article?.description ?? '',
    ean: article?.ean ?? '',
    unit: article?.unit ?? 'piece',
    groupOfGoods: article?.groupOfGoods ?? '',
    frequent: article?.frequent ?? false,
  }
}

/**
 * An article to create or to change, `neuer_artikel()` of the canvas: what it
 * is, and for a new one a first selling price from a day on, with the two
 * buttons in the head. Every change goes to the server at once; the catalogue
 * is not on the device.
 */
function ArticleFormScreen({ article }: { readonly article: ArticleView | null }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const groups = useQuery({
    queryKey: ['articles', 'groups'],
    queryFn: articleGroups,
    staleTime: 60_000,
  })
  const [draft, setDraft] = useState<ArticleDraft>(() => draftOf(article))
  const [amount, setAmount] = useState('')
  const [base, setBase] = useState('1')
  const [day, setDay] = useState<IsoDate>(today())
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const listId = 'artikel-warengruppen'
  // The first price is for as many units as chosen, one for a lump sum (#456).
  const priceBase = draft.unit === 'flat_rate' ? 1 : priceBaseOf(Number(base))

  const set =
    <Field extends keyof ArticleDraft>(field: Field) =>
    (value: ArticleDraft[Field]) => {
      setDraft((current) => ({ ...current, [field]: value }))
    }
  const back = () => {
    void navigate({ to: article ? `/artikel/${article.id}` : '/artikel' })
  }

  async function save(fields: ArticleFields, cents: number | null): Promise<string> {
    if (article) {
      await updateArticle(article.id, fields)

      return article.id
    }

    const created = await createArticle(
      fields,
      cents === null ? null : { unitPriceCents: cents, priceBase, validFrom: day },
    )

    return created.id
  }

  async function submit(event: FormEvent) {
    event.preventDefault()

    const fields: ArticleFields = { ...draft }
    const values: Readonly<Record<string, unknown>> = { ...fields }
    const found: Record<string, string> = { ...articleProblems(values) }
    const cents = amount.trim() === '' ? null : parseEuros(amount)
    const unitProblem = article ? articleUnitProblem(fields.unit, widestBase(article)) : null

    if (unitProblem) {
      found['unit'] = unitProblem
    }

    if (!article && amount.trim() !== '') {
      Object.assign(
        found,
        priceProblems({ unitPriceCents: cents ?? Number.NaN, validFrom: day, priceBase }),
      )
    }

    setProblems(found)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      const id = await save(fields, cents)

      await client.invalidateQueries({ queryKey: ['articles'] })
      await navigate({ to: `/artikel/${id}` })
    } catch (error) {
      setTrouble(saidWhy(error, 'Der Artikel ließ sich nicht speichern. Keine Verbindung.'))
    } finally {
      setWorking(false)
    }
  }

  return (
    <Screen>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <PageHead
          title={article ? `${article.designation} bearbeiten` : 'Neuer Artikel'}
          crumbs={
            article
              ? [
                  { to: '/artikel', label: 'Artikel' },
                  { to: `/artikel/${article.id}`, label: article.designation },
                ]
              : [{ to: '/artikel', label: 'Artikel' }]
          }
          actions={
            <>
              <Button onClick={back} disabled={working}>
                Abbrechen
              </Button>
              <Button type="submit" tone="primary" icon={Check} disabled={working}>
                {working ? 'Wird gespeichert' : article ? 'Speichern' : 'Artikel anlegen'}
              </Button>
            </>
          }
        />
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <div className="flex max-w-[760px] flex-col gap-3">
          <Panel title="Artikel" roomy>
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Nummer"
                  required
                  value={draft.number}
                  problem={problems['number']}
                  hint="Die eigene Nummer im Betrieb, jede nur einmal."
                  onChange={(event) => {
                    set('number')(event.target.value)
                  }}
                />
                <Field
                  label="EAN"
                  inputMode="numeric"
                  value={draft.ean}
                  placeholder="13 oder 8 Ziffern"
                  problem={problems['ean']}
                  hint="Die letzte Ziffer ist die Prüfziffer."
                  onChange={(event) => {
                    set('ean')(event.target.value)
                  }}
                />
              </div>
              <Field
                label="Bezeichnung"
                required
                value={draft.designation}
                problem={problems['designation']}
                onChange={(event) => {
                  set('designation')(event.target.value)
                }}
              />
              <TextArea
                label="Beschreibung"
                rows={3}
                value={draft.description}
                hint="Wird zur Beschreibung einer Position, die den Artikel übernimmt."
                onChange={(event) => {
                  set('description')(event.target.value)
                }}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  label="Einheit"
                  value={draft.unit}
                  options={unitOptions}
                  problem={problems['unit']}
                  onChange={(value) => {
                    set('unit')(lineUnits.find((unit) => unit === value) ?? 'piece')
                  }}
                />
                <Field
                  label="Warengruppe"
                  value={draft.groupOfGoods}
                  list={listId}
                  problem={problems['groupOfGoods']}
                  hint="Frei wählbar. Die Liste filtert danach."
                  onChange={(event) => {
                    set('groupOfGoods')(event.target.value)
                  }}
                />
                <datalist id={listId}>
                  {(Array.isArray(groups.data) ? groups.data : []).map((entry) => (
                    <option key={entry} value={entry} />
                  ))}
                </datalist>
              </div>
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-copper-solid"
                  checked={draft.frequent}
                  onChange={(event) => {
                    set('frequent')(event.target.checked)
                  }}
                />
                <span className="text-[14px] leading-[1.4]">
                  Häufig
                  <span className="block text-[13px] text-ink-muted">
                    Liegt auf jedem Gerät, auch ohne Netz. Ohne die Markierung nur, wenn der Artikel
                    in den letzten 90 Tagen in einem Beleg oder Regiebericht stand.
                  </span>
                </span>
              </label>
            </div>
          </Panel>
          {article ? (
            <div className="flex flex-wrap gap-2">
              <RemoveArticle article={article} />
            </div>
          ) : (
            <Panel title="Verkaufspreis" roomy>
              <p className="-mt-[3px] mb-2.5 text-[13px] text-ink-faint">
                Leer lassen, wenn es noch keinen gibt. Weitere Preise kommen an der Seite des
                Artikels dazu, jeder ab einem Tag.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field
                  label="Preis in Euro"
                  inputMode="decimal"
                  numeric
                  value={amount}
                  problem={problems['unitPriceCents']}
                  onChange={(event) => {
                    setAmount(event.target.value)
                  }}
                />
                {draft.unit === 'flat_rate' ? null : (
                  <SelectField
                    label="Preis je"
                    value={base}
                    options={baseOptions(draft.unit)}
                    onChange={setBase}
                    hint="Für wie viele Einheiten der Preis gilt."
                  />
                )}
                <Field
                  label="Gültig ab"
                  type="date"
                  value={day}
                  problem={problems['validFrom']}
                  onChange={(event) => {
                    setDay(event.target.value)
                  }}
                />
              </div>
            </Panel>
          )}
        </div>
      </form>
    </Screen>
  )
}

/** Deleting an article, with a question first; positions keep their text. */
function RemoveArticle({ article }: { readonly article: ArticleView }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [asking, setAsking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  return (
    <>
      <Button
        tone="danger"
        icon={Trash2}
        onClick={() => {
          setAsking(true)
        }}
      >
        Artikel löschen
      </Button>
      {trouble ? (
        <p role="alert" className="basis-full text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <Confirm
        open={asking}
        title={`„${article.designation}“ löschen?`}
        confirm="Löschen"
        tone="danger"
        onConfirm={() => {
          setAsking(false)
          void removeArticle(article.id)
            .then(async () => {
              await client.invalidateQueries({ queryKey: ['articles'] })
              await navigate({ to: '/artikel' })
            })
            .catch((error: unknown) => {
              setTrouble(saidWhy(error, 'Der Artikel ließ sich nicht löschen. Keine Verbindung.'))
            })
        }}
        onCancel={() => {
          setAsking(false)
        }}
      >
        Seine Preise und Lieferanten gehen mit. Belege, die ihn schon haben, behalten ihren Text und
        ihren Preis.
      </Confirm>
    </>
  )
}

/** What a form of the catalogue shows whoever may not keep it. */
function NotAllowed({ children }: { readonly children: ReactNode }) {
  const look = useButtonLook()

  return (
    <Screen>
      <PageHead title="Artikel" crumbs={[{ to: '/artikel', label: 'Artikel' }]} />
      <Empty>
        {children}{' '}
        <Link to="/artikel" className={look}>
          Zurück zur Liste
        </Link>
      </Empty>
    </Screen>
  )
}

/** A new article, `neuer_artikel()` of the canvas, on a screen of its own. */
export function NewArticleScreen() {
  const writes = useMay('article.write')

  return writes ? (
    <ArticleFormScreen article={null} />
  ) : (
    <NotAllowed>Artikel anlegen darf dieser Zugang nicht.</NotAllowed>
  )
}

/** An article to change, in the same form as a new one. */
export function EditArticleScreen() {
  const { articleId } = useParams({ strict: false }) as { articleId?: string }
  const writes = useMay('article.write')
  const found = useQuery({
    queryKey: ['articles', 'one', articleId],
    queryFn: () => articleOf(articleId ?? ''),
    enabled: articleId !== undefined,
  })

  if (!writes) {
    return <NotAllowed>Artikel ändern darf dieser Zugang nicht.</NotAllowed>
  }

  if (found.isPending) {
    return (
      <Screen>
        <p className="text-[13px] text-ink-muted">Wird geladen.</p>
      </Screen>
    )
  }

  if (found.isError) {
    return (
      <Screen>
        <PageHead title="Nicht gefunden" crumbs={[{ to: '/artikel', label: 'Artikel' }]} />
        <Empty>
          {saidWhy(
            found.error,
            'Den Artikel gibt es nicht, oder es besteht gerade keine Verbindung.',
          )}
        </Empty>
      </Screen>
    )
  }

  // Keyed by the article, so that the form starts from its values once more
  // when the address changes to another one.
  return <ArticleFormScreen key={found.data.id} article={found.data} />
}
