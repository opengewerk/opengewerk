import {
  backupTimeProblem,
  type InstanceSettingsView,
  mailHostProblem,
} from '@opengewerk/platform-domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { useApplication, useInstanceSentences } from '../application.js'
import { Button } from '../components/button.js'
import { Field, TextArea } from '../components/field.js'
import { Panel } from '../components/panel.js'
import { date } from '../format.js'
import { Saved, SettingsText } from '../office/settings.js'
import { instanceSettings, saveInstanceSettings } from '../session/instance.js'
import { RequestRefused } from '../sync/transport.js'
import { InstancePage } from './frame.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/** One server per line, blank lines and spaces around them left out. */
function hostsOf(text: string): readonly string[] {
  return [
    ...new Set(
      text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== ''),
    ),
  ]
}

/**
 * What holds for every tenant on the instance (#188), `instanz_einstellungen()`
 * of the canvas: the mail servers in the own network a tenant may send
 * through, and the hour of the nightly backup. Both were a line in the `.env`
 * or fixed in a script before, and both belong to the instance and to no
 * tenant on it; in the settings of one, whoever leads it would decide for all.
 */
export function InstanceSettingsScreen() {
  const sentences = useInstanceSentences().settings
  const settings = useQuery({ queryKey: ['instance-settings'], queryFn: instanceSettings })

  return (
    <InstancePage title="Einstellungen" sub={sentences.what}>
      {settings.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : settings.isError ? (
        <SettingsText muted>
          {saidWhy(settings.error, 'Die Einstellungen kamen nicht an.')}
        </SettingsText>
      ) : (
        <>
          <MailHosts settings={settings.data} />
          <BackupTime settings={settings.data} />
        </>
      )}
    </InstancePage>
  )
}

function useSave() {
  const queries = useQueryClient()

  return useMutation({
    mutationFn: saveInstanceSettings,
    onSuccess: (saved) => {
      queries.setQueryData(['instance-settings'], saved)
    },
  })
}

/**
 * The mail servers in the own network. That such a server is refused unless
 * it stands here is the foundation's rule and its sentence, with the name of
 * the application in it; how a tenant sends its mail, and what the rule keeps
 * it from, are said in the application's word for a tenant.
 */
function MailHosts({ settings }: { readonly settings: InstanceSettingsView }) {
  const { name } = useApplication()
  const sentences = useInstanceSentences().settings
  const save = useSave()
  const [text, setText] = useState(settings.mailInternalHosts.join('\n'))
  const [saved, setSaved] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const hosts = hostsOf(text)
  const problem = hosts.map(mailHostProblem).find((found) => found !== null) ?? undefined
  const changed = hosts.join('\n') !== settings.mailInternalHosts.join('\n')

  function submit(event: FormEvent) {
    event.preventDefault()
    setSaved(false)
    setTrouble(null)

    if (problem) {
      return
    }

    save.mutate(
      { mailInternalHosts: hosts },
      {
        onSuccess: (answer) => {
          setText(answer.mailInternalHosts.join('\n'))
          setSaved(true)
        },
        onError: (error) => {
          setTrouble(saidWhy(error, 'Die Mailserver ließen sich nicht speichern.'))
        },
      },
    )
  }

  return (
    <Panel title="Mailserver im eigenen Netz" roomy>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3">
        <SettingsText muted>
          {`${sentences.mailOwnServer} Liegt der nicht im Internet, sondern im Netz dieser Instanz, lehnt ${name} ihn ab, außer er steht hier. ${sentences.mailNoWayIn}`}
        </SettingsText>
        <TextArea
          label="Freigegebene Mailserver"
          rows={4}
          value={text}
          spellCheck={false}
          hint={
            settings.takenOverAt
              ? `Einer je Zeile, als Name oder Adresse, ohne Port. Übernommen aus MAIL_INTERNAL_HOSTS in der .env am ${date(settings.takenOverAt)}; seitdem gilt, was hier steht.`
              : 'Einer je Zeile, als Name oder Adresse, ohne Port.'
          }
          {...(problem ? { problem } : {})}
          onChange={(event) => {
            setSaved(false)
            setText(event.target.value)
          }}
        />
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {saved ? <Saved /> : null}
          <div className="grow" />
          <Button
            tone="primary"
            type="submit"
            icon={Check}
            disabled={!changed || problem !== undefined || save.isPending}
          >
            Speichern
          </Button>
        </div>
      </form>
    </Panel>
  )
}

function BackupTime({ settings }: { readonly settings: InstanceSettingsView }) {
  const save = useSave()
  const [time, setTime] = useState(settings.backupTime)
  const [saved, setSaved] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const problem = backupTimeProblem(time) ?? undefined
  const changed = time !== settings.backupTime

  function submit(event: FormEvent) {
    event.preventDefault()
    setSaved(false)
    setTrouble(null)

    if (problem) {
      return
    }

    save.mutate(
      { backupTime: time },
      {
        onSuccess: (answer) => {
          setTime(answer.backupTime)
          setSaved(true)
        },
        onError: (error) => {
          setTrouble(saidWhy(error, 'Die Uhrzeit ließ sich nicht speichern.'))
        },
      },
    )
  }

  return (
    <Panel title="Nächtliche Sicherung" roomy>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3">
        <SettingsText muted>
          Die Instanz sichert jeden Tag die Datenbank und den Dateispeicher, und vierzehn
          Generationen bleiben. War der Rechner zur Uhrzeit aus, holt sie die Sicherung nach, sobald
          er wieder läuft.
        </SettingsText>
        <div className="max-w-[140px] max-sm:max-w-none">
          <Field
            label="Uhrzeit"
            type="time"
            value={time}
            {...(problem ? { problem } : {})}
            onChange={(event) => {
              setSaved(false)
              setTime(event.target.value)
            }}
          />
        </div>
        <SettingsText small muted>
          Nach deutscher Zeit, Europe/Berlin. Eine Änderung gilt ab dem nächsten Termin.
        </SettingsText>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {saved ? <Saved /> : null}
          <div className="grow" />
          <Button
            tone="primary"
            type="submit"
            icon={Check}
            disabled={!changed || problem !== undefined || save.isPending}
          >
            Speichern
          </Button>
        </div>
      </form>
    </Panel>
  )
}
