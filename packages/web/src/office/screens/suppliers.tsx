import { type RecordState, supplierProblems } from '@opengewerk/domain'
import { keepPreviousData, type UseQueryResult, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Check, Pencil, Trash2, Truck } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'

import {
  Button,
  cardLink,
  Cell,
  Column,
  Confirm,
  Field,
  Panel,
  SelectField,
  TablePanel,
  TextArea,
} from '../../components/index.js'
import { addressLine, countryOptions } from '../../app/format.js'
import { lineUnitShort } from '../../app/labels.js'
import { useMay } from '../../app/queries.js'
import { asTextOrNull } from '../../app/record-form.js'
import {
  supplierArticleCounts,
  type SupplierArticlePage,
  supplierArticles,
} from '../../session/articles.js'
import { refusalFor } from '../../sync/client.js'
import type { EditResult } from '../../sync/client.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useRecords, useSync, useSyncStatus } from '../../sync/provider.js'
import { Empty, FactList, NoteBox, PageHead, RecordColumns, Screen } from '../kit.js'
import { lastChanged, ListCard, ListScreen } from '../list.js'
import type { ListColumn } from '../list.js'
import { Frequent, PageFooter, pageSize, PriceWithBase, saidWhy } from './articles.js'
import { ChangesButton } from './audit-log.js'
import { ContactsSection } from './contacts.js'
import { placeOf } from './customers.js'

/** "214 Artikel", "1 Artikel". */
function articleCount(count: number): string {
  return `${count.toLocaleString('de-DE')} Artikel`
}

/**
 * The suppliers of the business (#296), `lieferanten_liste()` of the canvas:
 * master data on every device, like the customers, so the list is the list of
 * the device. How many articles each sells comes from the server, since the
 * catalogue is not on the device; without a connection the column stays empty.
 */
export function SupplierList() {
  const suppliers = useRecords('suppliers')
  const readsArticles = useMay('article.read')
  const creates = useMay('supplier.write')
  const navigate = useNavigate()
  const counts = useQuery({
    queryKey: ['articles', 'supplier-counts'],
    queryFn: supplierArticleCounts,
    enabled: readsArticles,
  })
  const countOf = (row: RecordState): number | null =>
    counts.data ? (counts.data[String(row['id'])] ?? 0) : null

  const columns: readonly ListColumn[] = [
    { id: 'name', header: 'Name', value: (row) => text(row, 'name') },
    { id: 'place', header: 'Ort', value: placeOf, width: 'w-[200px]', muted: true },
    {
      id: 'customerNumber',
      header: 'Unsere Kundennummer dort',
      value: (row) => maybeText(row, 'customerNumber') ?? '',
      cell: (row) =>
        maybeText(row, 'customerNumber') ?? <span className="text-ink-faint">nicht angegeben</span>,
      width: 'w-[210px]',
    },
    {
      id: 'articles',
      header: 'Artikel',
      value: (row) => countOf(row) ?? 0,
      cell: (row) => {
        const count = countOf(row)

        return count === null ? '' : count.toLocaleString('de-DE')
      },
      align: 'right',
      width: 'w-[90px]',
    },
  ]

  return (
    <ListScreen
      title="Lieferanten"
      caption="Alle Lieferanten des Betriebs"
      rows={suppliers}
      columns={columns}
      alsoSearched={(row) => [text(row, 'street'), text(row, 'email')].join(' ')}
      hrefFor={(row) => `/lieferanten/${String(row['id'])}`}
      searchLabel="Lieferanten durchsuchen"
      searchPlaceholder="Name, Ort, Kundennummer …"
      sorts={[
        {
          id: 'name',
          label: 'Name',
          compare: (left, right) => text(left, 'name').localeCompare(text(right, 'name'), 'de'),
        },
        lastChanged,
      ]}
      primary={
        creates
          ? {
              label: 'Neuer Lieferant',
              onPress: () => {
                void navigate({ to: '/lieferanten/neu' })
              },
            }
          : undefined
      }
      card={(row) => {
        const number = maybeText(row, 'customerNumber')

        return (
          <ListCard
            to={`/lieferanten/${String(row['id'])}`}
            title={text(row, 'name')}
            sub={[placeOf(row), number ? `Kundennummer ${number}` : ''].filter(Boolean).join(' · ')}
          />
        )
      }}
      empty={{
        icon: Truck,
        title: 'Noch kein Lieferant angelegt',
        text: 'Ein Lieferant ist, bei wem der Betrieb einkauft: mit der eigenen Kundennummer dort und den Leuten, die man anruft. Der erste entsteht über „Neuer Lieferant“.',
      }}
    />
  )
}

