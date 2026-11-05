import {
  type DueErasure,
  type Erasure,
  type ErasureAutomation,
  type ErasureKind,
  erasureKinds,
  erasureKindWords,
  erasureRequestSentence,
  type ErasureRequestView,
  type IsoDate,
  type RuleRecord,
  retentionKinds,
  retentionKindWords,
  shippedRules,
} from '@opengewerk/domain'
import { Button, Cell, Column, Confirm, Panel, Status, TablePanel } from '@opengewerk/platform-web'
import { date, moment, today } from '@opengewerk/platform-web/format'
import { SettingsPage, SettingsText } from '@opengewerk/platform-web/office'
import { RequestRefused } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Lock, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { useAuthorName } from '../../app/defects.js'
import {
  erase,
  type PrivacyOverview,
  privacyKey,
  privacyOverview,
  restrictOnRequest,
  switchAutomation,
} from '../../session/privacy.js'
import { holdsSentence } from './customer-privacy.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

const numberWords = [
  'null',
  'ein',
  'zwei',
  'drei',
  'vier',
  'fünf',
  'sechs',
  'sieben',
  'acht',
  'neun',
  'zehn',
  'elf',
  'zwölf',
]

/** "Zwei", "Zwölf", "13": a count at the start of a question. */
function countWord(count: number): string {
  const word = numberWords[count] ?? String(count)

  return word.charAt(0).toUpperCase() + word.slice(1)
}

const kindCounted: Readonly<Record<ErasureKind, readonly [string, string]>> = {
  prospect: ['einen Lead', 'Leads'],
  customer: ['einen Kunden', 'Kunden'],
  sickness: ['eine Krankheit', 'Krankheiten'],
  staff_year: ['ein Jahr', 'Jahre'],
  person: ['eine Akte', 'Akten'],
  site: ['ein Objekt', 'Objekte'],
}

/**
 * The question before deleting, by kind: "Zwei Leads löschen?", "Einen
 * Kunden löschen?", "Zwei Leads und einen Kunden löschen?", "Eine Krankheit,
 * ein Jahr und eine Akte löschen?".
 */
export function erasureQuestion(counts: Partial<Readonly<Record<ErasureKind, number>>>): string {
  const parts = erasureKinds.flatMap((kind) => {
    const count = counts[kind] ?? 0
    const [one, many] = kindCounted[kind]

    return count === 0 ? [] : [count === 1 ? one : `${countWord(count).toLowerCase()} ${many}`]
  })
  const said =
    parts.length < 2
      ? parts.join('')
      : `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1] ?? ''}`

  return `${said.charAt(0).toUpperCase()}${said.slice(1)} löschen?`
}

