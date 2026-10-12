import {
  defaultSmtpPorts,
  type InstanceMailServerView,
  smtpSecurities,
  type SmtpSecurity,
} from '@opengewerk/platform-domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, RefreshCw, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { useApplication, useInstanceSentences } from '../application.js'
import { Button } from '../components/button.js'
import { Confirm } from '../components/confirm.js'
import { Field, SelectField } from '../components/field.js'
import { Panel } from '../components/panel.js'
import { date } from '../format.js'
import { SettingsText } from '../office/settings.js'
import {
  checkInstanceMailServer,
  type InstanceMailServerCheck,
  type InstanceMailServerInput,
  instanceMailServer,
  removeInstanceMailServer,
  saveInstanceMailServer,
} from '../session/instance.js'
import { RequestRefused } from '../sync/transport.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

const securityLabels: Readonly<Record<SmtpSecurity, string>> = {
  starttls: 'STARTTLS, Port 587 (üblich)',
  tls: 'TLS, Port 465',
  none: 'Keine, nur für einen Mailserver im eigenen Netz',
}

/** A sentence under the form, about what just happened. */
interface Said {
  readonly tone: 'status' | 'alert'
  readonly text: string
}

/** What a server that answered took. A login is named only where there was one. */
function saidOfCheck(check: InstanceMailServerCheck, withLogin: boolean): Said {
  if (check.outcome !== 'ready') {
    return { tone: 'alert', text: check.reason }
  }

  return {
    tone: 'status',
    text: withLogin
      ? 'Der Mailserver hat geantwortet und die Anmeldung angenommen.'
      : 'Der Mailserver hat geantwortet, die Verbindung funktioniert.',
  }
}

/**
 * What saving did. Saved with a server that did not answer is the connection
 * that was already kept, and it says so.
 */
function saidOfSaving(saved: {
  readonly server: InstanceMailServerView
  readonly check: InstanceMailServerCheck
}): Said {
  return saved.check.outcome === 'ready'
    ? {
        tone: 'status',
        text:
          saved.server.username === null
            ? 'Gespeichert. Die Verbindung zum Mailserver funktioniert.'
            : 'Gespeichert. Die Verbindung zum Mailserver funktioniert, die Anmeldung wurde ' +
              'angenommen.',
      }
    : {
        tone: 'alert',
        text: `Gespeichert, aber der Mailserver lässt sich gerade nicht erreichen: ${saved.check.reason}`,
      }
}

/**
 * The mail server of the instance (opengewerk-haustechnik#81),
 * `instance_mail()` of the canvas: what goes to an account, the link to a new
 * password and the notice of a new passkey, goes out through it and through
 * the mail server of no tenant, because an account belongs to the instance.
 * Why that is so, and what is missing without it, the application says in its
 * word for a tenant.
 */
export function InstanceMailServer() {
  const sentences = useInstanceSentences().settings
  const state = useQuery({ queryKey: ['instance-mail-server'], queryFn: instanceMailServer })
  const [said, setSaid] = useState<Said | null>(null)

  return (
    <Panel title="Mailserver der Instanz" roomy>
      <div className="flex flex-col gap-3">
        <SettingsText muted>{sentences.accountMail}</SettingsText>
        {state.isPending ? (
          <SettingsText muted>Wird geladen.</SettingsText>
        ) : state.isError ? (
          <SettingsText muted>
            {saidWhy(state.error, 'Der Mailserver der Instanz kam nicht an.')}
          </SettingsText>
        ) : !state.data.sends ? (
          <SettingsText muted>
            Diese Instanz verschickt keine E-Mails, sie ist geschlossen oder ohne Versand gestartet.
            Ein Mailserver lässt sich hier erst eintragen, wenn sie E-Mails verschickt.
          </SettingsText>
        ) : (
          <>
            {state.data.server === null ? (
              <div
                role="note"
                className="flex items-start gap-2 rounded-[5px] border border-line bg-sunken px-3 py-2.5 text-[13px] leading-[1.45]"
              >
                <TriangleAlert
                  size={16}
                  strokeWidth={2.2}
                  aria-hidden="true"
                  className="mt-px shrink-0 text-ink-muted"
                />
                <span>{sentences.accountMailMissing}</span>
              </div>
            ) : null}
            <MailServerForm
              // A form reads once what it begins with: a server saved or removed is another form.
              key={
                state.data.server
                  ? `${state.data.server.host}:${String(state.data.server.passwordSetAt)}`
                  : 'none'
              }
              stored={state.data.server}
              onSaid={setSaid}
            />
            {said ? (
              <p
                role={said.tone}
                className={
                  said.tone === 'alert'
                    ? 'text-[13px] font-semibold text-conflict'
                    : 'flex items-center gap-2 text-[13px] text-done'
                }
              >
                {said.tone === 'status' ? (
                  <Check size={15} strokeWidth={2.4} aria-hidden="true" className="shrink-0" />
                ) : null}
                {said.text}
              </p>
            ) : null}
          </>
        )}
      </div>
    </Panel>
  )
}