/**
 * One supplier, `lieferant()` of the canvas: its articles with its numbers and
 * the purchase prices of today at the left, where it is and whom to ask at the
 * right. The purchase prices only for whoever may read them; the column is
 * not even there for anybody else.
 */
export function SupplierScreen() {
  const { supplierId } = useParams({ strict: false }) as { supplierId?: string }
  const client = useSync()
  const supplier = useRecord('suppliers', supplierId)
  const writes = useMay('supplier.write')
  const readsArticles = useMay('article.read')
  const navigate = useNavigate()
  const [page, setPage] = useState(0)
  const sold = useQuery({
    queryKey: ['articles', 'supplier', supplierId, page],
    queryFn: () => supplierArticles(supplierId ?? '', page * pageSize, pageSize),
    enabled: supplierId !== undefined && supplier !== null && readsArticles,
    placeholderData: keepPreviousData,
  })

  if (!supplier || !supplierId) {
    return (
      <Screen>
        <PageHead title="Nicht gefunden" crumbs={[{ to: '/lieferanten', label: 'Lieferanten' }]} />
        <Empty>
          Diesen Lieferanten gibt es nicht mehr, oder dieses Gerät kennt ihn noch nicht.
        </Empty>
      </Screen>
    )
  }

  const number = maybeText(supplier, 'customerNumber')

  return (
    <Screen>
      <PageHead
        title={text(supplier, 'name')}
        crumbs={[{ to: '/lieferanten', label: 'Lieferanten' }]}
        phoneBack={{ to: '/lieferanten', label: 'Lieferanten' }}
        sub={[
          number ? `Unsere Kundennummer dort: ${number}` : null,
          sold.isSuccess ? articleCount(sold.data.total) : null,
          client.isPending('suppliers', supplierId) ? 'noch nicht übertragen' : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            <ChangesButton table="suppliers" id={supplierId} />
            {writes ? (
              <Button
                icon={Pencil}
                onClick={() => {
                  void navigate({ to: `/lieferanten/${supplierId}/bearbeiten` })
                }}
              >
                Bearbeiten
              </Button>
            ) : null}
          </>
        }
      />
      <RecordColumns
        main={readsArticles ? <SupplierArticles query={sold} page={page} onPage={setPage} /> : null}
        side={
          <>
            <SupplierFacts supplier={supplier} />
            <ContactsSection
              parent={{ supplierId }}
              empty="Noch kein Ansprechpartner. Etwa der Innendienst, der die Bestellungen annimmt."
            />
          </>
        }
      />
    </Screen>
  )
}

/** "Angaben": where the supplier is, how to reach it, the number it knows the business by. */
function SupplierFacts({ supplier }: { readonly supplier: RecordState }) {
  const email = maybeText(supplier, 'email')

  return (
    <Panel title="Angaben">
      <FactList
        keyWidth={100}
        facts={[
          { label: 'Anschrift', value: addressLine(supplier) },
          { label: 'Telefon', value: maybeText(supplier, 'phone') },
          {
            label: 'E-Mail',
            value: email ? (
              <a href={`mailto:${email}`} className="text-copper-text underline underline-offset-2">
                {email}
              </a>
            ) : null,
          },
          { label: 'Kundennummer', value: maybeText(supplier, 'customerNumber') },
          { label: 'Notizen', value: maybeText(supplier, 'notes') },
        ]}
      />
    </Panel>
  )
}

/** "Artikel": what the supplier sells, page by page, by the business's own number. */
function SupplierArticles({
  query,
  page,
  onPage,
}: {
  readonly query: UseQueryResult<SupplierArticlePage>
  readonly page: number
  readonly onPage: (page: number) => void
}) {
  const readsPurchase = useMay('purchase.read')

  if (query.isPending) {
    return (
      <Panel title="Artikel">
        <p className="text-[13px] text-ink-muted">Wird geladen.</p>
      </Panel>
    )
  }

  if (query.isError) {
    return (
      <Panel title="Artikel">
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          {saidWhy(query.error, 'Die Artikel kamen nicht an. Die Liste braucht eine Verbindung.')}
        </p>
      </Panel>
    )
  }

  const { total, rows } = query.data

  if (total === 0) {
    return (
      <Panel title="Artikel">
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          Noch kein Artikel von diesem Lieferanten. Ein Lieferant kommt an der Seite eines Artikels
          dazu, unter „Lieferant hinzufügen“.
        </p>
      </Panel>
    )
  }

  // With the units the price is for, "je 100 Stk." under it (#456).
  const purchase = (row: (typeof rows)[number]) =>
    row.purchase ? (
      <PriceWithBase
        cents={row.purchase.unitPriceCents}
        base={row.purchase.priceBase}
        unit={row.unit}
      />
    ) : (
      ''
    )

  return (
    <TablePanel
      title="Artikel"
      caption="Artikel des Lieferanten"
      cards={rows.map((row) => ({
        key: row.supplierArticleId,
        title: (
          <Link to={`/artikel/${row.articleId}`} className={cardLink}>
            {row.designation}
          </Link>
        ),
        sub: [row.number, row.supplierNumber ? `dort ${row.supplierNumber}` : '']
          .filter(Boolean)
          .join(' · '),
        right: readsPurchase ? <span className="numeric">{purchase(row)}</span> : undefined,
      }))}
      footer={<PageFooter page={page} total={total} onPage={onPage} />}
    >
      <thead>
        <tr>
          <Column className="w-[80px] min-w-[72px]">Nummer</Column>
          <Column className="min-w-[220px]">Bezeichnung</Column>
          <Column className="w-[160px] min-w-[130px]">Artikelnummer dort</Column>
          {readsPurchase ? (
            <Column numeric className="w-[120px] min-w-[104px]">
              Einkaufspreis
            </Column>
          ) : null}
          <Column className="w-[72px] min-w-[64px]">Einheit</Column>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.supplierArticleId}>
            <Cell>{row.number}</Cell>
            <Cell>
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <Link to={`/artikel/${row.articleId}`}>{row.designation}</Link>
                {row.frequent ? <Frequent /> : null}
              </span>
            </Cell>
            <Cell>{row.supplierNumber ?? ''}</Cell>
            {readsPurchase ? <Cell numeric>{purchase(row)}</Cell> : null}
            <Cell className="text-ink-muted">{lineUnitShort[row.unit]}</Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

/** The fields of a supplier, in the cards of the board "Neuer Lieferant". */
interface SupplierDraft {
  name: string
  customerNumber: string
  street: string
  houseNumber: string
  postalCode: string
  city: string
  country: string
  email: string
  phone: string
  notes: string
}

function draftOf(supplier: RecordState | null): SupplierDraft {
  const held = (field: string) =>
    typeof supplier?.[field] === 'string' ? String(supplier[field]) : ''

  return {
    name: held('name'),
    customerNumber: held('customerNumber'),
    street: held('street'),
    houseNumber: held('houseNumber'),
    postalCode: held('postalCode'),
    city: held('city'),
    country: held('country') || 'DE',
    email: held('email'),
    phone: held('phone'),
    notes: held('notes'),
  }
}

/** The values a form collected, in the types the record wants. */
function asSupplier(draft: SupplierDraft) {
  return {
    name: draft.name.trim(),
    customerNumber: asTextOrNull(draft.customerNumber),
    street: asTextOrNull(draft.street),
    houseNumber: asTextOrNull(draft.houseNumber),
    postalCode: asTextOrNull(draft.postalCode),
    city: asTextOrNull(draft.city),
    country: draft.country || 'DE',
    email: asTextOrNull(draft.email),
    phone: asTextOrNull(draft.phone),
    notes: asTextOrNull(draft.notes),
  }
}

export function NewSupplierScreen() {
  const writes = useMay('supplier.write')

  return writes ? (
    <SupplierFormScreen supplierId={undefined} />
  ) : (
    <NotAllowed>Lieferanten anlegen darf dieser Zugang nicht.</NotAllowed>
  )
}

export function EditSupplierScreen() {
  const { supplierId } = useParams({ strict: false }) as { supplierId?: string }
  const writes = useMay('supplier.write')

  return writes ? (
    <SupplierFormScreen supplierId={supplierId} />
  ) : (
    <NotAllowed>Lieferanten ändern darf dieser Zugang nicht.</NotAllowed>
  )
}

function NotAllowed({ children }: { readonly children: ReactNode }) {
  return (
    <Screen>
      <PageHead title="Lieferanten" crumbs={[{ to: '/lieferanten', label: 'Lieferanten' }]} />
      <Empty>{children}</Empty>
    </Screen>
  )
}

/**
 * A supplier to create or to change, `neuer_lieferant()` of the canvas: who,
 * where, how to reach it and notes, with the two buttons in the head. A new
 * one goes through the outbox, also without a connection; a change and a
 * removal need one, as for every piece of master data (ADR 0005), and the form
 * says so before anybody fills it in.
 */
function SupplierFormScreen({ supplierId }: { readonly supplierId: string | undefined }) {
  const client = useSync()
  const status = useSyncStatus()
  const navigate = useNavigate()
  const supplier = useRecord('suppliers', supplierId)
  const [draft, setDraft] = useState<SupplierDraft>(() => draftOf(supplier))
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [wrong, setWrong] = useState<readonly string[]>([])
  const editing = supplierId !== undefined
  const offline = editing && client.needsConnection('suppliers') && !status.online

  if (editing && !supplier) {
    return (
      <Screen>
        <PageHead title="Nicht gefunden" crumbs={[{ to: '/lieferanten', label: 'Lieferanten' }]} />
        <Empty>
          Diesen Lieferanten gibt es nicht mehr, oder dieses Gerät kennt ihn noch nicht.
        </Empty>
      </Screen>
    )
  }

  const set = (field: keyof SupplierDraft) => (value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
  }
  const back = () => {
    void navigate({ to: editing ? `/lieferanten/${supplierId}` : '/lieferanten' })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTrouble(null)
    setWrong([])

    const values = asSupplier(draft)
    const found = supplierProblems(values)

    setProblems(found)

    if (Object.keys(found).length > 0) {
      return
    }

    setWorking(true)

    try {
      const result: EditResult = editing
        ? await client.update('suppliers', supplierId, values)
        : await client.create('suppliers', values)

      if (result.outcome === 'refused') {
        setTrouble(refusalFor(result))
        setWrong(result.fields)

        return
      }

      await navigate({ to: `/lieferanten/${editing ? supplierId : result.id}` })
    } finally {
      setWorking(false)
    }
  }

  const problem = (field: keyof SupplierDraft) =>
    problems[field] ?? (wrong.includes(field) ? 'Dieses Feld ist der Grund.' : undefined)
  const input = (
    field: keyof SupplierDraft,
    label: string,
    extra: Partial<Parameters<typeof Field>[0]> = {},
  ) => (
    <Field
      label={label}
      value={draft[field]}
      problem={problem(field)}
      onChange={(event) => {
        set(field)(event.target.value)
      }}
      {...extra}
    />
  )
  const name = text(supplier, 'name')

  return (
    <Screen>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          void submit(event)
        }}
      >
        <PageHead
          title={editing ? `${name} bearbeiten` : 'Neuer Lieferant'}
          crumbs={
            editing
              ? [
                  { to: '/lieferanten', label: 'Lieferanten' },
                  { to: `/lieferanten/${supplierId}`, label: name },
                ]
              : [{ to: '/lieferanten', label: 'Lieferanten' }]
          }
          actions={
            <>
              <Button onClick={back} disabled={working}>
                Abbrechen
              </Button>
              <Button type="submit" tone="primary" icon={Check} disabled={working || offline}>
                {working ? 'Wird gespeichert' : editing ? 'Speichern' : 'Lieferant anlegen'}
              </Button>
            </>
          }
        />

        {offline ? (
          <NoteBox tone="waiting">
            Stammdaten werden nur mit Verbindung geändert. Gerade ist keine da.
          </NoteBox>
        ) : null}
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}

        <div className="flex max-w-[760px] flex-col gap-3">
          <Panel title="Lieferant" roomy>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              {input('name', 'Name', { required: true })}
              {input('customerNumber', 'Unsere Kundennummer dort', {
                hint: 'Wie eine Bestellung sie nennt.',
              })}
            </div>
          </Panel>
          <Panel title="Anschrift" roomy>
            <div className="flex flex-col gap-2.5">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
                {input('street', 'Straße')}
                {input('houseNumber', 'Hausnummer')}
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,2fr)]">
                {input('postalCode', 'PLZ', { numeric: true })}
                {input('city', 'Ort')}
                <SelectField
                  label="Land"
                  value={draft.country}
                  options={countryOptions}
                  onChange={set('country')}
                />
              </div>
            </div>
          </Panel>
          <Panel title="Erreichbar" roomy>
            <div className="grid gap-3 sm:grid-cols-2">
              {input('email', 'E-Mail', { type: 'email' })}
              {input('phone', 'Telefon', { type: 'tel' })}
            </div>
          </Panel>
          <Panel title="Notizen" roomy>
            <TextArea
              label="Notizen"
              rows={3}
              value={draft.notes}
              hint="Etwa bis wann abgeholt werden kann."
              onChange={(event) => {
                set('notes')(event.target.value)
              }}
            />
          </Panel>
          {editing ? (
            <div className="flex flex-wrap gap-2">
              <RemoveSupplier supplierId={supplierId} name={name} disabled={offline} />
            </div>
          ) : null}
        </div>
      </form>
    </Screen>
  )
}

