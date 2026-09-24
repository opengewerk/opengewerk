import {
  formValuesText,
  type RecordState,
  sealingField,
  signerNameProblem,
} from '@opengewerk/domain'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { Button, Card, Field, FieldLabel } from '../../components/index.js'
import { date } from '../../app/format.js'
import {
  definitionOf,
  isSigned,
  missingBeforeSigning,
  ProtocolPdfLink,
  ProtocolSheet,
  ProtocolsList,
  valuesOf,
} from '../../app/protocols.js'
import { refusalText } from '../../sync/client.js'
import { text } from '../../sync/fields.js'
import { useRecord, useSync } from '../../sync/provider.js'
import { SignaturePad } from '../signature-pad.js'

/**
 * The test protocol on site (#79): started at the installation of the job,
 * filled in circuit by circuit in front of the board, without a network, and
 * signed by the tester on the device. Once signed it is fixed, on the device
 * as in the database, and a new test is a new protocol.
 */

function protocolPath(jobId: string, recordId: string): string {
  return `/auftraege/${jobId}/pruefprotokolle/${recordId}`
}

/** The protocols of the job's installation, in its card on the job's screen. */
export function InstallationProtocols({
  jobId,
  installationId,
}: {
  readonly jobId: string
  readonly installationId: string
}) {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-3">
      <FieldLabel>Prüfprotokolle</FieldLabel>
      <ProtocolsList
        installationId={installationId}
        jobId={jobId}
        pathOf={(recordId) => protocolPath(jobId, recordId)}
        onStarted={(recordId) => {
          void navigate({ to: protocolPath(jobId, recordId) })
        }}
      />
    </div>
  )
}

/**
 * What stands between the saved protocol and the signature: unsaved changes,
 * and whatever the definition requires that is still empty.
 */
function SignOffer({
  record,
  unsaved,
  onSign,
}: {
  readonly record: RecordState
  readonly unsaved: boolean
  readonly onSign: () => void
}) {
  const missing = missingBeforeSigning(record)

  return (
    <Card label="Unterschrift des Prüfers">
      <div className="flex flex-col gap-3">
        {unsaved ? (
          <p className="text-body">Erst speichern, dann unterschreiben.</p>
        ) : missing.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-body">Vor der Unterschrift fehlt noch:</p>
            <ul className="list-disc pl-5 text-body">
              {missing.slice(0, 5).map((sentence) => (
                <li key={sentence}>{sentence}</li>
              ))}
            </ul>
            {missing.length > 5 ? (
              <p className="text-body text-ink-muted">{`und ${String(missing.length - 5)} weitere.`}</p>
            ) : null}
          </div>
        ) : (
          <p className="text-body">
            Das Protokoll ist vollständig. Mit der Unterschrift wird es festgeschrieben.
          </p>
        )}
        <Button tone="primary" wide disabled={unsaved || missing.length > 0} onClick={onSign}>
          Unterschreiben
        </Button>
      </div>
    </Card>
  )
}

/** The tester signs: the name, the signature, and the protocol is fixed. */
function SigningStep({
  record,
  onBack,
}: {
  readonly record: RecordState
  readonly onBack: () => void
}) {
  const client = useSync()
  const definition = definitionOf(record)
  const seal = definition ? sealingField(definition) : null
  const values = valuesOf(record)
  const [name, setName] = useState(typeof values['tester'] === 'string' ? values['tester'] : '')
  const [path, setPath] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function sign(event: FormEvent) {
    event.preventDefault()

    const nameProblem = signerNameProblem(name)

    if (nameProblem !== null) {
      setProblem(nameProblem)

      return
    }

    if (!path) {
      setTrouble('Bitte im Feld unterschreiben.')

      return
    }

    if (!seal) {
      setTrouble('Dieses Formular hat keine Unterschrift, die es festschreibt.')

      return
    }

    setProblem(undefined)
    setTrouble(null)
    setWorking(true)

    try {
      const signed = await client.update('form_records', String(record['id']), {
        status: 'signed',
        values: formValuesText({
          ...values,
          [seal.key]: { name: name.trim(), path, signedAt: new Date().toISOString() },
        }),
      })

      if (signed.outcome === 'refused') {
        setTrouble(refusalText[signed.reason])
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        void sign(event)
      }}
    >
      <p className="text-body font-semibold">
        Mit der Unterschrift bestätigen Sie die Prüfung, wie sie im Protokoll steht. Danach ändert
        sich daran nichts mehr.
      </p>

      <Card label={seal?.label ?? 'Unterschrift'}>
        <div className="flex flex-col gap-4">
          <Field
            label="Name"
            autoComplete="off"
            value={name}
            problem={problem}
            onChange={(event) => {
              setName(event.target.value)
            }}
          />
          <SignaturePad label="Unterschriftsfeld" onChange={setPath} />
        </div>
      </Card>

      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <Button type="submit" tone="primary" wide disabled={working}>
          Unterschreiben
        </Button>
        <Button tone="quiet" wide disabled={working} onClick={onBack}>
          Zurück zum Protokoll
        </Button>
      </div>
    </form>
  )
}

export function SiteProtocolScreen() {
  const { jobId, recordId } = useParams({ strict: false }) as {
    jobId?: string
    recordId?: string
  }
  const record = useRecord('form_records', recordId)
  const installation = useRecord(
    'installations',
    record ? text(record, 'installationId') : undefined,
  )
  const [signing, setSigning] = useState(false)

  if (!record || !recordId || !jobId) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <h1 className="text-title font-semibold">Nicht gefunden</h1>
        <p className="text-body">
          Dieses Protokoll hat dieses Gerät nicht. Mit Verbindung holt der Abgleich es.
        </p>
      </div>
    )
  }

  const signed = isSigned(record)

  return (
    <div className="flex flex-col gap-4 p-4">
      <Link
        to={`/auftraege/${jobId}`}
        className="text-body text-copper-text font-semibold underline underline-offset-2"
      >
        Zurück zum Auftrag
      </Link>
      <div className="flex flex-col gap-1">
        <FieldLabel>
          {installation ? text(installation, 'designation') : 'Prüfprotokoll'}
        </FieldLabel>
        <h1 className="text-title font-semibold">
          {definitionOf(record)?.title ?? 'Prüfprotokoll'}
        </h1>
        <p className="text-body text-ink-muted">
          {`${date(record['performedOn'])}, ${signed ? 'unterschrieben' : 'Entwurf'}`}
        </p>
      </div>

      {signed ? <ProtocolPdfLink recordId={recordId} /> : null}

      {signing && !signed ? (
        <SigningStep
          record={record}
          onBack={() => {
            setSigning(false)
          }}
        />
      ) : (
        <ProtocolSheet key={recordId} record={record}>
          {({ unsaved }) =>
            signed ? null : (
              <SignOffer
                record={record}
                unsaved={unsaved}
                onSign={() => {
                  setSigning(true)
                }}
              />
            )
          }
        </ProtocolSheet>
      )}
    </div>
  )
}