/** Who goes, by name while there are few: "Sandra Brenner und Markus Lehmann gehen endgültig." */
export function whoGoes(names: readonly string[]): string {
  if (names.length === 1) {
    return `${names[0] ?? ''} geht endgültig.`
  }

  if (names.length <= 3) {
    return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1] ?? ''} gehen endgültig.`
  }

  return `Die ${String(names.length)} Ausgewählten gehen endgültig.`
}

/** What goes with a customer and what stays (#845), before it goes. */
export const withCustomer =
  'Mit einem Kunden gehen seine Ansprechpartner, sein Verlauf, seine Aufträge, Belege und Dateien; Objekte und Anlagen bleiben ohne seine Daten.'

/** What goes with a year of a person (#846), before it goes. */
export const withYear =
  'Mit einem Jahr gehen die Arbeitszeiten, die Rufbereitschaft, der Urlaub und der Urlaubsanspruch dieses Jahres.'

/** What goes with the file of somebody who left (#846), and what stays a while. */
export const withPerson =
  'Mit einer Akte gehen die vereinbarte Arbeitszeit, die Qualifikationen mit ihren Zertifikaten und der Zugang; werden von der Person noch Arbeitszeiten aufbewahrt, bleibt ihr Name, bis das letzte Jahr geht.'

/** What goes with the site of a deleted customer (#848), and what stays of it. */
export const withSite =
  'Mit einem Objekt gehen seine Anlagen samt Struktur, die Geräte, Protokolle, Etiketten, Mängel, Zugänge, Dateien und Fristen; Aufträge und Belege dort bleiben als leere Hülle.'

/** What stays of whatever went: a line without a name. */
const protocolSentence =
  'Die Werte im Änderungsprotokoll werden geschwärzt; was bleibt, ist eine Zeile unter „Gelöscht“, wann und von wem, ohne Namen.'

/**
 * The deletion concept in the office (#317), as the boards "Datenschutz"
 * draw it: what is due with a confirmation before it goes, the kinds that go
 * by themselves, what went, and how long papers are kept. Whoever reads the
 * settings sees it; deleting and switching are offered to whoever leads the
 * business, which the server says and checks again.
 */
export function PrivacyScreen() {
  const overview = useQuery({ queryKey: privacyKey, queryFn: privacyOverview })

  return (
    <SettingsPage
      active="datenschutz"
      title="Datenschutz"
      sub="Was nach dem Löschkonzept fällig ist, was gelöscht wurde und wie lange Unterlagen bleiben."
    >
      {overview.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : overview.isError ? (
        <SettingsText muted>
          {saidWhy(overview.error, 'Der Datenschutz kam nicht an.')}
        </SettingsText>
      ) : (
        <>
          <RequestsSection overview={overview.data} />
          <DueSection overview={overview.data} />
          <AutomaticSection overview={overview.data} />
          <ErasedSection erasures={overview.data.erasures} />
        </>
      )}
      <RetentionSection />
    </SettingsPage>
  )
}

function DueSection({ overview }: { readonly overview: PrivacyOverview }) {
  if (overview.due === null) {
    return (
      <Panel title="Zum Löschen fällig" roomy>
        <SettingsText muted>
          Was zum Löschen fällig ist, sieht, wer Leads oder Kunden sehen, Abwesenheiten pflegen oder
          Akten lesen darf.
        </SettingsText>
      </Panel>
    )
  }

  return <DueTable due={overview.due} leads={overview.leads} />
}

function DueTable({
  due,
  leads,
}: {
  readonly due: readonly DueErasure[]
  readonly leads: boolean
}) {
  const queries = useQueryClient()
  const [unselected, setUnselected] = useState<ReadonlySet<string>>(new Set())
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const chosen = due.filter((entry) => !unselected.has(entry.recordId))
  const note =
    'Ein Lead, der nie Kunde wurde, kommt nach dem letzten Kontakt hierher, vorgegeben nach zwölf Monaten; ein Kunde, wenn mit ihm nichts mehr läuft, vorgegeben drei Jahre nach dem letzten Kontakt, oder auf seine Löschanfrage. Die Dauer steht unter Fristen bei „Lead löschen“ und „Kunde löschen“. Eine Krankheit kommt zwölf Monate nach ihrem letzten Tag, Arbeitszeiten und Urlaub eines Jahres sechs Jahre nach dessen Ende und die Akte einer Person drei Jahre nach dem Ende ihres Austrittsjahres, sobald ihr Zugang geendet hat. Das Objekt eines gelöschten Kunden kommt zehn Jahre nach dem letzten unterschriebenen Protokoll daran, ohne Protokoll nach dem letzten Auftrag dort.'
  const counts = Object.fromEntries(
    erasureKinds.map((kind) => [kind, chosen.filter((entry) => entry.kind === kind).length]),
  ) as Readonly<Record<ErasureKind, number>>

  const toggle = (entry: DueErasure, on: boolean) => {
    setUnselected((before) => {
      const next = new Set(before)

      if (on) {
        next.delete(entry.recordId)
      } else {
        next.add(entry.recordId)
      }

      return next
    })
  }

  const confirm = async () => {
    setBusy(true)
    setProblem(null)

    try {
      // One kind after the other, each all or nothing.
      for (const kind of erasureKinds) {
        const ids = chosen.filter((entry) => entry.kind === kind).map((entry) => entry.recordId)

        if (ids.length > 0) {
          await erase(kind, ids)
        }
      }

      setAsking(false)
      setUnselected(new Set())
      await queries.invalidateQueries({ queryKey: privacyKey })
      await queries.invalidateQueries({ queryKey: ['prospects'] })
    } catch (error) {
      setAsking(false)
      setProblem(saidWhy(error, 'Das Löschen ging nicht durch. Nichts wurde gelöscht.'))
    } finally {
      setBusy(false)
    }
  }

  if (due.length === 0) {
    return (
      <Panel title="Zum Löschen fällig" roomy>
        <div className="flex flex-col gap-2">
          <SettingsText>Nichts ist zum Löschen fällig.</SettingsText>
          <SettingsText muted small>
            {note}
          </SettingsText>
        </div>
      </Panel>
    )
  }

  return (
    <>
      <TablePanel
        title="Zum Löschen fällig"
        caption="Zum Löschen fällig"
        action={
          leads ? (
            <Button
              tone="danger"
              size="small"
              icon={Trash2}
              disabled={chosen.length === 0}
              onClick={() => {
                setAsking(true)
              }}
            >
              Ausgewählte löschen
            </Button>
          ) : null
        }
        note={
          <>
            {problem ? (
              <span role="alert" className="mb-1 block text-conflict">
                {problem}
              </span>
            ) : null}
            {note}
          </>
        }
      >
        <thead>
          <tr>
            {leads ? (
              <Column className="w-[40px]">
                <span className="sr-only">Auswahl</span>
              </Column>
            ) : null}
            <Column className="w-[90px]">Art</Column>
            <Column>Was</Column>
            <Column className="w-[110px] text-right">Fällig seit</Column>
          </tr>
        </thead>
        <tbody>
          {due.map((entry) => (
            <tr key={entry.recordId}>
              {leads ? (
                <Cell>
                  <input
                    type="checkbox"
                    aria-label={`${entry.name} auswählen`}
                    className="size-4 accent-copper-solid"
                    checked={!unselected.has(entry.recordId)}
                    onChange={(event) => {
                      toggle(entry, event.target.checked)
                    }}
                  />
                </Cell>
              ) : null}
              <Cell>{erasureKindWords[entry.kind].one}</Cell>
              <Cell>
                <span className="flex flex-col gap-px">
                  <span>{entry.name}</span>
                  <span className="text-[12px] text-ink-faint">{entry.detail}</span>
                </span>
              </Cell>
              <Cell className="text-right">{date(entry.dueOn)}</Cell>
            </tr>
          ))}
        </tbody>
      </TablePanel>
      <Confirm
        open={asking}
        title={erasureQuestion(counts)}
        confirm="Endgültig löschen"
        busy={busy}
        onConfirm={() => {
          void confirm()
        }}
        onCancel={() => {
          setAsking(false)
        }}
      >
        {[
          whoGoes(chosen.map((entry) => entry.name)),
          counts.customer > 0 ? withCustomer : null,
          counts.staff_year > 0 ? withYear : null,
          counts.person > 0 ? withPerson : null,
          counts.site > 0 ? withSite : null,
          protocolSentence,
        ]
          .filter((part) => part !== null)
          .join(' ')}
      </Confirm>
    </>
  )
}

const automaticWords: Readonly<Record<ErasureKind, string>> = {
  prospect:
    'Eingeschaltet löscht der Lauf jeden fälligen Lead von selbst, im Namen dessen, der es eingeschaltet hat, und schwärzt seine Werte im Änderungsprotokoll. Führt diese Person den Betrieb nicht mehr, schlägt der Lauf wieder nur vor.',
  customer:
    'Eingeschaltet löscht der Lauf jeden fälligen Kunden von selbst, wie die Leads; die auf eine Löschanfrage eingeschlossen.',
  sickness:
    'Eingeschaltet löscht der Lauf jede Krankheit zwölf Monate nach ihrem letzten Tag von selbst. Danach zählt ein Tag darin, der in einem Urlaub lag, wieder als Urlaub.',
  staff_year:
    'Eingeschaltet löscht der Lauf die Arbeitszeiten, die Rufbereitschaft, den Urlaub und den Urlaubsanspruch eines Jahres von selbst, sobald sie als Lohnunterlage nicht mehr aufzubewahren sind.',
  person:
    'Eingeschaltet löscht der Lauf die Akte einer ausgetretenen Person von selbst, mit ihrer Arbeitszeit, ihren Qualifikationen und ihrem Zugang.',
  site: 'Eingeschaltet löscht der Lauf das Objekt eines gelöschten Kunden zehn Jahre nach dem letzten Protokoll von selbst, mit seinen Anlagen, Geräten, Protokollen, Mängeln und Dateien.',
}

/**
 * The requests for deletion that run (#845), as the boards "Datenschutz"
 * draw them: each with what holds its customer and the answer it can get
 * today, restricting or deleting, offered to whoever leads the business.
 */
function RequestsSection({ overview }: { readonly overview: PrivacyOverview }) {
  const queries = useQueryClient()
  const [asking, setAsking] = useState<{
    readonly view: ErasureRequestView
    readonly answer: 'erase' | 'restrict'
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const note =
    'Erfasst wird eine Löschanfrage in der Kundenakte. Gelöscht wird ein Kunde, mit dem nichts mehr läuft; halten ihn noch Belege oder eine Gewährleistung, wird er gesperrt: Er verschwindet aus Listen und Auswahlen und von jedem Gerät und bekommt keine E-Mail mehr. Mit dem Ende der letzten Frist steht er unter „Zum Löschen fällig“.'

  if (overview.requests === null) {
    return (
      <Panel title="Löschanfragen" roomy>
        <SettingsText muted>Löschanfragen sieht, wer Kunden sehen darf.</SettingsText>
      </Panel>
    )
  }

  if (overview.requests.length === 0) {
    return (
      <Panel title="Löschanfragen" roomy>
        <div className="flex flex-col gap-2">
          <SettingsText>Keine Löschanfrage offen.</SettingsText>
          <SettingsText muted small>
            {note}
          </SettingsText>
        </div>
      </Panel>
    )
  }

  const answer = async () => {
    if (asking === null) {
      return
    }

    setBusy(true)
    setProblem(null)

    try {
      if (asking.answer === 'erase') {
        await erase('customer', [asking.view.request.customerId])
      } else {
        await restrictOnRequest(asking.view.request.id)
      }

      await queries.invalidateQueries({ queryKey: privacyKey })
    } catch (error) {
      setProblem(saidWhy(error, 'Die Antwort ging nicht durch. Nichts wurde geändert.'))
    } finally {
      setBusy(false)
      setAsking(null)
    }
  }

  const due = (view: ErasureRequestView) =>
    view.request.status === 'restricted'
      ? view.dueOn === null
        ? 'Noch offen'
        : `Löschen ab ${date(view.dueOn)}`
      : `Antwort bis ${date(view.request.answerDueOn)}`
  const waits = (view: ErasureRequestView) =>
    view.holds.some((hold) => hold.kind === 'open_job')
      ? 'Erst nach dem Auftrag'
      : 'Erst nach dem Vertrag'
  const actionOf = (view: ErasureRequestView) => {
    if (!overview.leads || view.request.status !== 'open') {
      return null
    }

    if (view.answer === 'erase') {
      return (
        <Button
          tone="danger"
          size="small"
          icon={Trash2}
          onClick={() => {
            setAsking({ view, answer: 'erase' })
          }}
        >
          Löschen
        </Button>
      )
    }

    if (view.answer === 'restrict') {
      return (
        <Button
          size="small"
          icon={Lock}
          onClick={() => {
            setAsking({ view, answer: 'restrict' })
          }}
        >
          Sperren
        </Button>
      )
    }

    return <span className="text-ink-faint">{waits(view)}</span>
  }

  return (
    <>
      <TablePanel
        title="Löschanfragen"
        caption="Löschanfragen"
        note={
          <>
            {problem ? (
              <span role="alert" className="mb-1 block text-conflict">
                {problem}
              </span>
            ) : null}
            {note}
          </>
        }
      >
        <thead>
          <tr>
            <Column>Kunde</Column>
            <Column className="w-[110px]">Stand</Column>
            <Column className="w-[160px]">Fällig</Column>
            <Column className="w-[160px] text-right">
              <span className="sr-only">Antwort</span>
            </Column>
          </tr>
        </thead>
        <tbody>
          {overview.requests.map((view) => (
            <tr key={view.request.id}>
              <Cell>
                <span className="flex flex-col gap-px">
                  {view.request.status === 'restricted' ? (
                    <span>{view.customerName}</span>
                  ) : (
                    <Link
                      to="/kunden/$customerId"
                      params={{ customerId: view.request.customerId }}
                      className="text-copper-text underline underline-offset-2"
                    >
                      {view.customerName}
                    </Link>
                  )}
                  <span className="text-[12px] text-ink-faint">
                    {`${erasureRequestSentence(view.request)} · ${holdsSentence(view)}`}
                  </span>
                </span>
              </Cell>
              <Cell>
                <Status tone={view.request.status === 'restricted' ? 'locked' : 'waiting'}>
                  {view.request.status === 'restricted' ? 'Gesperrt' : 'Offen'}
                </Status>
              </Cell>
              <Cell>{due(view)}</Cell>
              <Cell className="text-right">{actionOf(view)}</Cell>
            </tr>
          ))}
        </tbody>
      </TablePanel>
      <Confirm
        open={asking !== null}
        title={
          asking === null
            ? ''
            : `${asking.view.customerName} ${asking.answer === 'erase' ? 'löschen' : 'sperren'}?`
        }
        confirm={asking?.answer === 'restrict' ? 'Sperren' : 'Endgültig löschen'}
        tone={asking?.answer === 'restrict' ? 'primary' : 'danger'}
        busy={busy}
        onConfirm={() => {
          void answer()
        }}
        onCancel={() => {
          setAsking(null)
        }}
      >
        {asking === null
          ? null
          : asking.answer === 'erase'
            ? `${asking.view.customerName} geht endgültig, die Löschanfrage ist damit erledigt. ${withCustomer} ${protocolSentence}`
            : `${holdsSentence(asking.view)} Bis dahin verschwindet ${asking.view.customerName} aus Listen und Auswahlen und von jedem Gerät und bekommt keine E-Mail mehr. Danach steht der Kunde unter „Zum Löschen fällig“.`}
      </Confirm>
    </>
  )
}

function AutomaticSection({ overview }: { readonly overview: PrivacyOverview }) {
  const queries = useQueryClient()
  const nameOf = useAuthorName()
  const [busy, setBusy] = useState<ErasureKind | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const flip = async (kind: ErasureKind, on: boolean) => {
    setBusy(kind)
    setProblem(null)

    try {
      await switchAutomation(kind, on)
      await queries.invalidateQueries({ queryKey: privacyKey })
    } catch (error) {
      setProblem(saidWhy(error, 'Das Umstellen ging nicht durch.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel title="Automatisch löschen" roomy>
      <div className="flex flex-col gap-3">
        {erasureKinds.map((kind) => {
          const automation: ErasureAutomation | undefined = overview.automations.find(
            (entry) => entry.kind === kind,
          )

          return (
            <div key={kind} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[14px] font-semibold">{erasureKindWords[kind].title}</span>
                <Status tone={automation ? 'done' : 'neutral'}>{automation ? 'An' : 'Aus'}</Status>
                <div className="grow" />
                {overview.leads ? (
                  <Button
                    size="small"
                    disabled={busy !== null}
                    onClick={() => {
                      void flip(kind, automation === undefined)
                    }}
                  >
                    {automation ? 'Ausschalten' : 'Einschalten'}
                  </Button>
                ) : null}
              </div>
              {automation ? (
                <SettingsText small>
                  Eingeschaltet von {nameOf(automation.enabledBy)} am {date(automation.enabledAt)}.
                </SettingsText>
              ) : null}
              <SettingsText muted small>
                {automaticWords[kind]}
              </SettingsText>
            </div>
          )
        })}
        {problem ? (
          <p role="alert" className="m-0 text-[13px] text-conflict">
            {problem}
          </p>
        ) : null}
      </div>
    </Panel>
  )
}

function ErasedSection({ erasures }: { readonly erasures: readonly Erasure[] }) {
  const nameOf = useAuthorName()
  const note =
    'Eine Zeile hier nennt keinen Namen. Die Werte im Änderungsprotokoll sind geschwärzt, die Kette bleibt ganz.'
  const by = (entry: Erasure) =>
    entry.automatic ? `Von selbst, für ${nameOf(entry.erasedBy)}` : nameOf(entry.erasedBy)

  if (erasures.length === 0) {
    return (
      <Panel title="Gelöscht" roomy>
        <SettingsText muted>Noch nichts gelöscht.</SettingsText>
      </Panel>
    )
  }

  return (
    <TablePanel
      title="Gelöscht"
      caption="Gelöscht"
      note={note}
      cards={erasures.map((entry) => ({
        key: entry.id,
        title: entry.label,
        sub: `${moment(entry.erasedAt)} · ${by(entry)}`,
      }))}
    >
      <thead>
        <tr>
          <Column className="w-[150px]">Wann</Column>
          <Column className="w-[90px]">Art</Column>
          <Column>Was</Column>
          <Column className="w-[150px]">Von</Column>
        </tr>
      </thead>
      <tbody>
        {erasures.map((entry) => (
          <tr key={entry.id}>
            <Cell>{moment(entry.erasedAt)}</Cell>
            <Cell>{erasureKindWords[entry.kind].one}</Cell>
            <Cell>{entry.label}</Cell>
            <Cell>{by(entry)}</Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

const yearWords: Readonly<Record<number, string>> = { 2: 'zwei', 6: 'sechs', 8: 'acht', 10: 'zehn' }

/** "8 Jahre, bis 2024 zehn": the period now, and the one before where the law changed it. */
export function periodWords(key: string, on: IsoDate): string {
  const now = shippedRules.at(key, on)

  if (now === null) {
    return ''
  }

  const before = shippedRules
    .all()
    .filter((record: RuleRecord) => record.key === key && record.validUntil !== null)
    .filter((record) => (record.validUntil ?? '') < now.validFrom)
    .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1))[0]
  const years = now.value === 1 ? '1 Jahr' : `${String(now.value)} Jahre`

  return before && before.value !== now.value
    ? `${years}, bis ${(before.validUntil ?? '').slice(0, 4)} ${yearWords[before.value] ?? String(before.value)}`
    : years
}

function RetentionSection() {
  const day = today() as IsoDate
  const rows = retentionKinds.map((kind) => {
    const words = retentionKindWords[kind]

    return {
      kind,
      label: words.label,
      period: periodWords(words.rule, day),
      starts: words.begins,
      source: shippedRules.at(words.rule, day)?.source ?? '',
    }
  })

  return (
    <TablePanel
      title="Aufbewahrungsfristen"
      caption="Aufbewahrungsfristen"
      note="Eine Frist läuft nicht ab, solange die Unterlagen für Steuern von Bedeutung sind, deren Festsetzungsfrist noch läuft (§ 147 Abs. 3 Satz 5 AO). Deshalb schlägt der Löschlauf vor, und wer den Betrieb führt, bestätigt. Rechnungen, Gutschriften und Stornos eines Kunden zählen als Buchungsbelege, seine übrigen Belege als Geschäftsbriefe. Urlaub und Urlaubsanspruch eines Jahres bleiben so lange wie die Arbeitszeiten desselben Jahres."
      cards={rows.map((row) => ({
        key: row.kind,
        title: row.label,
        sub: `${row.period} · ${row.starts} · ${row.source}`,
      }))}
    >
      <thead>
        <tr>
          <Column>Unterlagen</Column>
          <Column className="w-[150px]">Frist</Column>
          <Column className="w-[140px]">Beginnt</Column>
          <Column className="w-[270px]">Fundstelle</Column>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.kind}>
            <Cell>{row.label}</Cell>
            <Cell>{row.period}</Cell>
            <Cell>{row.starts}</Cell>
            <Cell className="text-ink-muted">{row.source}</Cell>
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}