function MailServerForm({
  stored,
  onSaid,
}: {
  readonly stored: InstanceMailServerView | null
  readonly onSaid: (said: Said | null) => void
}) {
  const { name } = useApplication()
  const queries = useQueryClient()
  const [host, setHost] = useState(stored?.host ?? '')
  const [security, setSecurity] = useState<SmtpSecurity>(stored?.security ?? 'starttls')
  const [port, setPort] = useState(
    stored && stored.port !== defaultSmtpPorts[stored.security] ? String(stored.port) : '',
  )
  const [username, setUsername] = useState(stored?.username ?? '')
  const [password, setPassword] = useState('')
  const [fromAddress, setFromAddress] = useState(stored?.fromAddress ?? '')
  const [asking, setAsking] = useState(false)

  function input(): InstanceMailServerInput {
    return {
      host,
      port: port.trim() === '' ? null : Number(port),
      security,
      username: username.trim() === '' ? null : username,
      // Sent only when typed: an empty field keeps the password there is.
      ...(password === '' ? {} : { password }),
      fromAddress,
    }
  }

  function refresh() {
    void queries.invalidateQueries({ queryKey: ['instance-mail-server'] })
  }

  const save = useMutation({
    mutationFn: () => saveInstanceMailServer(input()),
    onSuccess: (saved) => {
      onSaid(saidOfSaving(saved))
      setPassword('')
      refresh()
    },
    onError: (error) => {
      onSaid({ tone: 'alert', text: saidWhy(error, 'Die Angaben ließen sich nicht speichern.') })
    },
  })
  const check = useMutation({
    mutationFn: () => checkInstanceMailServer(input()),
    onSuccess: (result) => {
      onSaid(saidOfCheck(result, username.trim() !== ''))
    },
    onError: (error) => {
      onSaid({ tone: 'alert', text: saidWhy(error, 'Die Prüfung kam nicht zustande.') })
    },
  })
  const remove = useMutation({
    mutationFn: removeInstanceMailServer,
    onSuccess: () => {
      setAsking(false)
      onSaid({ tone: 'status', text: 'Der Mailserver ist entfernt, samt Anmeldung.' })
      refresh()
    },
    onError: (error) => {
      setAsking(false)
      onSaid({ tone: 'alert', text: saidWhy(error, 'Der Mailserver ließ sich nicht entfernen.') })
    },
  })
  const working = save.isPending || check.isPending || remove.isPending

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        onSaid(null)
        save.mutate()
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.3fr)_minmax(0,0.8fr)]">
        <div className="min-w-0 sm:col-span-2 lg:col-span-1">
          <Field
            label="Server"
            name="host"
            autoComplete="off"
            value={host}
            onChange={(event) => {
              setHost(event.target.value)
            }}
          />
        </div>
        <SelectField
          label="Verschlüsselung"
          value={security}
          options={smtpSecurities.map((value) => ({ value, label: securityLabels[value] }))}
          onChange={(value) => {
            // A port that was only the one that went with the old choice
            // follows the new one, instead of staying 587 under TLS.
            if (port === String(defaultSmtpPorts[security])) {
              setPort('')
            }

            setSecurity(value as SmtpSecurity)
          }}
        />
        <Field
          label="Port"
          name="port"
          inputMode="numeric"
          numeric
          value={port}
          placeholder={String(defaultSmtpPorts[security])}
          onChange={(event) => {
            setPort(event.target.value)
          }}
          hint="Leer für den Port der Verschlüsselung."
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Benutzername"
          name="username"
          autoComplete="off"
          value={username}
          onChange={(event) => {
            setUsername(event.target.value)
          }}
        />
        <Field
          label="Passwort"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
          }}
          {...(stored?.password === 'unreadable'
            ? {
                problem:
                  'Das gespeicherte Passwort lässt sich nicht mehr lesen. Es muss neu eingegeben werden.',
              }
            : stored?.password === 'set' && stored.passwordSetAt
              ? {
                  hint: `Gespeichert am ${date(stored.passwordSetAt)}. Leer lassen, um es zu behalten.`,
                }
              : {})}
        />
        <Field
          label="Absenderadresse"
          name="fromAddress"
          type="email"
          autoComplete="off"
          value={fromAddress}
          onChange={(event) => {
            setFromAddress(event.target.value)
          }}
          hint={`Davor steht der Name der Anwendung, ${name}.`}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" tone="primary" icon={Check} disabled={working}>
          {save.isPending ? 'Wird geprüft' : 'Speichern'}
        </Button>
        <Button
          type="button"
          icon={RefreshCw}
          disabled={working}
          onClick={() => {
            onSaid(null)
            check.mutate()
          }}
        >
          {check.isPending ? 'Wird geprüft' : 'Verbindung prüfen'}
        </Button>
        {stored ? (
          <Button
            type="button"
            tone="danger"
            disabled={working}
            onClick={() => {
              onSaid(null)
              setAsking(true)
            }}
          >
            Mailserver entfernen
          </Button>
        ) : null}
        <Confirm
          open={asking}
          title="Mailserver entfernen?"
          confirm="Entfernen"
          busy={remove.isPending}
          onConfirm={() => {
            remove.mutate()
          }}
          onCancel={() => {
            setAsking(false)
          }}
        >
          Die Anmeldung beim Mailserver wird gelöscht. Danach geht keine E-Mail mehr an ein Konto,
          auch kein Link zu einem neuen Passwort, bis wieder ein Mailserver eingetragen ist.
        </Confirm>
      </div>
    </form>
  )
}
