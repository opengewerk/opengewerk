import { defaultSmtpPorts, smtpSecurities, type SmtpSecurity } from '@opengewerk/platform-domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, RefreshCw } from 'lucide-react'
import { type ComponentType, useState } from 'react'

import { Button } from '../components/button.js'
import { Confirm } from '../components/confirm.js'
import { Field, SelectField, TextArea } from '../components/field.js'
import { Panel } from '../components/panel.js'
import { moment } from '../format.js'
import {
  checkMailServer,
  type MailServer,
  type MailServerCheck,
  type MailServerInput,
  mailServer,
  mailStatus,
  removeMailServer,
  type SavedMailServer,
  saveMailServer,
} from '../session/mail.js'
import { RequestRefused } from '../sync/transport.js'
import { Saved, SettingsText } from './settings.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

const securityLabels: Readonly<Record<SmtpSecurity, string>> = {
  starttls: 'STARTTLS, Port 587 (üblich)',
  tls: 'TLS, Port 465',
  none: 'Keine, nur für einen Mailserver im eigenen Netz',
}

/**
 * What only an application can say about the mail server of a tenant
 * (ADR 0010): what it sends through it, where the name of the sender comes
 * from, and what a signature may hold.
 */
export interface MailServerWords {
  /** What goes out through this mail server: the first sentence of the card. */
  readonly what: string
  /** Under the address messages go out from: where the name in front of it comes from. */
  readonly senderName: string
  readonly signature: {
    readonly placeholder: string
    readonly hint: string
    /** What is wrong with a signature as typed, a placeholder nobody knows for one. */
    readonly problem: (template: string) => string | undefined
    /**
     * How the signature reads under a message, one case each, drawn with
     * `SignaturePreviews`. A component, because what a signature prints an
     * application reads from its own settings.
     */
    readonly Previews: ComponentType<{ readonly template: string | null }>
  }
}

/** What an application says to whoever may not see the mail server itself. */
export interface MailStatusWords {
  /** The tenant sends mail, from this address. */
  readonly set: (from: string) => string
  /** The tenant has no mail server and sends none. */
  readonly missing: string
}

/** A sentence under the form, about what just happened. */
interface Said {
  readonly tone: 'status' | 'alert'
  readonly text: string
}

/**
 * What a server that answered took. A login is named only where there was one:
 * a relay without a login took the connection and nothing else.
 */
