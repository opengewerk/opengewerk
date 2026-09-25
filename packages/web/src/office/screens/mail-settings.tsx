import type { IsoDate } from '@opengewerk/domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button, Panel } from '../../components/index.js'
import { date, today } from '../../app/format.js'
import { useMay } from '../../app/queries.js'
import { mailStatus } from '../../session/mail.js'
import { type ParameterPeriod, parameterHistory, setParameter } from '../../session/parameters.js'
import { RequestRefused } from '../../sync/transport.js'
import { Saved, SettingsPage, SettingsState, SettingsText } from '../settings-frame.js'
import { MailServerSection } from './mail-server.js'
import { History, latestPeriod, proposedFrom } from './taxes.js'

/** The setting this screen switches: a signed report goes to its customer at once. */
const reportSetting = 'report.mail_on_signature'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/**
 * How this business sends mail, and what it decides about it.
 *
 * The mail server is the business's own and set up here, behind `mail.read`
 * and `mail.write`, which only the owner has: the login to a mailbox is a way
 * of writing in the business's name to anybody. Everybody else who reads the
 * settings learns whether the business sends mail and from where, and nothing
 * about the server.
 *
 * What the business decides beyond that is here as well: whether a report the
 * customer signs on site goes to that customer at once. Only the owner
 * switches it; the office sees it with nothing to press, like the letterhead.
 */
export function MailSettingsScreen() {
  const history = useQuery({ queryKey: ['parameters'], queryFn: parameterHistory })
  const mayWrite = useMay('settings.write')
  const readsServer = useMay('mail.read')
  const writesServer = useMay('mail.write')

  return (
    <SettingsPage
      active="e-mail"
      title="E-Mail-Einstellungen"
      sub="Wie dieser Betrieb E-Mails verschickt."
    >
      {readsServer ? <MailServerSection mayWrite={writesServer} /> : <MailStatusSection />}

      {history.isPending ? null : history.isError ? (
        <SettingsText muted>
          {saidWhy(history.error, 'Die Einstellungen kamen nicht an.')}
        </SettingsText>
      ) : (
        <ReportSection
          periods={history.data.filter((period) => period.key === reportSetting)}
          mayWrite={mayWrite}
        />
      )}
    </SettingsPage>
  )
}

/** Whether the business sends mail, for whoever may not see the server itself. */
function MailStatusSection() {
  const status = useQuery({ queryKey: ['mail-status'], queryFn: mailStatus })

  return (
    <Panel title="Mailserver" roomy>
      {status.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : status.isError ? (
        <SettingsText muted>
          {saidWhy(status.error, 'Die Angaben zum Versand kamen nicht an.')}
        </SettingsText>
      ) : status.data.configured ? (
        <SettingsText>
          Eingerichtet. Dieser Betrieb verschickt von {status.data.from}; als Absender steht der
          Name aus dem Briefkopf davor. Den Mailserver richtet der Inhaber hier ein.
        </SettingsText>
      ) : (
        <SettingsText>
          Nicht eingerichtet, dieser Betrieb verschickt deshalb keine E-Mails. Den Mailserver
          richtet der Inhaber hier ein.
        </SettingsText>
      )}
    </Panel>
  )
}

/**
 * Whether a signed report goes to its customer right away.
 *
 * Switched from today, never for a day in the past: the job reads the setting
 * on the day of the signature, and a start in the past would send the reports
 * signed since then, which nobody switching it on today expects. Switched
 * off, it is off from today as well; what was signed while it was on and has
 * not gone yet still goes.
 */
function ReportSection({
  periods,
  mayWrite,
}: {
  readonly periods: readonly ParameterPeriod[]
  readonly mayWrite: boolean
}) {
  const queries = useQueryClient()
  const [trouble, setTrouble] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const standing = latestPeriod(periods)
  const on = standing?.value === 1
  const from = proposedFrom(periods, today() as IsoDate)

  const change = useMutation({
    mutationFn: () => setParameter({ key: reportSetting, from, value: on ? 0 : 1, note: null }),
    onSuccess: () => {
      setTrouble(null)
      setSaved(true)
      void queries.invalidateQueries({ queryKey: ['parameters'] })
    },
    onError: (error) => {
      setSaved(false)
      setTrouble(saidWhy(error, 'Die Einstellung ließ sich nicht speichern.'))
    },
  })

  return (
    <Panel title="Regiebericht nach der Unterschrift" roomy>
      <div className="flex flex-col gap-[11px]">
        <SettingsText>
          Unterschreibt der Kunde einen Regiebericht auf der Baustelle, kann er ihn gleich danach
          per E-Mail bekommen, als PDF mit seiner Unterschrift. Die Nachricht geht an die Adresse,
          die beim Kunden hinterlegt ist; fehlt sie, lässt sich der Bericht vom Büro aus
          verschicken.
        </SettingsText>

        <SettingsState>
          {standing === null
            ? 'Aus: unterschriebene Regieberichte bleiben beim Büro.'
            : on
              ? `An seit dem ${date(standing.validFrom)}: ein unterschriebener Regiebericht geht ` +
                'gleich an den Kunden.'
              : `Aus seit dem ${date(standing.validFrom)}: unterschriebene Regieberichte bleiben ` +
                'beim Büro.'}
        </SettingsState>

        <History periods={periods} stated="an" notStated="aus" />

        {mayWrite ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={change.isPending}
              onClick={() => {
                change.mutate()
              }}
            >
              {change.isPending ? 'Einen Moment' : on ? 'Ausschalten' : 'Einschalten'}
            </Button>
            <SettingsText muted>Gilt ab dem {date(from)}.</SettingsText>
            {saved ? <Saved /> : null}
          </div>
        ) : null}

        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
      </div>
    </Panel>
  )
}
