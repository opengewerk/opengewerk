import {
  type PrivacyDocumentKind,
  privacyDocumentTitles,
  type PrivacyDocumentsSummary,
  type ProcessingActivityView,
  type ProcessingRecordView,
} from '@opengewerk/domain'
import {
  Button,
  Cell,
  Column,
  Dialog,
  DialogActions,
  Panel,
  Status,
  TablePanel,
  TextArea,
  useButtonLook,
} from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import { FactList, SettingsPage, SettingsText } from '@opengewerk/platform-web/office'
import { RequestRefused } from '@opengewerk/platform-web/sync'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Check, Download, Pencil, RotateCcw } from 'lucide-react'
import { useState } from 'react'

import {
  keepProcessingActivity,
  keepProcessingRecord,
  privacyDocument,
  privacyDocumentsKey,
  privacyDocumentsSummary,
  processingRecord,
  processingRecordKey,
} from '../../session/privacy.js'
import { saveFile } from './access-requests.js'

/**
 * The three documents on data protection (#319): a card for each at the end
 * of "Datenschutz", and the page where whoever leads the business keeps what
 * the record needs and the application does not know. Each PDF is made fresh
 * when it is downloaded (Moritz, 05.11.2026).
 */

/** The template of the contract on processing on behalf, on the website. */
export const contractTemplate = 'https://opengewerk.de/auftragsverarbeitung/'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

const shortNames: Readonly<Record<PrivacyDocumentKind, string>> = {
  record: 'Verzeichnis',
  measures: 'Maßnahmen',
  deletion: 'Löschkonzept',
}

function DownloadButton({ kind }: { readonly kind: PrivacyDocumentKind }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        size="small"
        icon={Download}
        disabled={busy}
        aria-label={`${shortNames[kind]} als PDF herunterladen`}
        onClick={() => {
          setBusy(true)
          setProblem(null)
          privacyDocument(kind)
            .then((file) => {
              saveFile(file, `${privacyDocumentTitles[kind]}.pdf`)
            })
            .catch((error: unknown) => {
              setProblem(saidWhy(error, 'Das PDF kam nicht an.'))
            })
            .finally(() => {
              setBusy(false)
            })
        }}
      >
        PDF herunterladen
      </Button>
      {problem ? (
        <span role="alert" className="text-[13px] text-conflict">
          {problem}
        </span>
      ) : null}
    </span>
  )
}

function months(count: number): string {
  return count === 1 ? '1 Monat' : `${String(count)} Monaten`
}

/** The cards of the three documents, at the end of "Datenschutz". */
export function DocumentCards() {
  const summary = useQuery({ queryKey: privacyDocumentsKey, queryFn: privacyDocumentsSummary })

  if (summary.isPending) {
    return <SettingsText muted>Die Dokumente zum Datenschutz werden geladen.</SettingsText>
  }

  if (summary.isError) {
    return (
      <SettingsText muted>
        {saidWhy(summary.error, 'Die Dokumente zum Datenschutz kamen nicht an.')}
      </SettingsText>
    )
  }

  return (
    <>
      <RecordCard summary={summary.data} />
      <MeasuresCard summary={summary.data} />
      <DeletionCard summary={summary.data} />
    </>
  )
}

