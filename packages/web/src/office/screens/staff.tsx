import { requiresSecondFactor, roleKeys } from '@opengewerk/domain'
import type { RoleKey } from '@opengewerk/domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { Button, Cell, Column, Confirm, Field, Table } from '../../components/index.js'
import { deviceName } from '../../app/devices.js'
import { moment } from '../../app/format.js'
import { roleLabel, rolesInWords } from '../../app/labels.js'
import { mailStatus } from '../../session/mail.js'
import { RequestRefused } from '../../sync/transport.js'
import {
  invite,
  openInvitations,
  revokeStaffDevice,
  setBlocked,
  setRoles,
  staff,
  staffDevices,
  withdrawInvitation,
} from '../../session/session.js'
import type { InvitationMail, StaffEntry } from '../../session/session.js'
import { Nothing, Page, Section } from '../layout.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/**
 * Who works in this business, and what the owner may do about it.
 *
 * Until #63 every account after the first came from `add-staff` on the command
 * line, which is right for the first owner and was never a decision for
 * anybody else. A pilot with one office worker and one technician does not
 * open an SSH session to put somebody on holiday.
 *
 * Three things on this screen are worth saying out loud, because each of them
 * is a thing a screen can get wrong while still looking finished.
 *
 * The password is never here. A new colleague gets a link, the link is shown
 * once, and what they type into it nobody in the office sees. The issue put
 * the reason in one sentence: a password a colleague knows and that then stays
 * for three years is worse than one nobody knows. Where the business sends
 * mail, the link can go straight to the person instead, and then nobody in the
 * office sees even that.
 *
 * Making somebody an owner is said before it is done, not after. The
 * requirement for a second factor hangs on the role and is checked on every
 * request, so an owner without one meets a wall at their next click. The
 * server does not and should not refuse the change; this warning is what turns
 * a 403 nobody expected into something somebody chose.
 *
 * Nobody is deleted. A deleted account takes its name off everything the
 * person ever wrote, and an audit log pointing at an identifier nobody can
 * resolve is worse than one naming somebody who left.
 */
