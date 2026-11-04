import {
  type DueErasure,
  type Erasure,
  type ErasureAutomation,
  type ErasureKind,
  erasureKinds,
  erasureKindWords,
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
import { Trash2 } from 'lucide-react'
import { useState } from 'react'

import { useAuthorName } from '../../app/defects.js'
import {
  erase,
  type PrivacyOverview,
  privacyKey,
  privacyOverview,
  switchAutomation,
} from '../../session/privacy.js'

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

/** The question before deleting: "Zwei Leads löschen?", "Einen Lead löschen?". */
export function erasureQuestion(count: number): string {
  return count === 1 ? 'Einen Lead löschen?' : `${countWord(count)} Leads löschen?`
}

/** Who goes, by name while there are few: "Sandra Brenner und Markus Lehmann gehen endgültig." */
export function whoGoes(names: readonly string[]): string {
  if (names.length === 1) {
    return `${names[0] ?? ''} geht endgültig.`
  }

  if (names.length <= 3) {
    return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1] ?? ''} gehen endgültig.`
  }

  return `Die ${String(names.length)} ausgewählten Leads gehen endgültig.`
}

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
          Welche Leads zum Löschen fällig sind, sieht, wer Leads sehen darf.
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
    'Ein Lead, der nie Kunde wurde, kommt nach dem letzten Kontakt hierher, vorgegeben nach zwölf Monaten. Die Dauer steht unter Fristen bei „Lead löschen“.'

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
      await erase(
        'prospect',
        chosen.map((entry) => entry.recordId),
      )
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
        title={erasureQuestion(chosen.length)}
        confirm="Endgültig löschen"
        busy={busy}
        onConfirm={() => {
          void confirm()
        }}
        onCancel={() => {
          setAsking(false)
        }}
      >
        {whoGoes(chosen.map((entry) => entry.name))} Die Werte im Änderungsprotokoll werden
        geschwärzt; was bleibt, ist eine Zeile unter „Gelöscht“, wann und von wem, ohne Namen.
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
                Eingeschaltet löscht der Lauf jeden fälligen Lead von selbst, im Namen dessen, der
                es eingeschaltet hat, und schwärzt seine Werte im Änderungsprotokoll. Führt diese
                Person den Betrieb nicht mehr, schlägt der Lauf wieder nur vor.
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
  const years = `${String(now.value)} Jahre`

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
      starts: words.starts === 'end_of_year' ? 'Ende des Jahres' : 'Tag der Aufzeichnung',
      source: shippedRules.at(words.rule, day)?.source ?? '',
    }
  })

  return (
    <TablePanel
      title="Aufbewahrungsfristen"
      caption="Aufbewahrungsfristen"
      note="Eine Frist läuft nicht ab, solange die Unterlagen für Steuern von Bedeutung sind, deren Festsetzungsfrist noch läuft (§ 147 Abs. 3 Satz 5 AO). Deshalb schlägt der Löschlauf vor, und wer den Betrieb führt, bestätigt."
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