/** Removing a supplier, with a question first: its people go with it, its articles stay. */
function RemoveSupplier({
  supplierId,
  name,
  disabled,
}: {
  readonly supplierId: string
  readonly name: string
  readonly disabled: boolean
}) {
  const client = useSync()
  const navigate = useNavigate()
  const [asking, setAsking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  return (
    <>
      <Button
        tone="danger"
        icon={Trash2}
        disabled={disabled}
        onClick={() => {
          setAsking(true)
        }}
      >
        Lieferant löschen
      </Button>
      {trouble ? (
        <p role="alert" className="basis-full text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <Confirm
        open={asking}
        title={`„${name}“ löschen?`}
        confirm="Löschen"
        tone="danger"
        onConfirm={() => {
          setAsking(false)
          void client.remove('suppliers', supplierId).then(async (result) => {
            if (result.outcome === 'refused') {
              setTrouble(refusalFor(result))

              return
            }

            await navigate({ to: '/lieferanten' })
          })
        }}
        onCancel={() => {
          setAsking(false)
        }}
      >
        Seine Ansprechpartner gehen mit, und kein Artikel nennt ihn danach noch als Lieferanten. Die
        Artikel selbst bleiben, mit ihren Verkaufspreisen.
      </Confirm>
    </>
  )
}
