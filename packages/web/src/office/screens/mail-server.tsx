import {
  defaultSmtpPorts,
  type IssuerContent,
  renderSignature,
  type SmtpSecurity,
  smtpSecurities,
  unknownPlaceholders,
} from '@opengewerk/domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button, Field, SelectField, TextArea } from '../../components/index.js'
import { moment } from '../../app/format.js'
import { letterhead, type LetterheadView } from '../../session/letterhead.js'
import {
  checkMailServer,
  type MailServer,
  type MailServerCheck,
  type MailServerInput,
  mailServer,
  removeMailServer,
  type SavedMailServer,
  saveMailServer,
} from '../../session/mail.js'
import { currentAccount } from '../../session/session.js'
import { RequestRefused } from '../../sync/transport.js'
import { Nothing, Section } from '../layout.js'

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

/** The business as the letterhead has it, for the preview of `{briefkopf}`. */
function issuerOf(view: LetterheadView): IssuerContent {
  return {
    name: view.companyName ?? view.setUpAs,
    street: view.street,
    houseNumber: view.houseNumber,
    postalCode: view.postalCode,
    city: view.city,
    country: view.country ?? 'DE',
    phone: view.phone,
    email: view.email,
    website: view.website,
    taxNumber: null,
    vatId: null,
    iban: null,
    bic: null,
    bankName: null,
    registerCourt: null,
    registerNumber: null,
    managingDirectors: null,
    logo: null,
  }
}

/**
 * The mail server of the business, for whoever holds `mail.read`, which is
 * the owner. The form is remounted after every save, so that it shows what
 * the server now keeps; what happened stays above it, here.
 */
export function MailServerSection({ mayWrite }: { readonly mayWrite: boolean }) {
  const stored = useQuery({ queryKey: ['mail-server'], queryFn: mailServer })
  const [said, setSaid] = useState<Said | null>(null)

  return (
    <Section title="Mailserver">
      <div className="flex flex-col gap-4">
        <p className="text-body text-ink">
          Über diesen Mailserver verschickt OpenGewerk alle E-Mails des Betriebs: Belege an Kunden,
          Einladungen neuer Zugänge und fällige Aufgaben. Die Angaben stehen beim E-Mail-Anbieter,
          meist unter "SMTP" oder "Postausgangsserver".
        </p>

        {stored.isPending ? (
          <Nothing>Wird geladen.</Nothing>
        ) : stored.isError ? (
          <Nothing>{saidWhy(stored.error, 'Die Angaben zum Mailserver kamen nicht an.')}</Nothing>
        ) : (
          <MailServerForm
            key={stored.data?.updatedAt ?? 'neu'}
            stored={stored.data}
            mayWrite={mayWrite}
            onSaid={setSaid}
          />
        )}

        {said ? (
          <p
            role={said.tone}
            className={
              said.tone === 'alert'
                ? 'text-body font-semibold text-conflict'
                : 'text-body text-ink-muted'
            }
          >
            {said.text}
          </p>
        ) : null}
      </div>
    </Section>
  )
}

function MailServerForm({
  stored,
  mayWrite,
  onSaid,
}: {
  readonly stored: MailServer | null
  readonly mayWrite: boolean
  readonly onSaid: (said: Said | null) => void
}) {
  const queries = useQueryClient()
  const account = useQuery({ queryKey: ['account'], queryFn: currentAccount })
  const head = useQuery({ queryKey: ['letterhead'], queryFn: letterhead })

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
  const unknown = unknownPlaceholders(signature)

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

  const remove = useMutation({
    mutationFn: removeMailServer,
    onSuccess: () => {
      onSaid({
        tone: 'status',
        text:
          'Der Mailserver ist entfernt, samt Anmeldung. E-Mails, die noch warteten, gehen nicht ' +
          'mehr hinaus.',
      })
      refresh()
    },
    onError: (error) => {
      onSaid({ tone: 'alert', text: saidWhy(error, 'Der Mailserver ließ sich nicht entfernen.') })
    },
  })

  const working = save.isPending || check.isPending || remove.isPending
  const issuer = head.data ? issuerOf(head.data) : null

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSaid(null)
        save.mutate()
      }}
    >
      <fieldset disabled={!mayWrite} className="flex flex-col gap-4">
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
          hint="Von dieser Adresse gehen die E-Mails hinaus. Der Name davor kommt aus dem Briefkopf."
        />
        <TextArea
          label="Signatur"
          name="signature"
          rows={6}
          value={signature}
          placeholder={'Viele Grüße\n{benutzer}\n\n{briefkopf}'}
          onChange={(event) => {
            setSignature(event.target.value)
          }}
          problem={
            unknown.length > 0
              ? `Unbekannt: ${unknown.join(', ')}. Möglich sind {benutzer} und {briefkopf}.`
              : undefined
          }
          hint={
            'Steht unter jeder E-Mail. {benutzer} ist der Name dessen, der die E-Mail ' +
            'verschickt; bei automatischen E-Mails fällt die Zeile weg. {briefkopf} ist der ' +
            'Briefkopf. Leer lassen für den Briefkopf allein.'
          }
        />
      </fieldset>

      {issuer ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <SignaturePreview
            title="Von Ihnen verschickt"
            text={renderSignature(template, {
              issuer,
              sender: account.data?.name || 'Ihr Name',
            })}
          />
          <SignaturePreview
            title="Automatisch verschickt"
            text={renderSignature(template, { issuer, sender: null })}
          />
        </div>
      ) : null}

      {mayWrite ? (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" tone="primary" disabled={working || unknown.length > 0}>
            {save.isPending ? 'Wird geprüft' : 'Speichern'}
          </Button>
          <Button
            type="button"
            tone="secondary"
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
                remove.mutate()
              }}
            >
              Mailserver entfernen
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  )
}

/** How the signature reads under a message, one case each. */
function SignaturePreview({ title, text }: { readonly title: string; readonly text: string }) {
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-table text-ink-muted">{title}</figcaption>
      <pre className="whitespace-pre-wrap rounded-control border border-line bg-surface px-3 py-2 font-sans text-table text-ink">
        {`-- \n${text}`}
      </pre>
    </figure>
  )
}
