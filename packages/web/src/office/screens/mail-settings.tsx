import type { IsoDate, TenantParameterKey } from '@opengewerk/domain'
import { Button, Panel } from '@opengewerk/platform-web'
import { date, today } from '@opengewerk/platform-web/format'
import {
  MailServerSection,
  MailStatusSection,
  Saved,
  SettingsPage,
  SettingsState,
  SettingsText,
} from '@opengewerk/platform-web/office'
import { RequestRefused } from '@opengewerk/platform-web/sync'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { useMay } from '../../app/queries.js'
import { type ParameterPeriod, parameterHistory, setParameter } from '../../session/parameters.js'
import { mailServerWords, mailStatusWords } from './mail-words.js'
import { History, latestPeriod, proposedFrom } from './taxes.js'

/**
 * The sentences of a switch for a mail to the customer: the setting, the name
 * of the panel, the sentence that explains it, and what the state says while
 * it is on and while it is off. A confirmation (#315) says where its text
 * comes from.
 */
interface SignedWords {
  readonly setting: TenantParameterKey
  readonly title: string
  readonly explanation: string
  readonly on: string
  readonly off: string
  readonly fromSnippets?: true
}

const reportWords: SignedWords = {
  setting: 'report.mail_on_signature',
  title: 'Regiebericht nach der Unterschrift',
  explanation:
    'Unterschreibt der Kunde einen Regiebericht auf der Baustelle, kann er ihn gleich danach ' +
    'per E-Mail bekommen, als PDF mit seiner Unterschrift. Die Nachricht geht an die Adresse, ' +
    'die beim Kunden hinterlegt ist; fehlt sie, lässt sich der Bericht vom Büro aus verschicken.',
  on: 'ein unterschriebener Regiebericht geht gleich an den Kunden.',
  off: 'unterschriebene Regieberichte bleiben beim Büro.',
}

/** The delivery note (#299): signed by whoever received the goods, sent to the customer. */
const deliveryWords: SignedWords = {
  setting: 'delivery_note.mail_on_signature',
  title: 'Lieferschein nach der Unterschrift',
  explanation:
    'Unterschreibt der Empfänger einen Lieferschein auf der Baustelle, kann der Kunde ihn gleich ' +
    'danach per E-Mail bekommen, als PDF mit der Unterschrift. Die Nachricht geht an die ' +
    'Adresse, die beim Kunden hinterlegt ist; fehlt sie, lässt sich der Lieferschein vom Büro ' +
    'aus verschicken.',
  on: 'ein unterschriebener Lieferschein geht gleich an den Kunden.',
  off: 'unterschriebene Lieferscheine bleiben beim Büro.',
}

/** The confirmation of an appointment (#315), with its calendar file. */
const appointmentWords: SignedWords = {
  setting: 'appointment.mail_to_customer',
  title: 'Bestätigung zum Termin',
  explanation:
    'Wird ein Termin an einem Auftrag vereinbart, verschoben oder abgesagt, bekommt der Kunde ' +
    'eine E-Mail mit Tag und Uhrzeit, dazu eine Kalenderdatei, die sein Kalender übernimmt. Die ' +
    'Nachricht geht an die Adresse, die beim Kunden hinterlegt ist; ohne Adresse geht keine.',
  on: 'Kunden bekommen zu jedem Termin eine Bestätigung.',
  off: 'Termine werden nicht per E-Mail bestätigt.',
  fromSnippets: true,
}

/** The confirmation of a service call (#315), with the instructions for a consumer. */
const receivedWords: SignedWords = {
  setting: 'service_call.mail_on_receipt',
  title: 'Bestätigung zum Auftragseingang',
  explanation:
    'Legt das Büro einen Serviceauftrag an, bekommt der Kunde eine E-Mail mit Nummer und ' +
    'Anliegen. Ist er Verbraucher, hängen die Belehrungen als PDF an, die er sonst getrennt ' +
    'bekäme. Einen anderen Auftrag bestätigt die Auftragsbestätigung als Beleg.',
  on: 'Serviceaufträge werden per E-Mail bestätigt.',
  off: 'Serviceaufträge werden nicht per E-Mail bestätigt.',
  fromSnippets: true,
}

/** The reminders of a due inspection or maintenance (#316), where the customer may be reminded. */
const reminderWords: SignedWords = {
  setting: 'customer_reminder.mail',
  title: 'Erinnerung an Prüfungen und Wartungen',
  explanation:
    'Rückt eine Wiederholungsprüfung, eine Prüfung von Geräten oder eine Wartung näher, bekommt ' +
    'der Kunde eine E-Mail mit der Bitte um einen Termin, so früh, wie die Frist unter „Fristen“ ' +
    'vorläuft. Ohne Adresse entsteht eine Aufgabe, ihn anzurufen. Ohne Wartungsvertrag geht eine ' +
    'Erinnerung nur mit einer Einwilligung oder an einen Bestandskunden nach § 7 Abs. 3 UWG ' +
    'hinaus, wie es beim Kunden steht.',
  on: 'Kunden werden an fällige Prüfungen und Wartungen erinnert.',
  off: 'Kunden werden nicht an Prüfungen und Wartungen erinnert.',
  fromSnippets: true,
}

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
 * customer signs on site goes to that customer at once, and the same for a
 * delivery note its recipient signs. Only the owner switches them; the office
 * sees them with nothing to press, like the letterhead.
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
      {readsServer ? (
        <MailServerSection mayWrite={writesServer} words={mailServerWords} />
      ) : (
        <MailStatusSection words={mailStatusWords} />
      )}

      {history.isPending ? null : history.isError ? (
        <SettingsText muted>
          {saidWhy(history.error, 'Die Einstellungen kamen nicht an.')}
        </SettingsText>
      ) : (
        [reportWords, deliveryWords, appointmentWords, receivedWords, reminderWords].map(
          (words) => (
            <SignedSection
              key={words.setting}
              words={words}
              periods={history.data.filter((period) => period.key === words.setting)}
              mayWrite={mayWrite}
            />
          ),
        )
      )}
    </SettingsPage>
  )
}

/**
 * Whether a signed report, or a signed delivery note, goes to its customer
 * right away.
 *
 * Switched from today, never for a day in the past: the job reads the setting
 * on the day of the signature, and a start in the past would send the papers
 * signed since then, which nobody switching it on today expects. Switched
 * off, it is off from today as well; what was signed while it was on and has
 * not gone yet still goes.
 */
function SignedSection({
  words,
  periods,
  mayWrite,
}: {
  readonly words: SignedWords
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
    mutationFn: () => setParameter({ key: words.setting, from, value: on ? 0 : 1, note: null }),
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
    <Panel title={words.title} roomy>
      <div className="flex flex-col gap-[11px]">
        <SettingsText>{words.explanation}</SettingsText>

        <SettingsState>
          {standing === null
            ? `Aus: ${words.off}`
            : on
              ? `An seit dem ${date(standing.validFrom)}: ${words.on}`
              : `Aus seit dem ${date(standing.validFrom)}: ${words.off}`}
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

        {words.fromSnippets ? (
          <SettingsText muted>
            Der Text kommt aus den Textbausteinen für E-Mails; ohne eigenen gilt der mitgelieferte.{' '}
            <Link
              to="/textbausteine"
              className="font-semibold text-copper-text underline underline-offset-2"
            >
              Textbausteine
            </Link>
          </SettingsText>
        ) : null}
      </div>
    </Panel>
  )
}
