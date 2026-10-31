import {
  type ArticleImport,
  type ArticleImportStatus,
  type ImportCharset,
  importFileBytes,
  importFileLimits,
  type ImportSample,
  type ImportSummary,
  type IsoDate,
  markupLabel,
  type Metal,
  metalNames,
} from '@opengewerk/domain'
import {
  Button,
  Cell,
  Column,
  Field,
  Panel,
  SelectField,
  Status,
  TablePanel,
} from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import { Empty, NoteBox, PageHead, RecordColumns, Screen } from '@opengewerk/platform-web/office'
import { RequestRefused, text, useRecord } from '@opengewerk/platform-web/sync'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Check, Paperclip, Plus, RefreshCw, Upload } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'

import { useMay } from '../../app/queries.js'
import {
  applyImport,
  changeImport,
  discardImport,
  importOf,
  importsOf,
  sha256Of,
  startImport,
  uploadImportFile,
} from '../../session/imports.js'
import { PriceWithBase } from './articles.js'

/**
 * The screens of an import from DATANORM (#297), as the boards "Lieferant,
 * seine Importe", "Import aus DATANORM, die Dateien", "die Vorschau",
 * "Vorschau ohne Aufschlag" and "die Übernahme läuft" draw them. The server
 * reads and takes over in the background; these screens upload the files,
 * show the preview and ask it to take over or throw away. Only for whoever
 * keeps purchase prices: an import writes them.
 */

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

const whole = new Intl.NumberFormat('de-DE')

/** The words and the tone of the state of an import. */
const states: Readonly<
  Record<ArticleImportStatus, { readonly label: string; readonly tone: StatusToneOf }>
> = {
  reading: { label: 'Wird eingelesen', tone: 'waiting' },
  ready: { label: 'Vorschau bereit', tone: 'waiting' },
  applying: { label: 'Wird übernommen', tone: 'waiting' },
  applied: { label: 'Übernommen', tone: 'done' },
  failed: { label: 'Gescheitert', tone: 'conflict' },
  discarded: { label: 'Verworfen', tone: 'neutral' },
}

type StatusToneOf = 'waiting' | 'done' | 'conflict' | 'neutral'

function ImportState({ status }: { readonly status: ArticleImportStatus }) {
  return <Status tone={states[status].tone}>{states[status].label}</Status>
}

/** The day an import was read, from the moment the server noted. */
function dayOf(moment: string): IsoDate {
  return moment.slice(0, 10) as IsoDate
}

/** A size as the list of files says it: "61,8 MB", and a small file in KB rather than "0,0 MB". */
function sizeOf(bytes: number): string {
  return bytes < 100_000
    ? `${whole.format(Math.max(1, Math.ceil(bytes / 1000)))} KB`
    : `${(bytes / 1_000_000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`
}

const charsetLabel: Readonly<Record<ImportCharset, string>> = {
  'utf-8': 'UTF-8',
  cp850: 'CP850',
  'windows-1252': 'Windows-1252',
}

// --- At the supplier ---------------------------------------------------------------------

/**
 * "Importe aus DATANORM" at the supplier: the newest imports with their
 * state, each opened by its date, and the way to read a new delivery.
 */
