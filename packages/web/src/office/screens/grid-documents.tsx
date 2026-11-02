import { type RecordState, reportsToGridOperator } from '@opengewerk/domain'
import { Panel } from '@opengewerk/platform-web'
import type { FormField } from '@opengewerk/platform-web/sync'
import { maybeText, useSyncStatus } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronRight, Eye } from 'lucide-react'
import { useMemo } from 'react'

import { useMay } from '../../app/queries.js'
import {
  gridApplicationAddress,
  gridCompletionAddress,
  gridOperators,
  installationGridOperator,
  marketRegisterAddress,
} from '../../session/grid-operators.js'

const link =
  'inline-flex h-control min-h-tap items-center justify-center gap-[7px] rounded-control border border-control bg-surface px-[14px] text-body text-ink no-underline lg:whitespace-nowrap'

/** The grid operator of an installation, by the right to the installation (#306). */
export function useInstallationGridOperator(installationId: string, enabled = true) {
  const { online } = useSyncStatus()

  return useQuery({
    queryKey: ['installation-grid-operator', installationId],
    queryFn: () => installationGridOperator(installationId),
    enabled: online && enabled,
  })
}

/** The name of the grid operator for the facts of an installation, a link for whoever may read the list. */
export function GridOperatorFact({ installationId }: { readonly installationId: string }) {
  const readsList = useMay('grid_operator.read')
  const known = useInstallationGridOperator(installationId)
  const operator = known.data?.operator

  if (!operator) {
    return null
  }

  return readsList ? (
    <Link
      to={`/netzbetreiber/${operator.id}`}
      className="text-copper-text underline underline-offset-2"
    >
      {operator.name}
    </Link>
  ) : (
    <>{operator.name}</>
  )
}

function PaperLink({ href, children }: { readonly href: string; readonly children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={link}>
      <Eye size={15} strokeWidth={2.3} aria-hidden="true" />
      {children}
    </a>
  )
}

/**
 * The card "Netzbetreiber und Marktstammdatenregister" of a PV system, and of
 * a battery or wallbox that belongs to none (#306), as the board "PV-Anlage"
 * draws it: the grid operator with the number it knows the installation by
 * and its portal, the application and the completion, and the help for the
 * register, which a wallbox does not need. The server prints them, so they
 * need a connection like the other papers.
 */