export function StaffScreen() {
  const queries = useQueryClient()
  const people = useQuery({ queryKey: ['staff'], queryFn: staff })
  const invitations = useQuery({ queryKey: ['invitations'], queryFn: openInvitations })
  const mail = useQuery({ queryKey: ['mail-status'], queryFn: mailStatus })
  const [trouble, setTrouble] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [mailedTo, setMailedTo] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [devicesOf, setDevicesOf] = useState<string | null>(null)
  // Blocking and withdrawing ask first (#222); unblocking does not, it takes
  // nothing away.
  const [blocking, setBlocking] = useState<{ userId: string; name: string } | null>(null)
  const [withdrawing, setWithdrawing] = useState<{ id: string; email: string } | null>(null)

  function refresh() {
    void queries.invalidateQueries({ queryKey: ['staff'] })
    void queries.invalidateQueries({ queryKey: ['invitations'] })
  }

  const roles = useMutation({
    mutationFn: ({ userId, wanted }: { userId: string; wanted: readonly RoleKey[] }) =>
      setRoles(userId, wanted),
    onSuccess: refresh,
    onError: (error) => {
      setTrouble(saidWhy(error, 'Die Rollen ließen sich nicht ändern.'))
    },
  })

  const block = useMutation({
    mutationFn: ({ userId, blocked }: { userId: string; blocked: boolean }) =>
      setBlocked(userId, blocked),
    onSuccess: () => {
      setBlocking(null)
      refresh()
    },
    onError: (error) => {
      setBlocking(null)
      setTrouble(saidWhy(error, 'Das ließ sich nicht ändern.'))
    },
  })

  const withdraw = useMutation({
    mutationFn: withdrawInvitation,
    onSuccess: () => {
      setWithdrawing(null)
      refresh()
    },
    onError: (error) => {
      setWithdrawing(null)
      setTrouble(saidWhy(error, 'Die Einladung ließ sich nicht zurückziehen.'))
    },
  })

  return (
    <Page
      title="Zugänge"
      meta="Wer in diesem Betrieb arbeitet, und womit."
      actions={
        <Button
          tone="primary"
          onClick={() => {
            setTrouble(null)
            setLink(null)
            setMailedTo(null)
            setInviting(true)
          }}
        >
          Zugang anlegen
        </Button>
      }
    >
      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      {inviting ? (
        <Section title="Neuer Zugang">
          <InviteForm
            byMail={mail.data?.configured === true}
            onDone={(made) => {
              setInviting(false)
              setLink(made.link)
              setMailedTo(made.link === null ? made.email : null)
              refresh()
            }}
            onCancel={() => {
              setInviting(false)
            }}
            onTrouble={setTrouble}
          />
        </Section>
      ) : null}

      {link ? <NewLink link={link} onDone={() => setLink(null)} /> : null}
      {mailedTo ? <MailedInvitation email={mailedTo} onDone={() => setMailedTo(null)} /> : null}

      <Section title="Konten">
        {/*
          The warning from the issue, and it stands here rather than under the
          boxes of each row. It has to be readable before a box is ticked, not
          after, and a sentence that appears only once somebody is already an
          owner arrives at the same moment the 403 would. Whether a particular
          person is missing the factor is a different question, and the state
          column answers that one, in red, on their own row.
        */}
        <p className="text-body text-ink-muted">
          Die Rolle Inhaber verlangt einen zweiten Faktor. Wer sie bekommt, kommt ab dem nächsten
          Aufruf nicht weiter und wird zuerst zu dessen Einrichtung geführt.
        </p>

        {people.isPending ? (
          <Nothing>Wird geladen.</Nothing>
        ) : people.isError ? (
          <Nothing>{saidWhy(people.error, 'Die Liste kam nicht an.')}</Nothing>
        ) : (
          <Table caption="Konten dieses Betriebs">
            <thead>
              <tr>
                <Column>Name</Column>
                <Column>E-Mail</Column>
                <Column>Rollen</Column>
                <Column>Zustand</Column>
                <Column>Zuletzt angemeldet</Column>
                <Column>
                  <span className="sr-only">Ändern</span>
                </Column>
              </tr>
            </thead>
            <tbody>
              {people.data.map((person) => (
                <tr key={person.userId}>
                  <Cell>{person.name}</Cell>
                  <Cell>{person.email}</Cell>
                  <Cell>
                    <RolePicker
                      person={person}
                      disabled={roles.isPending}
                      onPick={(wanted) => {
                        setTrouble(null)
                        roles.mutate({ userId: person.userId, wanted })
                      }}
                    />
                  </Cell>
                  <Cell>
                    {person.blockedAt ? (
                      <span className="font-semibold text-conflict">
                        Gesperrt seit {moment(person.blockedAt)}
                      </span>
                    ) : person.twoFactorEnabled ? (
                      'Aktiv, zweiter Faktor eingerichtet'
                    ) : requiresSecondFactor(person.roles) ? (
                      <span className="font-semibold text-conflict">Zweiter Faktor fehlt</span>
                    ) : (
                      'Aktiv'
                    )}
                  </Cell>
                  <Cell>{person.lastSignInAt ? moment(person.lastSignInAt) : 'Noch nie'}</Cell>
                  <Cell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        tone="secondary"
                        onClick={() => {
                          setDevicesOf(devicesOf === person.userId ? null : person.userId)
                        }}
                      >
                        Geräte
                      </Button>
                      <Button
                        tone={person.blockedAt ? 'secondary' : 'danger'}
                        disabled={block.isPending}
                        onClick={() => {
                          setTrouble(null)

                          if (person.blockedAt === null) {
                            setBlocking({ userId: person.userId, name: person.name })
                          } else {
                            block.mutate({ userId: person.userId, blocked: false })
                          }
                        }}
                      >
                        {person.blockedAt ? 'Entsperren' : 'Sperren'}
                      </Button>
                    </div>
                  </Cell>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      {devicesOf ? (
        <Devices
          userId={devicesOf}
          name={people.data?.find((person) => person.userId === devicesOf)?.name ?? ''}
          onTrouble={setTrouble}
          onClose={() => {
            setDevicesOf(null)
          }}
        />
      ) : null}

      <Section title="Offene Einladungen">
        {invitations.isPending ? (
          <Nothing>Wird geladen.</Nothing>
        ) : invitations.isError ? (
          <Nothing>{saidWhy(invitations.error, 'Die Liste kam nicht an.')}</Nothing>
        ) : invitations.data.length === 0 ? (
          <Nothing>Keine offene Einladung.</Nothing>
        ) : (
          <Table caption="Einladungen, die noch benutzt werden können">
            <thead>
              <tr>
                <Column>Name</Column>
                <Column>E-Mail</Column>
                <Column>Rollen</Column>
                <Column>Gilt bis</Column>
                <Column>Weg</Column>
                <Column>
                  <span className="sr-only">Zurückziehen</span>
                </Column>
              </tr>
            </thead>
            <tbody>
              {invitations.data.map((entry) => (
                <tr key={entry.id}>
                  <Cell>{entry.name}</Cell>
                  <Cell>{entry.email}</Cell>
                  <Cell>{rolesInWords(entry.roles)}</Cell>
                  <Cell>{moment(entry.expiresAt)}</Cell>
                  <Cell>{deliveryInWords(entry.mail)}</Cell>
                  <Cell>
                    <Button
                      tone="danger"
                      disabled={withdraw.isPending}
                      onClick={() => {
                        setTrouble(null)
                        setWithdrawing({ id: entry.id, email: entry.email })
                      }}
                    >
                      Zurückziehen
                    </Button>
                  </Cell>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <Confirm
        open={blocking !== null}
        title={`${blocking?.name ?? ''} sperren?`}
        confirm="Sperren"
        busy={block.isPending}
        onConfirm={() => {
          if (blocking) {
            block.mutate({ userId: blocking.userId, blocked: true })
          }
        }}
        onCancel={() => {
          setBlocking(null)
        }}
      >
        {`${blocking?.name ?? ''} kann sich danach nicht mehr anmelden, und alle Geräte dieses Zugangs werden abgemeldet. Entsperren geht jederzeit.`}
      </Confirm>
      <Confirm
        open={withdrawing !== null}
        title="Einladung zurückziehen?"
        confirm="Zurückziehen"
        busy={withdraw.isPending}
        onConfirm={() => {
          if (withdrawing) {
            withdraw.mutate(withdrawing.id)
          }
        }}
        onCancel={() => {
          setWithdrawing(null)
        }}
      >
        {`Der Link in der Einladung an ${withdrawing?.email ?? ''} gilt danach nicht mehr. Eine neue Einladung geht jederzeit.`}
      </Confirm>
    </Page>
  )
}

/**
 * The link, shown once.
 *
 * What the server keeps is its hash, so there is no second chance to see it
 * and the screen says so rather than leaving somebody to find out. A read only
 * field and not a line of text: it is meant to be selected and copied, and on
 * a phone that is the difference between working and not.
 */
function NewLink({ link, onDone }: { readonly link: string; readonly onDone: () => void }) {
  return (
    <Section
      title="Der Link"
      actions={
        <Button tone="secondary" onClick={onDone}>
          Fertig
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-body">
          Diesen Link an die Person weitergeben. Er gilt sieben Tage, funktioniert genau einmal, und
          er steht nur jetzt hier: gespeichert ist davon nur eine Prüfsumme.
        </p>
        <Field
          label="Einmal-Link"
          readOnly
          value={link}
          onFocus={(event) => {
            event.target.select()
          }}
        />
        <div>
          <Button
            tone="secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(link)
            }}
          >
            Kopieren
          </Button>
        </div>
      </div>
    </Section>
  )
}

/**
 * How an open invitation travels: passed on by the office, or by mail and how
 * far that got. A message that could not be delivered says why, because the
 * office is the one who can do something about a mistyped address.
 */
function deliveryInWords(mail: InvitationMail | null): string {
  if (mail === null) {
    return 'Link weitergegeben'
  }

  switch (mail.status) {
    case 'sent':
      return mail.sentAt
        ? `Per E-Mail verschickt am ${moment(mail.sentAt)}`
        : 'Per E-Mail verschickt'
    case 'pending':
      return mail.lastError ? `E-Mail wartet: ${mail.lastError}` : 'E-Mail wird verschickt'
    case 'failed':
      return `E-Mail nicht zugestellt: ${mail.lastError ?? 'ohne Angabe'}`
  }
}

/**
 * The invitation that went by mail. Nothing to copy here, on purpose: the
 * link exists in the message and nowhere else, this screen included.
 */
function MailedInvitation({
  email,
  onDone,
}: {
  readonly email: string
  readonly onDone: () => void
}) {
  return (
    <Section
      title="Einladung per E-Mail"
      actions={
        <Button tone="secondary" onClick={onDone}>
          Fertig
        </Button>
      }
    >
      <p role="status" className="text-body">
        Die Einladung geht per E-Mail an {email}. Der Link darin gilt sieben Tage und funktioniert
        genau einmal; im Büro sieht ihn niemand. Ob die E-Mail angekommen ist, steht unten bei den
        offenen Einladungen.
      </p>
    </Section>
  )
}

/** Name, address and roles. The password is deliberately not here. */
function InviteForm({
  byMail,
  onDone,
  onCancel,
  onTrouble,
}: {
  /** Whether the business sends mail, which offers the second way. */
  readonly byMail: boolean
  readonly onDone: (made: { link: string | null; email: string }) => void
  readonly onCancel: () => void
  readonly onTrouble: (sentence: string | null) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [chosen, setChosen] = useState<readonly RoleKey[]>(['technician'])
  // Which way is being worked on, for the button that says so.
  const [working, setWorking] = useState<'link' | 'mail' | null>(null)
  // Which of the two buttons submitted the form. A ref and not state: the
  // click sets it and the submit that follows in the same moment reads it,
  // before React would have rendered a new value.
  const way = useRef<'link' | 'mail'>('link')

  async function submit() {
    const send = way.current

    setWorking(send)
    onTrouble(null)

    try {
      const { link } = await invite({ name, email, roles: chosen, send })

      onDone({ link, email: email.trim() })
    } catch (error) {
      onTrouble(saidWhy(error, 'Der Zugang ließ sich nicht anlegen.'))
    } finally {
      setWorking(null)
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <Field
        label="Name"
        name="name"
        autoComplete="off"
        required
        value={name}
        onChange={(event) => {
          setName(event.target.value)
        }}
      />
      <Field
        label="E-Mail"
        type="email"
        name="email"
        autoComplete="off"
        required
        value={email}
        onChange={(event) => {
          setEmail(event.target.value)
        }}
        hint="Damit meldet sich die Person später an."
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-body font-medium text-ink">Rollen</legend>
        {roleKeys.map((role) => (
          <label key={role} className="flex items-center gap-2 text-body">
            <input
              type="checkbox"
              className="size-5"
              checked={chosen.includes(role)}
              onChange={(event) => {
                setChosen(
                  event.target.checked
                    ? [...chosen, role]
                    : chosen.filter((picked) => picked !== role),
                )
              }}
            />
            {roleLabel[role]}
          </label>
        ))}
        <OwnerWarning roles={chosen} />
      </fieldset>

      <div className="flex flex-wrap gap-2">
        {byMail ? (
          <Button
            type="submit"
            tone="primary"
            disabled={working !== null || chosen.length === 0}
            onClick={() => {
              way.current = 'mail'
            }}
          >
            {working === 'mail' ? 'Einen Moment' : 'Per E-Mail einladen'}
          </Button>
        ) : null}
        <Button
          type="submit"
          tone={byMail ? 'secondary' : 'primary'}
          disabled={working !== null || chosen.length === 0}
          onClick={() => {
            way.current = 'link'
          }}
        >
          {working === 'link' ? 'Einen Moment' : 'Link erzeugen'}
        </Button>
        <Button type="button" tone="secondary" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
      {byMail ? null : (
        <p className="text-body text-ink-muted">
          Per E-Mail einladen geht, sobald unter "E-Mail-Einstellungen" ein Mailserver eingerichtet
          ist.
        </p>
      )}
    </form>
  )
}

/**
 * The roles of one person, as checkboxes that take effect on the spot.
 *
 * No save button, because there is nothing else on the row to save with it and
 * a button that has to be found is a change that gets forgotten. The refusals
 * that matter are on the server: the last owner of a business cannot be
 * demoted, whoever asks.
 */
function RolePicker({
  person,
  disabled,
  onPick,
}: {
  readonly person: StaffEntry
  readonly disabled: boolean
  readonly onPick: (roles: readonly RoleKey[]) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      {roleKeys.map((role) => (
        <label key={role} className="flex items-center gap-2 text-table">
          <input
            type="checkbox"
            className="size-5"
            disabled={disabled}
            checked={person.roles.includes(role)}
            onChange={(event) => {
              const wanted = event.target.checked
                ? [...person.roles, role]
                : person.roles.filter((picked) => picked !== role)

              if (wanted.length === 0) {
                return
              }

              onPick(wanted)
            }}
          />
          {roleLabel[role]}
        </label>
      ))}
    </div>
  )
}

/**
 * The sentence that turns a 403 nobody expected into something somebody chose.
 *
 * `requiresSecondFactor` comes from `domain`, so this says the same thing the
 * server checks rather than a second opinion about it. The day the bookkeeping
 * role joins that list, this warning covers it without anybody editing a
 * screen.
 */
function OwnerWarning({ roles }: { readonly roles: readonly RoleKey[] }) {
  if (!requiresSecondFactor(roles)) {
    return null
  }

  return (
    <p className="text-table text-ink-muted">
      Für diese Rolle ist ein zweiter Faktor Pflicht. Ohne ihn kommt die Person ab dem nächsten
      Aufruf nicht weiter und wird zuerst zur Einrichtung geführt.
    </p>
  )
}

/**
 * The devices of somebody else, for the phone in the van that was broken into.
 *
 * Only the sessions that are working in this business. A session of the same
 * person at another company is none of this office's business, and the server
 * answers accordingly.
 */
function Devices({
  userId,
  name,
  onTrouble,
  onClose,
}: {
  readonly userId: string
  readonly name: string
  readonly onTrouble: (sentence: string | null) => void
  readonly onClose: () => void
}) {
  const queries = useQueryClient()
  const list = useQuery({
    queryKey: ['staff-devices', userId],
    queryFn: () => staffDevices(userId),
  })

  const [signingOut, setSigningOut] = useState<{ sessionId: string; label: string } | null>(null)
  const revoke = useMutation({
    mutationFn: (sessionId: string) => revokeStaffDevice(userId, sessionId),
    onSuccess: () => {
      setSigningOut(null)
      void queries.invalidateQueries({ queryKey: ['staff-devices', userId] })
    },
    onError: (error) => {
      setSigningOut(null)
      onTrouble(saidWhy(error, 'Das Gerät ließ sich nicht abmelden.'))
    },
  })

  return (
    <Section
      title={`Geräte von ${name}`}
      actions={
        <Button tone="secondary" onClick={onClose}>
          Schließen
        </Button>
      }
    >
      {list.isPending ? (
        <Nothing>Wird geladen.</Nothing>
      ) : list.isError ? (
        <Nothing>{saidWhy(list.error, 'Die Liste kam nicht an.')}</Nothing>
      ) : list.data.length === 0 ? (
        <Nothing>In diesem Betrieb ist gerade kein Gerät angemeldet.</Nothing>
      ) : (
        <Table caption={`Geräte, auf denen ${name} in diesem Betrieb angemeldet ist`}>
          <thead>
            <tr>
              <Column>Gerät</Column>
              <Column>Angemeldet</Column>
              <Column>Läuft ab</Column>
              <Column>Art</Column>
              <Column>
                <span className="sr-only">Abmelden</span>
              </Column>
            </tr>
          </thead>
          <tbody>
            {list.data.map((entry) => (
              <tr key={entry.sessionId}>
                <Cell>{deviceName(entry.userAgent)}</Cell>
                <Cell>{moment(entry.signedInAt)}</Cell>
                <Cell>{moment(entry.expiresAt)}</Cell>
                <Cell>{entry.longLived ? 'Baustelle, 30 Tage' : 'Büro, 12 Stunden'}</Cell>
                <Cell>
                  <Button
                    tone="danger"
                    disabled={revoke.isPending}
                    onClick={() => {
                      onTrouble(null)
                      setSigningOut({
                        sessionId: entry.sessionId,
                        label: deviceName(entry.userAgent),
                      })
                    }}
                  >
                    Abmelden
                  </Button>
                </Cell>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Confirm
        open={signingOut !== null}
        title="Gerät abmelden?"
        confirm="Abmelden"
        busy={revoke.isPending}
        onConfirm={() => {
          if (signingOut) {
            revoke.mutate(signingOut.sessionId)
          }
        }}
        onCancel={() => {
          setSigningOut(null)
        }}
      >
        {`${signingOut?.label ?? ''} muss sich danach neu anmelden. Was dort noch nicht übertragen ist, bleibt auf dem Gerät und geht nach der nächsten Anmeldung hinaus.`}
      </Confirm>
    </Section>
  )
}