export function ImportsPanel({ supplierId }: { readonly supplierId: string }) {
  const navigate = useNavigate()
  const listed = useQuery({
    queryKey: ['imports', supplierId],
    queryFn: () => importsOf(supplierId),
  })
  const open = (id: string) => `/lieferanten/${supplierId}/import/${id}`
  const start = (
    <Button
      size="small"
      icon={Upload}
      onClick={() => {
        void navigate({ to: `/lieferanten/${supplierId}/import` })
      }}
    >
      Dateien einlesen
    </Button>
  )

  if (listed.isPending || listed.isError) {
    return (
      <Panel title="Importe aus DATANORM" action={start}>
        <p className="text-[13px] leading-[1.4] text-ink-muted">
          {listed.isPending
            ? 'Wird geladen.'
            : saidWhy(listed.error, 'Die Importe kamen nicht an. Sie brauchen eine Verbindung.')}
        </p>
      </Panel>
    )
  }

  const rows = listed.data
  const files = (row: ArticleImport) => row.files.map((file) => file.name).join(', ')

  return (
    <TablePanel
      title="Importe aus DATANORM"
      caption="Importe des Lieferanten"
      action={start}
      cards={rows.map((row) => ({
        key: row.id,
        title: <Link to={open(row.id)}>{date(dayOf(row.createdAt))}</Link>,
        sub: files(row),
        right: <ImportState status={row.status} />,
      }))}
      cardsEmpty="Noch kein Import."
      note="Ein Import liest die Dateien einer Lieferung, zeigt vorher, was er täte, und übernimmt ganz oder gar nicht. Die Dateien bleiben gespeichert und belegen jeden Wert."
    >
      <thead>
        <tr>
          <Column className="w-[120px] min-w-[110px]">Eingelesen am</Column>
          <Column className="min-w-[160px]">Dateien</Column>
          <Column className="w-[150px] min-w-[140px]">Stand</Column>
          <Column numeric className="w-[80px] min-w-[70px]">
            Artikel
          </Column>
          <Column numeric className="w-[80px] min-w-[80px]">
            <span className="sr-only">Öffnen</span>
          </Column>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <Cell className="text-ink-muted" colSpan={5}>
              Noch kein Import.
            </Cell>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={row.id}>
              <Cell>
                <Link to={open(row.id)}>{date(dayOf(row.createdAt))}</Link>
              </Cell>
              <Cell className="[overflow-wrap:anywhere]">{files(row)}</Cell>
              <Cell>
                <ImportState status={row.status} />
              </Cell>
              <Cell numeric>{row.summary === null ? '' : whole.format(row.summary.articles)}</Cell>
              <Cell numeric>
                {row.status === 'ready' ? (
                  <Button
                    size="small"
                    onClick={() => {
                      void navigate({ to: open(row.id) })
                    }}
                  >
                    Öffnen
                  </Button>
                ) : null}
              </Cell>
            </tr>
          ))
        )}
      </tbody>
    </TablePanel>
  )
}

/** The head of the screens of an import: the supplier in the crumbs. */
function ImportHead({
  supplierId,
  badges,
  sub,
  actions,
}: {
  readonly supplierId: string
  readonly badges?: ReactNode
  readonly sub: ReactNode
  readonly actions?: ReactNode
}) {
  const supplier = useRecord('suppliers', supplierId)

  return (
    <PageHead
      title="Import aus DATANORM"
      crumbs={[
        { to: '/lieferanten', label: 'Lieferanten' },
        {
          to: `/lieferanten/${supplierId}`,
          label: supplier ? text(supplier, 'name') : 'Lieferant',
        },
      ]}
      badges={badges}
      sub={sub}
      actions={actions}
    />
  )
}

function NotAllowed({ supplierId }: { readonly supplierId: string }) {
  return (
    <Screen>
      <ImportHead supplierId={supplierId} sub="" />
      <Empty>Einen Import aus DATANORM darf nur, wer Einkaufspreise pflegt.</Empty>
    </Screen>
  )
}

// --- The files of a delivery -------------------------------------------------------------

interface Chosen {
  readonly key: string
  readonly file: File
  readonly sha256: string | null
  /** How far it went up, in hundredths; 100 once the server has it. */
  readonly part: number
  readonly problem: string | null
}

/**
 * "Dateien der Lieferung": the files go up one after another as they are
 * chosen, the server takes one file of a business at a time; reading starts
 * once all are up.
 */