export function GridSection({
  installationId,
  kind,
}: {
  readonly installationId: string
  readonly kind: string
}) {
  const { online } = useSyncStatus()
  const readsList = useMay('grid_operator.read')
  const known = useInstallationGridOperator(installationId)
  const operator = known.data?.operator ?? null
  const reference = known.data?.reference ?? null
  const registers = kind !== 'wallbox'

  return (
    <Panel title="Netzbetreiber und Marktstammdatenregister">
      <div className="flex flex-col gap-2.5">
        {!online ? (
          <p className="text-[13px] leading-[1.4] text-ink-muted">
            Die Unterlagen druckt der Server, dafür braucht es Verbindung.
          </p>
        ) : known.data ? (
          <>
            {operator ? (
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-body">
                {readsList ? (
                  <Link
                    to={`/netzbetreiber/${operator.id}`}
                    className="text-copper-text underline underline-offset-2"
                  >
                    {operator.name}
                  </Link>
                ) : (
                  <span>{operator.name}</span>
                )}
                {reference ? <span className="text-ink-faint">Kennung {reference}</span> : null}
                {operator.portalUrl ? (
                  <a
                    href={operator.portalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-[5px] text-copper-text underline underline-offset-2"
                  >
                    Portal öffnen
                    <ChevronRight size={13} strokeWidth={2.2} aria-hidden="true" />
                  </a>
                ) : null}
              </div>
            ) : (
              <p className="text-[13px] leading-[1.4] text-ink-muted">
                Noch kein Netzbetreiber. Unter „Bearbeiten“ wählen, dann entstehen Anmeldung und
                Fertigmeldung vorausgefüllt.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {operator ? (
                <>
                  <PaperLink href={gridApplicationAddress(installationId)}>Anmeldung</PaperLink>
                  <PaperLink href={gridCompletionAddress(installationId)}>Fertigmeldung</PaperLink>
                </>
              ) : null}
              {registers ? (
                <PaperLink href={marketRegisterAddress(installationId)}>
                  Ausfüllhilfe Marktstammdatenregister
                </PaperLink>
              ) : null}
            </div>
            <p className="text-[13px] leading-[1.4] text-ink-muted">
              {registers
                ? 'Anmeldung und Fertigmeldung sind vorausgefüllt aus Kunde, Objekt und PV-Struktur, mit der Eintragung des Betriebs im Installateurverzeichnis. Ins Marktstammdatenregister trägt der Betreiber die Anlage selbst ein, innerhalb eines Monats nach der Inbetriebnahme.'
                : 'Anmeldung und Fertigmeldung sind vorausgefüllt aus Kunde, Objekt und Anlage, mit der Eintragung des Betriebs im Installateurverzeichnis. Eine Wallbox ist dem Netzbetreiber vor der Inbetriebnahme mitzuteilen.'}
            </p>
          </>
        ) : null}
      </div>
    </Panel>
  )
}

/**
 * The two fields of the grid operator in the form of an installation (#306):
 * the grid operator out of the list and the number it knows the installation
 * by, for a PV system and for a battery or wallbox that belongs to none. The
 * grid operator the installation names stays a choice while the list is on
 * its way or out of reach, so that saving the form does not take it out.
 */
export function useGridOperatorFields(installation: RecordState | null): readonly FormField[] {
  const { online } = useSyncStatus()
  const readsList = useMay('grid_operator.read')
  const list = useQuery({
    queryKey: ['grid-operators'],
    queryFn: gridOperators,
    enabled: online && readsList,
  })
  const currentId = installation ? maybeText(installation, 'gridOperatorId') : null
  const current = useInstallationGridOperator(
    installation ? String(installation['id']) : '',
    installation !== null && currentId !== null,
  )

  return useMemo(() => {
    const listed = (list.data ?? []).map((entry) => ({ value: entry.id, label: entry.name }))
    const kept =
      currentId !== null && !listed.some((option) => option.value === currentId)
        ? [{ value: currentId, label: current.data?.operator?.name ?? 'Netzbetreiber wie bisher' }]
        : []
    const shown = (values: Readonly<Record<string, string>>) =>
      reportsToGridOperator(values['kind'], values['pvSystemId'] ? values['pvSystemId'] : null)

    return [
      {
        name: 'gridOperatorId',
        label: 'Netzbetreiber',
        options: [{ value: '', label: 'Keiner' }, ...kept, ...listed],
        hint: 'Aus den Netzbetreibern unter Stammdaten.',
        shownWhen: shown,
      },
      {
        name: 'gridOperatorReference',
        label: 'Kennung beim Netzbetreiber',
        hint: 'Die Vorgangs- oder Anlagennummer, unter der er sie führt.',
        shownWhen: shown,
      },
    ]
  }, [list.data, currentId, current.data])
}

/**
 * The grid operator as it is saved: only where the installation is reported
 * to one, so that a kind changed or a PV system chosen takes it out, as the
 * check in the database asks.
 */
export function asGridOperatorLink(values: Readonly<Record<string, string>>) {
  const shown = reportsToGridOperator(
    values['kind'],
    values['pvSystemId'] ? values['pvSystemId'] : null,
  )
  const id = values['gridOperatorId']?.trim() ?? ''
  const reference = values['gridOperatorReference']?.trim() ?? ''

  return {
    gridOperatorId: shown && id !== '' ? id : null,
    gridOperatorReference: shown && reference !== '' ? reference : null,
  }
}