function RecordCard({ summary }: { readonly summary: PrivacyDocumentsSummary }) {
  const look = useButtonLook('secondary', 'small')
  const { record } = summary

  return (
    <Panel
      title={privacyDocumentTitles.record}
      roomy
      action={
        <div className="flex flex-wrap items-start justify-end gap-2">
          <Link to="/einstellungen/datenschutz/verzeichnis" className={look}>
            <Pencil size={14} aria-hidden="true" className="shrink-0" />
            Angaben pflegen
          </Link>
          <DownloadButton kind="record" />
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <SettingsText>
          Nach Art. 30 DSGVO: je Tätigkeit Zweck, Rechtsgrundlage, betroffene Personen, Daten,
          Empfänger und Löschung. Betroffene, Daten und Löschung kennt die Anwendung; Zweck und
          Rechtsgrundlage schlägt sie vor, bis der Inhaber sie bestätigt oder ändert. Es nennt nur,
          was der Betrieb nutzt.
        </SettingsText>
        <FactList
          keyWidth={200}
          facts={[
            { label: 'Verantwortlicher', value: record.controller },
            { label: 'Datenschutzbeauftragter', value: record.officer ?? 'keiner angegeben' },
            {
              label: 'Tätigkeiten',
              value: `${String(record.used)} genutzt, davon ${String(record.confirmed)} bestätigt und ${String(record.used - record.confirmed)} als Vorschlag; ${String(record.unused)} nicht genutzt`,
            },
          ]}
        />
      </div>
    </Panel>
  )
}

function MeasuresCard({ summary }: { readonly summary: PrivacyDocumentsSummary }) {
  const { measures } = summary

  return (
    <Panel title={privacyDocumentTitles.measures} roomy action={<DownloadButton kind="measures" />}>
      <div className="flex flex-col gap-3">
        <SettingsText>
          Anlage 1 zum Vertrag zur Auftragsverarbeitung. Teil A sagt, was die Anwendung mitbringt,
          und ist auf jeder Instanz gleich; Teil B und die Unterauftragsverarbeiter trägt ein, wer
          die Instanz betreibt.
        </SettingsText>
        <FactList
          keyWidth={200}
          facts={[
            { label: 'Teil A', value: 'aus der Anwendung' },
            {
              label: 'Teil B',
              value:
                measures.changedOn === null
                  ? 'vom Betreiber der Instanz noch nicht ausgefüllt'
                  : `vom Betreiber der Instanz, zuletzt geändert am ${date(measures.changedOn)}`,
            },
            {
              label: 'Unterauftragsverarbeiter',
              value:
                measures.subprocessors === 0 ? 'keine eingetragen' : String(measures.subprocessors),
            },
          ]}
        />
        <p className="m-0 text-[13px] text-ink-faint">
          Die Vorlage für den Vertrag zur Auftragsverarbeitung, mit Teil A wie hier, steht auf{' '}
          <a href={contractTemplate} target="_blank" rel="noreferrer" className="underline">
            opengewerk.de/auftragsverarbeitung
          </a>
          . Sie ist nicht rechtlich geprüft.
        </p>
      </div>
    </Panel>
  )
}

function DeletionCard({ summary }: { readonly summary: PrivacyDocumentsSummary }) {
  const { deletion } = summary
  const automatic = deletion.automatic.length
  const how = (kind: 'prospect' | 'customer') =>
    deletion.automatic.includes(kind) ? 'löschen' : 'vorschlagen'

  return (
    <Panel title={privacyDocumentTitles.deletion} roomy action={<DownloadButton kind="deletion" />}>
      <div className="flex flex-col gap-3">
        <SettingsText>
          Welche Daten die Anwendung wann löscht oder vorschlägt und was sie aufbewahrt, aus dem
          Regelpaket der Aufbewahrungsfristen, den Arten des Löschkonzepts und dem, was dieser
          Betrieb eingestellt hat.
        </SettingsText>
        <FactList
          keyWidth={200}
          facts={[
            {
              label: 'Arten',
              value: `${String(deletion.kinds)}, davon ${automatic === 0 ? 'keine' : String(automatic)} automatisch`,
            },
            {
              label: 'Leads ohne Kontakt',
              value: `nach ${months(deletion.prospectMonths)} ${how('prospect')}`,
            },
            {
              label: 'Kunden ohne Kontakt',
              value: `nach ${months(deletion.customerMonths)} ${how('customer')}`,
            },
          ]}
        />
      </div>
    </Panel>
  )
}

/** The page of the record: who is responsible, the activities and what is not used. */
export function ProcessingRecordScreen() {
  const look = useButtonLook()
  const record = useQuery({ queryKey: processingRecordKey, queryFn: processingRecord })

  return (
    <SettingsPage
      active="datenschutz"
      title={privacyDocumentTitles.record}
      sub="Was die Anwendung nicht weiß: wer verantwortlich ist, was außerhalb geschieht, und je Tätigkeit Zweck, Rechtsgrundlage und Empfänger."
      actions={
        <Link to="/einstellungen/datenschutz" className={look}>
          <ArrowLeft size={16} aria-hidden="true" className="shrink-0" />
          Zurück zu Datenschutz
        </Link>
      }
    >
      {record.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : record.isError ? (
        <SettingsText muted>{saidWhy(record.error, 'Das Verzeichnis kam nicht an.')}</SettingsText>
      ) : (
        <RecordPage record={record.data} />
      )}
    </SettingsPage>
  )
}

function RecordPage({ record }: { readonly record: ProcessingRecordView }) {
  const [editing, setEditing] = useState<ProcessingActivityView | null>(null)
  const used = record.activities.filter((activity) => activity.unused === null)
  const unused = record.activities.filter((activity) => activity.unused !== null)

  return (
    <>
      <ControllerPanel
        key={`${record.controller ?? ''}|${record.officer ?? ''}|${record.outside ?? ''}`}
        record={record}
      />
      <ActivitiesTable
        activities={used}
        leads={record.leads}
        onEdit={(activity) => {
          setEditing(activity)
        }}
      />
      {unused.length > 0 ? <UnusedPanel activities={unused} /> : null}
      {editing ? (
        <ActivityDialog
          key={editing.key}
          activity={editing}
          onClose={() => {
            setEditing(null)
          }}
        />
      ) : null}
    </>
  )
}

function changedSentence(record: ProcessingRecordView): string | null {
  if (record.changed === null) {
    return null
  }

  return record.changed.by === null
    ? `Zuletzt geändert am ${date(record.changed.on)}.`
    : `Zuletzt geändert am ${date(record.changed.on)} von ${record.changed.by}.`
}

function ControllerPanel({ record }: { readonly record: ProcessingRecordView }) {
  const queries = useQueryClient()
  const [controller, setController] = useState(record.controller ?? record.proposedController)
  const [officer, setOfficer] = useState(record.officer ?? '')
  const [outside, setOutside] = useState(record.outside ?? '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const changed = changedSentence(record)

  return (
    <Panel title="Wer verantwortlich ist" roomy>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          setBusy(true)
          setProblem(null)
          keepProcessingRecord({ controller, officer, outside })
            .then((kept) => {
              queries.setQueryData(processingRecordKey, kept)
              void queries.invalidateQueries({ queryKey: privacyDocumentsKey })
            })
            .catch((error: unknown) => {
              setProblem(saidWhy(error, 'Das Verzeichnis wurde nicht gespeichert.'))
            })
            .finally(() => {
              setBusy(false)
            })
        }}
      >
        <TextArea
          label="Verantwortlicher"
          rows={3}
          readOnly={!record.leads}
          value={controller}
          hint={
            record.controller === null
              ? 'Name, Anschrift, Kontakt und wer den Betrieb vertritt. Vorgegeben aus dem Briefkopf, mit dem Speichern bestätigt.'
              : 'Name, Anschrift, Kontakt und wer den Betrieb vertritt.'
          }
          onChange={(event) => {
            setController(event.target.value)
          }}
        />
        <TextArea
          label="Datenschutzbeauftragter"
          rows={2}
          readOnly={!record.leads}
          value={officer}
          hint="Leer, wenn der Betrieb keinen hat."
          onChange={(event) => {
            setOfficer(event.target.value)
          }}
        />
        <TextArea
          label="Verarbeitungen außerhalb von OpenGewerk"
          rows={3}
          readOnly={!record.leads}
          value={outside}
          hint="Was der Betrieb mit anderen Programmen oder Dienstleistern verarbeitet, eine Zeile je Verarbeitung. Steht am Ende des Verzeichnisses."
          onChange={(event) => {
            setOutside(event.target.value)
          }}
        />
        {problem ? (
          <p role="alert" className="m-0 text-[13px] text-conflict">
            {problem}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <SettingsText muted small>
            {record.leads
              ? (changed ?? 'Noch nicht gespeichert.')
              : `${changed === null ? '' : `${changed} `}Ändern darf nur, wer den Betrieb führt.`}
          </SettingsText>
          <div className="grow" />
          {record.leads ? (
            <Button type="submit" tone="primary" icon={Check} disabled={busy}>
              Speichern
            </Button>
          ) : null}
        </div>
      </form>
    </Panel>
  )
}

function stateOf(activity: ProcessingActivityView) {
  return activity.purpose === null ? (
    <Status tone="waiting">Vorschlag</Status>
  ) : (
    <Status tone="done">Bestätigt</Status>
  )
}

function ActivitiesTable({
  activities,
  leads,
  onEdit,
}: {
  readonly activities: readonly ProcessingActivityView[]
  readonly leads: boolean
  readonly onEdit: (activity: ProcessingActivityView) => void
}) {
  const confirmed = activities.filter((activity) => activity.purpose !== null).length
  // Offered only to whoever leads the business: the column, each row and each card ask.
  const edit = (activity: ProcessingActivityView) => (
    <Button
      size="small"
      icon={Pencil}
      aria-label={`${activity.title} bearbeiten`}
      onClick={() => {
        onEdit(activity)
      }}
    >
      Bearbeiten
    </Button>
  )

  return (
    <TablePanel
      title="Tätigkeiten"
      caption="Tätigkeiten im Verzeichnis"
      note={`${String(confirmed)} bestätigt, ${String(activities.length - confirmed)} als Vorschlag. Ein Vorschlag steht im Verzeichnis, bis der Inhaber ihn bestätigt oder ändert, und das Verzeichnis sagt bei jedem, dass er von der Anwendung kommt.`}
      cards={activities.map((activity) => ({
        key: activity.key,
        title: activity.title,
        sub: activity.purpose ?? activity.proposedPurpose,
        right: stateOf(activity),
        ...(leads ? { actions: edit(activity) } : {}),
      }))}
    >
      <thead>
        <tr>
          <Column className="w-[220px]">Tätigkeit</Column>
          <Column>Zweck</Column>
          <Column className="w-[220px]">Rechtsgrundlage</Column>
          <Column className="w-[112px]">Stand</Column>
          {leads ? (
            <Column className="w-[124px]">
              <span className="sr-only">Ändern</span>
            </Column>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {activities.map((activity) => (
          <tr key={activity.key}>
            <Cell className="font-medium">{activity.title}</Cell>
            <Cell className="text-[13px]">{activity.purpose ?? activity.proposedPurpose}</Cell>
            <Cell className="text-[13px]">
              {activity.legalBasis ?? activity.proposedLegalBasis}
            </Cell>
            <Cell>{stateOf(activity)}</Cell>
            {leads ? <Cell className="text-right">{edit(activity)}</Cell> : null}
          </tr>
        ))}
      </tbody>
    </TablePanel>
  )
}

function UnusedPanel({ activities }: { readonly activities: readonly ProcessingActivityView[] }) {
  return (
    <Panel title="Nicht genutzt">
      <div className="flex flex-col gap-2">
        <SettingsText muted small>
          Diese Tätigkeiten kennt die Anwendung, der Betrieb nutzt sie aber nicht. Sie stehen nicht
          im Verzeichnis; nutzt er eine, steht sie im nächsten PDF.
        </SettingsText>
        <ul className="m-0 list-disc pl-[18px] text-[14px]">
          {activities.map((activity) => (
            <li key={activity.key} className="mb-1">
              <span className="font-medium">{activity.title}</span>
              <span className="text-ink-muted">: {activity.unused}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  )
}

function ActivityDialog({
  activity,
  onClose,
}: {
  readonly activity: ProcessingActivityView
  readonly onClose: () => void
}) {
  const queries = useQueryClient()
  const [purpose, setPurpose] = useState(activity.purpose ?? activity.proposedPurpose)
  const [legalBasis, setLegalBasis] = useState(activity.legalBasis ?? activity.proposedLegalBasis)
  const [recipients, setRecipients] = useState(activity.recipients ?? '')
  // Restoring the proposal saves purpose and legal basis as none again.
  const [restored, setRestored] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  return (
    <Dialog title={activity.title} width={600} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          setBusy(true)
          setProblem(null)
          keepProcessingActivity(activity.key, {
            purpose: restored ? '' : purpose,
            legalBasis: restored ? '' : legalBasis,
            recipients,
          })
            .then((kept) => {
              queries.setQueryData(processingRecordKey, kept)
              void queries.invalidateQueries({ queryKey: privacyDocumentsKey })
              onClose()
            })
            .catch((error: unknown) => {
              setProblem(saidWhy(error, 'Die Tätigkeit wurde nicht gespeichert.'))
              setBusy(false)
            })
        }}
      >
        <FactList
          facts={[
            { label: 'Betroffen', value: activity.subjects },
            { label: 'Daten', value: activity.data },
            { label: 'Löschung', value: activity.deletion },
          ]}
        />
        <TextArea
          label="Zweck"
          rows={3}
          required
          starred
          value={purpose}
          onChange={(event) => {
            setPurpose(event.target.value)
            setRestored(false)
          }}
        />
        <TextArea
          label="Rechtsgrundlage"
          rows={3}
          required
          starred
          value={legalBasis}
          {...(activity.purpose === null || restored
            ? { hint: 'Vorschlag der Anwendung. Mit dem Speichern gilt er als bestätigt.' }
            : {})}
          onChange={(event) => {
            setLegalBasis(event.target.value)
            setRestored(false)
          }}
        />
        <TextArea
          label="Empfänger"
          rows={3}
          value={recipients}
          hint="Leer heißt: keine Empfänger außerhalb des Betriebs. Die Empfänger stehen auch in jeder Auskunft an eine betroffene Person."
          onChange={(event) => {
            setRecipients(event.target.value)
          }}
        />
        {problem ? (
          <p role="alert" className="m-0 text-[13px] text-conflict">
            {problem}
          </p>
        ) : null}
        <DialogActions>
          <Button
            icon={RotateCcw}
            className="mr-auto"
            onClick={() => {
              setPurpose(activity.proposedPurpose)
              setLegalBasis(activity.proposedLegalBasis)
              setRestored(true)
            }}
          >
            Vorschlag wiederherstellen
          </Button>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button type="submit" tone="primary" icon={Check} disabled={busy}>
            Speichern
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