function saidOfCheck(check: MailServerCheck, withLogin: boolean): Said {
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
 * What saving did. Saved with a server that took the settings is the good
 * case; saved with one that did not is the connection that was already kept,
 * saved for its signature while the server is down, and it says so.
 */
function saidOfSaving(saved: SavedMailServer): Said {
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

/** Whether the tenant sends mail, for whoever may not see the server itself. */
export function MailStatusSection({ words }: { readonly words: MailStatusWords }) {
  const status = useQuery({ queryKey: ['mail-status'], queryFn: mailStatus })

  return (
    <Panel title="Mailserver" roomy>
      {status.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : status.isError ? (
        <SettingsText muted>
          {saidWhy(status.error, 'Die Angaben zum Versand kamen nicht an.')}
        </SettingsText>
      ) : status.data.configured && status.data.from !== null ? (
        <SettingsText>{words.set(status.data.from)}</SettingsText>
      ) : (
        <SettingsText>{words.missing}</SettingsText>
      )}
    </Panel>
  )
}

/**
 * The mail server of the tenant, for whoever may read it, which an
 * application gives to few: the login to a mailbox is a way of writing in the
 * tenant's name to anybody. The form is remounted after every save, so that
 * it shows what the server now keeps; what happened stays above it, here.
 */
export function MailServerSection({
  mayWrite,
  words,
}: {
  readonly mayWrite: boolean
  readonly words: MailServerWords
}) {
  const stored = useQuery({ queryKey: ['mail-server'], queryFn: mailServer })
  const [said, setSaid] = useState<Said | null>(null)

  return (
    <Panel title="Mailserver" roomy>
      <div className="flex flex-col gap-3">
        <SettingsText>
          {`${words.what} Die Angaben stehen beim E-Mail-Anbieter, meist unter „SMTP“ oder „Postausgangsserver“.`}
        </SettingsText>

        {stored.isPending ? (
          <SettingsText muted>Wird geladen.</SettingsText>
        ) : stored.isError ? (
          <SettingsText muted>
            {saidWhy(stored.error, 'Die Angaben zum Mailserver kamen nicht an.')}
          </SettingsText>
        ) : (
          <MailServerForm
            key={stored.data?.updatedAt ?? 'neu'}
            stored={stored.data}
            mayWrite={mayWrite}
            words={words}
            onSaid={setSaid}
          />
        )}

        {said?.tone === 'status' ? <Saved>{said.text}</Saved> : null}
        {said?.tone === 'alert' ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {said.text}
          </p>
        ) : null}
      </div>
    </Panel>
  )
}

function MailServerForm({
  stored,
  mayWrite,
  words,
  onSaid,
}: {
  readonly stored: MailServer | null
  readonly mayWrite: boolean
  readonly words: MailServerWords
  readonly onSaid: (said: Said | null) => void
}) {
  const queries = useQueryClient()

  const [host, setHost] = useState(stored?.host ?? '')
  const [security, setSecurity] = useState<SmtpSecurity>(stored?.security ?? 'starttls')
  const [port, setPort] = useState(
    stored && stored.port !== defaultSmtpPorts[stored.security] ? String(stored.port) : '',
  )
  const [username, setUsername] = useState(stored?.username ?? '')
  const [password, setPassword] = useState('')
  const [fromAddress, setFromAddress] = useState(stored?.fromAddress ?? '')
  const [signature, setSignature] = useState(stored?.signature ?? '')

  const template = signature.trim() === '' ? null : signature
  const signatureProblem = words.signature.problem(signature)
  const Previews = words.signature.Previews

  function input(): MailServerInput {
    return {
      host,
      port: port.trim() === '' ? null : Number(port),
      security,
      username: username.trim() === '' ? null : username,
      // Sent only when typed: an empty field keeps the password there is.
      ...(password === '' ? {} : { password }),
      fromAddress,
      signature: template,
    }
  }

  function refresh() {
    void queries.invalidateQueries({ queryKey: ['mail-server'] })
    void queries.invalidateQueries({ queryKey: ['mail-status'] })
  }

  const save = useMutation({
    mutationFn: () => saveMailServer(input()),
    onSuccess: (saved) => {
      onSaid(saidOfSaving(saved))
      refresh()
    },
    onError: (error) => {
      onSaid({ tone: 'alert', text: saidWhy(error, 'Die Angaben ließen sich nicht speichern.') })
    },
  })

  const check = useMutation({
    mutationFn: () => checkMailServer(input()),
    onSuccess: (result) => {
      onSaid(saidOfCheck(result, username.trim() !== ''))
    },
    onError: (error) => {
      onSaid({ tone: 'alert', text: saidWhy(error, 'Die Prüfung kam nicht zustande.') })
    },
  })

  const [asking, setAsking] = useState(false)
  const remove = useMutation({
    mutationFn: removeMailServer,
    onSuccess: () => {
      setAsking(false)
      onSaid({
        tone: 'status',
        text:
          'Der Mailserver ist entfernt, samt Anmeldung. E-Mails, die noch warteten, gehen nicht ' +
          'mehr hinaus.',
      })
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
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        onSaid(null)
        save.mutate()
      }}
    >
      <fieldset disabled={!mayWrite} className="flex min-w-0 flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.3fr)_minmax(0,0.8fr)]">
          <div className="min-w-0 sm:col-span-2 lg:col-span-1">
            <Field
              label="Server"
              name="host"
              autoComplete="off"
              required
              value={host}
              onChange={(event) => {
                setHost(event.target.value)
              }}
              hint="Etwa smtp.ionos.de, ohne smtp:// davor und ohne Port."
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
            hint="Leer lassen für den Port, der zur Verschlüsselung gehört."
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
            hint="Meist die E-Mail-Adresse des Postfachs. Leer für einen Mailserver ohne Anmeldung."
          />
          <Field
            label="Passwort"
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            disabled={username.trim() === ''}
            onChange={(event) => {
              setPassword(event.target.value)
            }}
            problem={
              stored?.password === 'unreadable'
                ? 'Das gespeicherte Passwort lässt sich nicht mehr lesen, weil SESSION_SECRET der ' +
                  'Instanz getauscht wurde. Bitte neu eingeben; bis dahin geht keine E-Mail hinaus.'
                : undefined
            }
            hint={
              stored?.password === 'set'
                ? `Gespeichert${stored.passwordSetAt ? ` am ${moment(stored.passwordSetAt)}` : ''}. ` +
                  'Leer lassen, um es zu behalten.'
                : 'Wird verschlüsselt gespeichert und nie wieder angezeigt.'
            }
          />
          <div className="min-w-0 sm:col-span-2 lg:col-span-1">
            <Field
              label="Absenderadresse"
              name="fromAddress"
              type="email"
              autoComplete="off"
              required
              value={fromAddress}
              onChange={(event) => {
                setFromAddress(event.target.value)
              }}
              hint={`Von dieser Adresse gehen die E-Mails hinaus. ${words.senderName}`}
            />
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <TextArea
            label="Signatur"
            name="signature"
            rows={4}
            value={signature}
            placeholder={words.signature.placeholder}
            onChange={(event) => {
              setSignature(event.target.value)
            }}
            problem={signatureProblem}
            hint={words.signature.hint}
          />
          <Previews template={template} />
        </div>
      </fieldset>

      {mayWrite ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            tone="primary"
            icon={Check}
            disabled={working || signatureProblem !== undefined}
          >
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
            Die Anmeldung beim Mailserver wird gelöscht. E-Mails, die noch warten, gehen danach
            nicht mehr hinaus, bis wieder ein Mailserver eingetragen ist.
          </Confirm>
        </div>
      ) : null}
    </form>
  )
}

/** One case of a signature: who sent the message, and how the signature reads under it. */
export interface SignatureCase {
  readonly title: string
  readonly text: string
}

/**
 * How a signature reads under a message, one case beside the other. For the
 * component an application hands in as `Previews`.
 */
export function SignaturePreviews({ cases }: { readonly cases: readonly SignatureCase[] }) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {cases.map((one) => (
        <figure key={one.title} className="flex min-w-0 flex-col gap-1">
          <figcaption className="text-[12px] font-semibold text-ink-faint">{one.title}</figcaption>
          <pre className="rounded-[4px] border border-line bg-ground px-3 py-2.5 font-sans text-[13px] leading-[1.45] whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
            {`-- \n${one.text}`}
          </pre>
        </figure>
      ))}
    </div>
  )
}