export function NewImportScreen() {
  const { supplierId = '' } = useParams({ strict: false }) as { supplierId?: string }
  const keeps = useMay('purchase.write')
  const navigate = useNavigate()
  const picker = useRef<HTMLInputElement>(null)
  const [chosen, setChosen] = useState<readonly Chosen[]>([])
  const [trouble, setTrouble] = useState<string | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())

  const update = (key: string, change: Partial<Chosen>) => {
    setChosen((before) =>
      before.map((entry) => (entry.key === key ? { ...entry, ...change } : entry)),
    )
  }

  async function send(entry: Chosen) {
    try {
      const sha256 = await sha256Of(entry.file)

      await uploadImportFile(supplierId, sha256, entry.file, (part) => {
        update(entry.key, { part: Math.min(part, 99) })
      })
      update(entry.key, { sha256, part: 100 })
    } catch (error) {
      update(entry.key, {
        problem: saidWhy(error, 'Die Datei kam nicht an. Keine Verbindung.'),
      })
    }
  }

  function add(list: FileList | null) {
    const files = [...(list ?? [])]

    setTrouble(null)

    if (chosen.length + files.length > importFileLimits.files) {
      setTrouble(`Ein Import liest höchstens ${String(importFileLimits.files)} Dateien.`)

      return
    }

    const entries = files.map((file, index) => ({
      key: `${String(Date.now())}-${String(index)}-${file.name}`,
      file,
      sha256: null,
      part: 0,
      problem:
        file.size > importFileBytes
          ? `Größer als ${String(importFileBytes / 1_000_000)} MB, das nimmt ein Import nicht an.`
          : null,
    }))

    setChosen((before) => [...before, ...entries])

    // One after another: the server takes one file of a business at a time.
    for (const entry of entries) {
      if (entry.problem === null) {
        queue.current = queue.current.then(() => send(entry))
      }
    }
  }

  const start = useMutation({
    mutationFn: () =>
      startImport(
        supplierId,
        chosen.map((entry) => ({ name: entry.file.name, sha256: entry.sha256 ?? '' })),
      ),
    onSuccess: (started) => {
      void navigate({ to: `/lieferanten/${supplierId}/import/${started.id}` })
    },
    onError: (error) => {
      setTrouble(saidWhy(error, 'Das Einlesen ließ sich nicht starten. Keine Verbindung.'))
    },
  })

  if (!keeps) {
    return <NotAllowed supplierId={supplierId} />
  }

  const ready =
    chosen.length > 0 && chosen.every((entry) => entry.sha256 !== null && entry.problem === null)

  return (
    <Screen>
      <ImportHead
        supplierId={supplierId}
        sub="Die Dateien einer Lieferung, einzeln oder als ZIP. DATANORM 4."
      />
      <RecordColumns
        main={
          <Panel title="Dateien der Lieferung" roomy>
            <div className="flex flex-col gap-3">
              <p className="text-[14px] leading-[1.45] text-ink-muted">
                Was die Lieferung bringt, so wie der Großhändler sie im Downloadbereich anbietet.
                Gelesen wird erst, wenn alle Dateien oben sind; übernommen wird erst nach der
                Vorschau.
              </p>
              {chosen.length > 0 ? (
                <ul aria-label="Gewählte Dateien" className="flex flex-col">
                  {chosen.map((entry) => (
                    <li
                      key={entry.key}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-row py-2 text-[14px]"
                    >
                      <Paperclip
                        size={15}
                        strokeWidth={2}
                        aria-hidden="true"
                        className="shrink-0 text-ink-muted"
                      />
                      <span className="min-w-0 grow [overflow-wrap:anywhere]">
                        {entry.file.name}
                      </span>
                      <span className="numeric text-ink-muted">{sizeOf(entry.file.size)}</span>
                      {entry.problem !== null ? (
                        <Status tone="conflict">Nicht angekommen</Status>
                      ) : entry.sha256 !== null ? (
                        <Status tone="done">Hochgeladen</Status>
                      ) : (
                        <Status tone="waiting" icon={Upload}>
                          {`${String(entry.part)} %`}
                        </Status>
                      )}
                      {entry.problem !== null ? (
                        <span role="alert" className="w-full text-[13px] text-conflict">
                          {entry.problem}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div>
                <Button
                  icon={Plus}
                  onClick={() => {
                    picker.current?.click()
                  }}
                >
                  Dateien wählen
                </Button>
              </div>
              <p className="text-[13px] leading-[1.45] text-ink-muted">
                Bis zu {importFileLimits.files} Dateien, jede bis{' '}
                {String(importFileBytes / 1_000_000)} MB. Eine Datei, die nur Langtexte bringt, wird
                nicht gebraucht.
              </p>
              {trouble ? (
                <p role="alert" className="text-[13px] font-semibold text-conflict">
                  {trouble}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  tone="primary"
                  icon={Check}
                  disabled={!ready || start.isPending}
                  onClick={() => {
                    start.mutate()
                  }}
                >
                  {start.isPending ? 'Einen Moment' : 'Einlesen'}
                </Button>
                <Button
                  onClick={() => {
                    void navigate({ to: `/lieferanten/${supplierId}` })
                  }}
                >
                  Abbrechen
                </Button>
              </div>
            </div>
            <input
              ref={picker}
              type="file"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-label="Dateien der Lieferung"
              onChange={(event) => {
                add(event.target.files)
                event.target.value = ''
              }}
            />
          </Panel>
        }
        side={
          <Panel title="Gut zu wissen" roomy>
            <div className="flex flex-col gap-2 text-[14px] leading-[1.45] text-ink-muted">
              <p>Gelesen wird auf dem Server; die Seite darf dabei geschlossen werden.</p>
              <p className="text-[13px]">DATANORM 3 und älter liest der Import nicht.</p>
            </div>
          </Panel>
        }
      />
    </Screen>
  )
}

// --- One import --------------------------------------------------------------------------

/**
 * One import: while the server reads or takes over, how far it is; then the
 * preview with its options, or what the import did, or why it broke off.
 * Asked again every second and a half while the server is at work.
 */
export function ImportScreen() {
  const { supplierId = '', importId = '' } = useParams({ strict: false }) as {
    supplierId?: string
    importId?: string
  }
  const keeps = useMay('purchase.write')
  const queries = useQueryClient()
  const [trouble, setTrouble] = useState<string | null>(null)
  const held = useQuery({
    queryKey: ['imports', supplierId, importId],
    queryFn: () => importOf(supplierId, importId),
    enabled: keeps,
    refetchInterval: (query) =>
      query.state.data?.status === 'reading' || query.state.data?.status === 'applying'
        ? 1500
        : false,
  })

  const settle = async (next: ArticleImport) => {
    setTrouble(null)
    queries.setQueryData(['imports', supplierId, importId], next)
    // The list at the supplier; this import is what the server just said.
    await queries.invalidateQueries({ queryKey: ['imports', supplierId], exact: true })
  }
  const apply = useMutation({
    mutationFn: () => applyImport(supplierId, importId),
    onSuccess: settle,
    onError: (error) => {
      setTrouble(saidWhy(error, 'Die Übernahme ließ sich nicht starten. Keine Verbindung.'))
    },
  })
  const discard = useMutation({
    mutationFn: () => discardImport(supplierId, importId),
    onSuccess: settle,
    onError: (error) => {
      setTrouble(saidWhy(error, 'Die Vorschau ließ sich nicht verwerfen. Keine Verbindung.'))
    },
  })

  if (!keeps) {
    return <NotAllowed supplierId={supplierId} />
  }

  if (held.isPending || held.isError) {
    return (
      <Screen>
        <ImportHead supplierId={supplierId} sub="" />
        <Empty>
          {held.isPending
            ? 'Wird geladen.'
            : saidWhy(held.error, 'Der Import kam nicht an. Er braucht eine Verbindung.')}
        </Empty>
      </Screen>
    )
  }

  const shown = held.data
  const summary = shown.summary
  const sub = [
    summary?.fileDate ? `Lieferung vom ${date(summary.fileDate)}` : null,
    `eingelesen am ${date(dayOf(shown.createdAt))}`,
    shown.appliedAt ? `übernommen am ${date(dayOf(shown.appliedAt))}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const working = apply.isPending || discard.isPending
  const actions =
    shown.status === 'ready' ? (
      <>
        <Button
          disabled={working}
          onClick={() => {
            discard.mutate()
          }}
        >
          Verwerfen
        </Button>
        <Button
          tone="primary"
          icon={Check}
          disabled={working}
          onClick={() => {
            apply.mutate()
          }}
        >
          Übernehmen
        </Button>
      </>
    ) : undefined

  return (
    <Screen>
      <ImportHead
        supplierId={supplierId}
        badges={<ImportState status={shown.status} />}
        sub={sub}
        actions={actions}
      />
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      <RecordColumns
        main={<ImportMain supplierId={supplierId} shown={shown} />}
        side={
          summary === null ? null : (
            <>
              {shown.status === 'ready' ? (
                <PreviewOptions supplierId={supplierId} shown={shown} onChanged={settle} />
              ) : null}
              <FilesPanel summary={summary} />
              <LeftOut summary={summary} />
            </>
          )
        }
      />
    </Screen>
  )
}

/** The main column of an import, by its state. */
function ImportMain({
  supplierId,
  shown,
}: {
  readonly supplierId: string
  readonly shown: ArticleImport
}) {
  const summary = shown.summary

  if (shown.status === 'failed') {
    return (
      <NoteBox
        tone="conflict"
        action={
          <Link
            to={`/lieferanten/${supplierId}/import`}
            className="text-copper-text underline underline-offset-2"
          >
            Dateien neu einlesen
          </Link>
        }
      >
        {shown.problem ?? 'Der Import ist gescheitert. Übernommen wurde nichts.'}
      </NoteBox>
    )
  }

  if (shown.status === 'reading') {
    return (
      <Panel title="Einlesen" roomy>
        <p className="text-[14px] leading-[1.45] text-ink-muted">
          Die Dateien werden gelesen und mit dem Katalog verglichen. Bei einem ganzen Sortiment
          dauert das etwa eine halbe Minute; die Seite darf dabei geschlossen werden.
        </p>
      </Panel>
    )
  }

  if (summary === null) {
    return null
  }

  const done = shown.progress?.done ?? 0
  const total = shown.progress?.total ?? 0
  const part = total > 0 ? Math.floor((done / total) * 100) : 0
  const title =
    shown.status === 'applied'
      ? 'Was der Import tat'
      : shown.status === 'discarded'
        ? 'Was der Import getan hätte'
        : shown.status === 'applying'
          ? 'Was der Import tut'
          : 'Was der Import täte'

  return (
    <div className="flex flex-col gap-3">
      {shown.status === 'applying' ? (
        <Panel title="Übernahme" roomy>
          <div className="flex flex-col gap-3">
            <div
              role="progressbar"
              aria-label="Übernahme"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={part}
              className="h-2 overflow-hidden rounded-full bg-surface-sunken"
            >
              <div className="h-full bg-copper-solid" style={{ width: `${String(part)}%` }} />
            </div>
            <p className="numeric text-[13px] text-ink-muted">{part} % übernommen</p>
            <p className="text-[14px] leading-[1.45] text-ink-muted">
              Die Übernahme läuft auf dem Server weiter, auch wenn diese Seite geschlossen wird.
              Bricht sie ab, bleibt alles, wie es vorher war.
            </p>
          </div>
        </Panel>
      ) : null}
      <Panel title={title} roomy>
        <div className="flex flex-col gap-2.5">
          <Counts summary={summary} />
          {shown.status === 'applying' ? null : (
            <SellingPrices summary={summary} past={shown.status === 'applied'} />
          )}
          {shown.status === 'applying' ? null : (
            <Metals summary={summary} past={shown.status === 'applied'} />
          )}
          {shown.status === 'ready' ? (
            <p className="text-[13px] leading-[1.45] text-ink-muted">
              Übernommen wird ganz oder gar nicht. Das Änderungsprotokoll hält den Import als einen
              Eintrag fest.
            </p>
          ) : null}
        </div>
      </Panel>
      {shown.status === 'applying' ? null : <Samples summary={summary} />}
    </div>
  )
}

/** The counts of a preview as tiles, as `counts()` of the board draws them. */
function Counts({ summary }: { readonly summary: ImportSummary }) {
  const figures: readonly (readonly [number, string])[] = [
    [summary.articles, 'Artikel'],
    [summary.created, 'neu'],
    [summary.linked, 'verknüpft'],
    [summary.updated, 'neuer Preis'],
    [summary.unchanged, 'unverändert'],
    [summary.removed, 'nicht mehr dort'],
  ]

  return (
    <dl className="grid grid-cols-3 gap-2 lg:grid-cols-6">
      {figures.map(([figure, label]) => (
        <div
          key={label}
          className="flex flex-col-reverse rounded-[5px] border border-line bg-surface px-3 py-2.5"
        >
          <dt className="text-[13px] leading-[1.35] text-ink-muted">{label}</dt>
          <dd className="numeric text-[22px] font-bold">{whole.format(figure)}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * What becomes of the selling prices (#463): how many come from the purchase
 * prices and the markup, or that without a markup none comes about.
 */
function SellingPrices({
  summary,
  past,
}: {
  readonly summary: ImportSummary
  readonly past: boolean
}) {
  if (summary.markup === null) {
    return (
      <NoteBox
        tone="waiting"
        action={
          <Link
            to="/einstellungen/aufschlag"
            className="text-copper-text underline underline-offset-2"
          >
            Aufschlag einstellen
          </Link>
        }
      >
        <b>Ohne Aufschlag entsteht kein Verkaufspreis.</b> Weder dieser Lieferant noch der Betrieb
        hat einen. Übernommen werden Artikel und Einkaufspreise; Verkaufspreise entstehen, sobald
        ein Aufschlag eingestellt ist.
      </NoteBox>
    )
  }

  const count = whole.format(summary.sellingPrices)

  return (
    <NoteBox tone="neutral">
      {past
        ? `Aus den Einkaufspreisen entstanden ${count} Verkaufspreise mit dem Aufschlag von ${markupLabel(summary.markup)}.`
        : `Aus den Einkaufspreisen entstehen ${count} Verkaufspreise mit dem Aufschlag von ${markupLabel(summary.markup)}.`}{' '}
      Artikel mit festem Verkaufspreis behalten ihn.
    </NoteBox>
  )
}

const sampleKind: Readonly<
  Record<ImportSample['kind'], { readonly label: string; readonly tone: StatusToneOf }>
> = {
  created: { label: 'Neu', tone: 'waiting' },
  linked: { label: 'Verknüpft', tone: 'neutral' },
  updated: { label: 'Neuer Preis', tone: 'neutral' },
  removed: { label: 'Nicht mehr', tone: 'conflict' },
}

/** "Artikel, eine Auswahl": the first articles of each kind. */
function Samples({ summary }: { readonly summary: ImportSummary }) {
  const price = (sample: ImportSample, which: 'listPrice' | 'netPrice' | 'sellingPrice') => {
    const held = sample[which]

    return held === null ? null : (
      <PriceWithBase cents={held.cents} base={held.priceBase} unit={sample.unit} />
    )
  }
  const before = (sample: ImportSample) =>
    sample.previousListPrice === null ? null : (
      <span className="block text-[12px] text-ink-faint">
        vorher{' '}
        <PriceWithBase
          cents={sample.previousListPrice.cents}
          base={sample.previousListPrice.priceBase}
          unit={sample.unit}
        />
      </span>
    )

  return (
    <TablePanel
      title="Artikel, eine Auswahl"
      caption="Eine Auswahl der Artikel des Imports"
      cards={summary.samples.map((sample) => ({
        key: `${sample.kind}-${sample.supplierNumber}`,
        title: sample.designation,
        sub: `${sampleKind[sample.kind].label} · ${sample.number}`,
        right: <span className="numeric">{price(sample, 'listPrice')}</span>,
      }))}
      cardsEmpty="Kein Artikel."
      note="Die ersten Artikel jeder Art. „Verknüpft“: ein Artikel des Betriebs mit derselben EAN bekommt den Lieferanten dazu. Ist die Nummer des Lieferanten im Betrieb vergeben, steht sein Kürzel dahinter. Die Texte eines Artikels des Betriebs ändert ein Import nie."
    >
      <thead>
        <tr>
          {/* Seven columns in the main column of a record, as the board fits them. */}
          <Column className="w-[92px] min-w-[92px]">Art</Column>
          <Column className="w-[72px] min-w-[72px]">Nummer dort</Column>
          <Column className="w-[72px] min-w-[72px]">Nummer</Column>
          <Column className="min-w-[120px]">Bezeichnung</Column>
          <Column numeric className="w-[88px] min-w-[88px]">
            Listenpreis
          </Column>
          <Column numeric className="w-[80px] min-w-[80px]">
            Nettopreis
          </Column>
          <Column numeric className="w-[88px] min-w-[88px]">
            Verkaufspreis
          </Column>
        </tr>
      </thead>
      <tbody>
        {summary.samples.length === 0 ? (
          <tr>
            <Cell className="text-ink-muted" colSpan={7}>
              Kein Artikel.
            </Cell>
          </tr>
        ) : (
          summary.samples.map((sample) => (
            <tr key={`${sample.kind}-${sample.supplierNumber}`}>
              <Cell>
                <Status tone={sampleKind[sample.kind].tone}>{sampleKind[sample.kind].label}</Status>
              </Cell>
              <Cell>{sample.supplierNumber}</Cell>
              <Cell className="[overflow-wrap:anywhere]">{sample.number}</Cell>
              <Cell>{sample.designation}</Cell>
              <Cell numeric>
                {price(sample, 'listPrice')}
                {before(sample)}
              </Cell>
              <Cell numeric>{price(sample, 'netPrice')}</Cell>
              <Cell numeric>{price(sample, 'sellingPrice')}</Cell>
            </tr>
          ))
        )}
      </tbody>
    </TablePanel>
  )
}

/** "Einstellungen der Vorschau": from when the prices apply and the characters, read again. */
function PreviewOptions({
  supplierId,
  shown,
  onChanged,
}: {
  readonly supplierId: string
  readonly shown: ArticleImport
  readonly onChanged: (next: ArticleImport) => Promise<void>
}) {
  const [validFrom, setValidFrom] = useState<string>(shown.validFrom)
  const [charset, setCharset] = useState<string>(shown.charset ?? '')
  const [trouble, setTrouble] = useState<string | null>(null)
  const change = useMutation({
    mutationFn: () =>
      changeImport(supplierId, shown.id, {
        validFrom: validFrom as IsoDate,
        charset: charset === '' ? null : (charset as ImportCharset),
      }),
    onSuccess: async (next) => {
      setTrouble(null)
      await onChanged(next)
    },
    onError: (error) => {
      setTrouble(saidWhy(error, 'Die Vorschau ließ sich nicht neu einlesen. Keine Verbindung.'))
    },
  })
  const fileDate = shown.summary?.fileDate ?? null

  return (
    <Panel title="Einstellungen der Vorschau">
      <div className="flex flex-col gap-2.5">
        <Field
          label="Preise gelten ab"
          type="date"
          min={today()}
          value={validFrom}
          onChange={(event) => {
            setValidFrom(event.target.value)
          }}
          hint={
            fileDate === null
              ? 'Nie vor dem Tag der Übernahme.'
              : `Die Dateien nennen den ${date(fileDate)}; nie vor dem Tag der Übernahme.`
          }
        />
        <SelectField
          label="Zeichensatz"
          value={charset}
          options={[
            { value: '', label: 'Wie die Dateien zeigen' },
            { value: 'utf-8', label: 'UTF-8' },
            { value: 'cp850', label: 'CP850' },
            { value: 'windows-1252', label: 'Windows-1252' },
          ]}
          onChange={setCharset}
          hint="Nur ändern, wenn Umlaute falsch aussehen."
        />
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <div>
          <Button
            size="small"
            icon={RefreshCw}
            disabled={change.isPending}
            onClick={() => {
              change.mutate()
            }}
          >
            Neu einlesen
          </Button>
        </div>
      </div>
    </Panel>
  )
}

function FilesPanel({ summary }: { readonly summary: ImportSummary }) {
  return (
    <TablePanel
      title="Dateien"
      caption="Dateien des Imports"
      cards={summary.files.map((file) => ({
        key: file.name,
        title: file.name,
        sub: charsetLabel[file.charset],
        right: <span className="numeric">{whole.format(file.lines)}</span>,
      }))}
    >
      <thead>
        <tr>
          <Column className="min-w-[120px]">Datei</Column>
          <Column className="w-[110px]">Zeichensatz</Column>
          <Column numeric className="w-[80px]">
            Zeilen
          </Column>
        </tr>
      </thead>
      <tbody>
        {summary.files.map((file) => (
          <tr key={file.name}>
            <Cell className="[overflow-wrap:anywhere]">{file.name}</Cell>
            <Cell>{charsetLabel[file.charset]}</Cell>
            <Cell numeric>{whole.format(file.lines)}</Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

/** "Kupfer bei 312, Silber bei 41 und Messing bei 6 Artikeln": metals with their articles. */
function countedMetals(
  entries: readonly { readonly metal: Metal; readonly articles: number }[],
): string {
  const parts = entries.map(
    (entry) => `${metalNames[entry.metal]} bei ${whole.format(entry.articles)}`,
  )
  const last = entries.at(-1)?.articles ?? 0
  const listed =
    parts.length > 1
      ? `${parts.slice(0, -1).join(', ')} und ${parts.at(-1) ?? ''}`
      : (parts[0] ?? '')

  return `${listed} ${last === 1 ? 'Artikel' : 'Artikeln'}`
}

/**
 * The metals that come with the import (#782), as `metal_note` of the board
 * writes them. Nothing for a delivery without any, or a preview from before.
 */
function Metals({ summary, past }: { readonly summary: ImportSummary; readonly past: boolean }) {
  const metals = summary.metals ?? []

  if (metals.length === 0) {
    return null
  }

  return (
    <p className="text-[14px] leading-[1.45]">
      {`${past ? 'Metall kam mit' : 'Metall kommt mit'}: ${countedMetals(metals)}. `}
      Einen Metallzuschlag gibt es nur für ein Metall, für das beim Lieferanten ein Metallpreis
      steht.
    </p>
  )
}

/** "Was nicht übernommen wird": long texts, surcharge tables, kinds of record, other files, units, lines. */
function LeftOut({ summary }: { readonly summary: ImportSummary }) {
  const lines: (readonly [string, string])[] = []

  for (const name of summary.longTextFiles) {
    lines.push(['Langtexte', `${name} bringt nur Langtexte und wird nicht gebraucht.`])
  }

  // What its amounts mean is described nowhere (#782).
  const tables = summary.metalTables ?? []

  if (tables.length > 0) {
    lines.push([
      'Zuschlagsstaffel',
      `${countedMetals(tables)}. Eine Staffel aus den Z-Sätzen wird noch nicht übernommen.`,
    ])
  }

  for (const kind of summary.ignored) {
    lines.push([
      'Nicht übernommen',
      `${kind.letter}-Sätze: ${whole.format(kind.lines)} ${kind.lines === 1 ? 'Zeile' : 'Zeilen'}.`,
    ])
  }

  if (summary.skipped.length > 0) {
    lines.push(['Keine DATANORM-Datei', summary.skipped.join(', ')])
  }

  for (const unit of summary.unknownUnits) {
    lines.push([
      'Einheit unbekannt',
      `„${unit.text}“ bei ${whole.format(unit.articles)} ${unit.articles === 1 ? 'Artikel' : 'Artikeln'}; sie kommen in Stück.`,
    ])
  }

  for (const line of summary.problemLines) {
    lines.push(['Nicht lesbar', `${line.file}, Zeile ${whole.format(line.line)}: ${line.reason}`])
  }

  if (summary.problems > summary.problemLines.length) {
    lines.push([
      'Nicht lesbar',
      `Dazu ${whole.format(summary.problems - summary.problemLines.length)} weitere Zeilen.`,
    ])
  }

  if (lines.length === 0) {
    return null
  }

  return (
    <Panel title="Was nicht übernommen wird">
      <ul className="flex flex-col">
        {lines.map(([key, value], index) => (
          <li
            key={`${key}-${String(index)}`}
            className="flex flex-col gap-0.5 border-b border-row py-[7px] text-[14px] leading-[1.4] last:border-b-0"
          >
            <span className="text-[13px] text-ink-muted">{key}</span>
            <span className="[overflow-wrap:anywhere]">{value}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
