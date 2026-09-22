import type { IsoDate } from '@opengewerk/domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '../../components/index.js'
import { date, today } from '../../app/format.js'
import { useMay } from '../../app/queries.js'
import { mailStatus } from '../../session/mail.js'
import { type ParameterPeriod, parameterHistory, setParameter } from '../../session/parameters.js'
import { RequestRefused } from '../../sync/transport.js'
import { Nothing, Page, Section } from '../layout.js'
import { History, latestPeriod, proposedFrom } from './taxes.js'

/** The setting this screen switches: a signed report goes to its customer at once. */
const reportSetting = 'report.mail_on_signature'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/**
 * How this instance sends mail, and what a business decides about it.
 *
 * The mail server itself is set up in the .env by whoever runs the instance,
 * and the screen only says whether there is one and from which address. What
 * the business decides is here: whether a report the customer signs on site
 * goes to that customer at once. Only the owner switches it; the office sees
 * the same screen with nothing to press, like the letterhead.
 */
export function MailSettingsScreen() {
  const status = useQuery({ queryKey: ['mail-status'], queryFn: mailStatus })
  const history = useQuery({ queryKey: ['parameters'], queryFn: parameterHistory })
  const mayWrite = useMay('settings.write')

  return (
    <Page title="E-Mail" meta="Wie OpenGewerk E-Mails verschickt.">
      <Section title="Mailserver">
        {status.isPending ? (
          <Nothing>Wird geladen.</Nothing>
        ) : status.isError ? (
          <Nothing>{saidWhy(status.error, 'Die Angaben zum Versand kamen nicht an.')}</Nothing>
        ) : status.data.configured ? (
          <p className="text-body text-ink">
            Eingerichtet. OpenGewerk verschickt von {status.data.from}; als Absender steht der Name
            aus dem Briefkopf davor, und Antworten gehen an die E-Mail-Adresse aus dem Briefkopf.
          </p>
        ) : (
          <p className="text-body text-ink">
            Nicht eingerichtet, OpenGewerk verschickt deshalb keine E-Mails. Eingerichtet wird der
            Mailserver von dem, der die Instanz betreibt, in der .env mit SMTP_HOST und MAIL_FROM.
          </p>
        )}
      </Section>

      {history.isPending ? null : history.isError ? (
        <Nothing>{saidWhy(history.error, 'Die Einstellungen kamen nicht an.')}</Nothing>
      ) : (
        <ReportSection
          periods={history.data.filter((period) => period.key === reportSetting)}
          mayWrite={mayWrite}
        />
      )}
    </Page>
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
    <Section title="Regiebericht nach der Unterschrift">
      <div className="flex flex-col gap-3">
        <p className="text-body text-ink">
          Unterschreibt der Kunde einen Regiebericht auf der Baustelle, kann er ihn gleich danach
          per E-Mail bekommen, als PDF mit seiner Unterschrift. Die Nachricht geht an die Adresse,
          die beim Kunden hinterlegt ist; fehlt sie, lässt sich der Bericht vom Büro aus
          verschicken.
        </p>

        <p className="text-body font-semibold">
          {standing === null
            ? 'Aus: unterschriebene Regieberichte bleiben beim Büro.'
            : on
              ? `An seit dem ${date(standing.validFrom)}: ein unterschriebener Regiebericht geht ` +
                'gleich an den Kunden.'
              : `Aus seit dem ${date(standing.validFrom)}: unterschriebene Regieberichte bleiben ` +
                'beim Büro.'}
        </p>

        <History periods={periods} stated="an" notStated="aus" />

        {mayWrite ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              tone={on ? 'secondary' : 'primary'}
              disabled={change.isPending}
              onClick={() => {
                change.mutate()
              }}
            >
              {change.isPending ? 'Einen Moment' : on ? 'Ausschalten' : 'Einschalten'}
            </Button>
            <p className="text-body text-ink-muted">Gilt ab dem {date(from)}.</p>
          </div>
        ) : null}

        {saved ? (
          <p role="status" className="text-body text-ink-muted">
            Gespeichert.
          </p>
        ) : null}
        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
      </div>
    </Section>
  )
}
