import { accessRights, type RoleDefinition } from '@opengewerk/platform-domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Copy, Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { useApplication, useStaffSentences } from '../application.js'
import { Button } from '../components/button.js'
import { Confirm } from '../components/confirm.js'
import { Field } from '../components/field.js'
import { Panel, TablePanel } from '../components/panel.js'
import type { TableCard } from '../components/panel.js'
import { Cell, Column } from '../components/table.js'
import { date, moment } from '../format.js'
import { deviceName } from '../session/device-name.js'
import { accountQuery, useRight } from '../session/queries.js'
import {
  invite,
  openInvitations,
  revokeStaffDevice,
  setBlocked,
  setRoles,
  staff,
  staffDevices,
  staffRoles,
  withdrawInvitation,
} from '../session/session.js'
import type { InvitationMail, StaffEntry } from '../session/session.js'
import { rolesInWords } from '../session/who.js'
import { RequestRefused } from '../sync/transport.js'
import { SettingsPage, SettingsText } from './settings.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/**
 * Who works in this tenant, and what whoever leads it may do about it.
 *
 * Until #63 every account after the first came from `add-staff` on the command
 * line, which is right for the first account and was never a decision for
 * anybody else. A tenant with two people in it does not open an SSH session to
 * put somebody on holiday.
 *
 * Three things on this screen are worth saying out loud, because each of them
 * is a thing a screen can get wrong while still looking finished.
 *
 * The password is never here. A new colleague gets a link, the link is shown
 * once, and what they type into it nobody here sees. The issue put the reason
 * in one sentence: a password a colleague knows and that then stays for three
 * years is worse than one nobody knows. Where the tenant sends mail, the link
 * can go straight to the person instead, and then nobody here sees even that.
 *
 * A role that asks for a second factor is said before it is given, not after.
 * The requirement hangs on the role and is checked on every request, so
 * somebody given such a role without a factor meets a wall at their next
 * click. The server does not and should not refuse the change; this warning
 * is what turns a 403 nobody expected into something somebody chose.
 *
 * The roles on offer are the ones this tenant has, as the server lists them
 * (ADR 0010): their names, and which of them ask for a second factor. Not a
 * list in this code, which would offer what the server refuses the day a
 * tenant has a role of its own.
 *
 * Nobody is deleted. A deleted account takes its name off everything the
 * person ever wrote, and an audit log pointing at an identifier nobody can
 * resolve is worse than one naming somebody who left.
 *
 * Which settings screen this is, among those the application lists, it says
 * by its key, `zugaenge`, as the addresses of the account and of the area of
 * the instance are the foundation's to say.
 */
export function StaffScreen({
  byMail,
  suggestedRoles,
}: {
  /**
   * Whether the tenant sends mail, which offers the invitation by mail beside
   * the link. The application asks, and says where mail is set up when it is
   * not: the route is its own.
   */
  readonly byMail: boolean
  /**
   * The roles the form of a new account starts with ticked, of those the
   * tenant has: what a new colleague usually is, which only the application
   * knows.
   */
  readonly suggestedRoles: readonly string[]
}) {
  const sentences = useStaffSentences()
  const queries = useQueryClient()
  const people = useQuery({ queryKey: ['staff'], queryFn: staff })
  const known = useQuery({ queryKey: ['staff-roles'], queryFn: staffRoles })
  const invitations = useQuery({ queryKey: ['invitations'], queryFn: openInvitations })
  const account = useQuery(accountQuery)
  // Reading the list takes one right and changing it another, and a tenant
  // may give a role the first alone (opengewerk-haustechnik#31). Without the
  // second nothing is offered that the routes would refuse.
  const mayWrite = useRight(accessRights.write)
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

  const available = known.data ?? []

  const roles = useMutation({
    mutationFn: ({ userId, wanted }: { userId: string; wanted: readonly string[] }) =>
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

  const you = account.data?.userId ?? null

  function rolesOf(person: StaffEntry, inBox = false) {
    return (
      <RolePicker
        person={person}
        roles={available}
        inBox={inBox}
        disabled={!mayWrite || roles.isPending}
        onPick={(wanted) => {
          setTrouble(null)
          roles.mutate({ userId: person.userId, wanted })
        }}
      />
    )
  }

  function actionsOf(person: StaffEntry) {
    return (
      <span className="inline-flex flex-wrap justify-end gap-1.5">
        <Button
          size="small"
          aria-expanded={devicesOf === person.userId}
          onClick={() => {
            setDevicesOf(devicesOf === person.userId ? null : person.userId)
          }}
        >
          Geräte
        </Button>
        {person.userId === you || !mayWrite ? null : (
          <Button
            size="small"
            tone={person.blockedAt ? 'secondary' : 'danger'}
            aria-label={`${person.name} ${person.blockedAt ? 'entsperren' : 'sperren'}`}
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
        )}
      </span>
    )
  }

  const accountCards: readonly TableCard[] = (people.data ?? []).map((person) => ({
    key: person.userId,
    title: '',
    form: (
      <div className="flex flex-col gap-2 text-[15px]">
        <Who name={person.name} email={person.email} you={person.userId === you} inBox />
        {rolesOf(person, true)}
        <span className="text-[13px] text-ink-muted">
          <StateOf person={person} roles={available} />
          {' · '}
          {person.lastSignInAt ? moment(person.lastSignInAt) : 'Noch nie'}
        </span>
        <div>{actionsOf(person)}</div>
      </div>
    ),
  }))

  const invitationCards: readonly TableCard[] = (invitations.data ?? []).map((entry) => ({
    key: entry.id,
    title: entry.name,
    sub: (
      <>
        {entry.email} · {rolesInWords(namesOf(entry.roles, available))} · bis{' '}
        {date(entry.expiresAt)}
        <span className="mt-0.5 block">{deliveryInWords(entry.mail)}</span>
      </>
    ),
    actions: mayWrite ? (
      <Button
        size="small"
        tone="danger"
        aria-label={`Einladung an ${entry.email} zurückziehen`}
        disabled={withdraw.isPending}
        onClick={() => {
          setTrouble(null)
          setWithdrawing({ id: entry.id, email: entry.email })
        }}
      >
        Zurückziehen
      </Button>
    ) : null,
  }))

  return (
    <SettingsPage
      active="zugaenge"
      title="Zugänge"
      sub={sentences.what}
      actions={
        mayWrite ? (
          <Button
            tone="primary"
            icon={Plus}
            // Not before the roles of the tenant are known: the form offers
            // them, and one without any could invite nobody.
            disabled={inviting || !known.data}
            onClick={() => {
              setTrouble(null)
              setLink(null)
              setMailedTo(null)
              setInviting(true)
            }}
          >
            Zugang anlegen
          </Button>
        ) : null
      }
    >
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      {inviting ? (
        <Panel title="Neuer Zugang" roomy>
          <InviteForm
            roles={available}
            byMail={byMail}
            suggestedRoles={suggestedRoles}
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
        </Panel>
      ) : null}

      {link ? <NewLink link={link} onDone={() => setLink(null)} /> : null}
      {mailedTo ? <MailedInvitation email={mailedTo} onDone={() => setMailedTo(null)} /> : null}

      {people.isPending || known.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : people.isError ? (
        <SettingsText muted>{saidWhy(people.error, 'Die Liste kam nicht an.')}</SettingsText>
      ) : known.isError ? (
        <SettingsText muted>{saidWhy(known.error, 'Die Rollen kamen nicht an.')}</SettingsText>
      ) : (
        <TablePanel
          title="Konten"
          caption={sentences.accounts}
          cards={accountCards}
          /*
            The warning from the issue, and it stands here rather than under
            the boxes of each row. It has to be readable before a box is
            ticked, not after, and a sentence that appears only once somebody
            already holds the role arrives at the same moment the 403 would.
            Whether a particular person is missing the factor is a different
            question, and the state column answers that one, in red, on their
            own row.
          */
          note={secondFactorNote(available)}
        >
          <thead>
            <tr>
              <Column>Zugang</Column>
              <Column className="w-[208px]">Rollen</Column>
              <Column className="w-[118px]">Zustand</Column>
              <Column className="w-[132px]">Zuletzt angemeldet</Column>
              <Column numeric className="w-[150px]">
                <span className="sr-only">Ändern</span>
              </Column>
            </tr>
          </thead>
          <tbody>
            {people.data.map((person) => (
              <tr key={person.userId}>
                <Cell>
                  <Who name={person.name} email={person.email} you={person.userId === you} />
                </Cell>
                <Cell>{rolesOf(person)}</Cell>
                <Cell className="text-[13px]">
                  <StateOf person={person} roles={available} />
                </Cell>
                <Cell className="text-[13px]">
                  {person.lastSignInAt ? moment(person.lastSignInAt) : 'Noch nie'}
                </Cell>
                <Cell numeric>{actionsOf(person)}</Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}

      {devicesOf ? (
        <Devices
          userId={devicesOf}
          name={people.data?.find((person) => person.userId === devicesOf)?.name ?? ''}
          mayWrite={mayWrite}
          onTrouble={setTrouble}
          onClose={() => {
            setDevicesOf(null)
          }}
        />
      ) : null}

      {invitations.isPending ? null : invitations.isError ? (
        <SettingsText muted>{saidWhy(invitations.error, 'Die Liste kam nicht an.')}</SettingsText>
      ) : invitations.data.length === 0 ? (
        <Panel title="Offene Einladungen">
          <SettingsText muted>Keine offene Einladung.</SettingsText>
        </Panel>
      ) : (
        <TablePanel
          title="Offene Einladungen"
          caption="Einladungen, die noch benutzt werden können"
          cards={invitationCards}
        >
          <thead>
            <tr>
              <Column>Eingeladen</Column>
              <Column className="w-[110px]">Rollen</Column>
              <Column className="w-[100px]">Gilt bis</Column>
              <Column className="w-[250px]">Weg</Column>
              <Column numeric className="w-[120px]">
                <span className="sr-only">Zurückziehen</span>
              </Column>
            </tr>
          </thead>
          <tbody>
            {invitations.data.map((entry) => (
              <tr key={entry.id}>
                <Cell>
                  <Who name={entry.name} email={entry.email} />
                </Cell>
                <Cell className="text-[13px]">{rolesInWords(namesOf(entry.roles, available))}</Cell>
                <Cell className="text-[13px]">{date(entry.expiresAt)}</Cell>
                <Cell className="text-[13px]">{deliveryInWords(entry.mail)}</Cell>
                <Cell numeric>
                  {mayWrite ? (
                    <Button
                      size="small"
                      tone="danger"
                      aria-label={`Einladung an ${entry.email} zurückziehen`}
                      disabled={withdraw.isPending}
                      onClick={() => {
                        setTrouble(null)
                        setWithdrawing({ id: entry.id, email: entry.email })
                      }}
                    >
                      Zurückziehen
                    </Button>
                  ) : null}
                </Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}

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
    </SettingsPage>
  )
}

/**
 * Name and address of a person, `who()` of the board, with "Sie" for the one
 * looking. In the table on one line each, as the board has them: an address
 * broken in the middle reads as two, and a table too narrow for it scrolls in
 * its frame (#218). In a box on a phone it breaks where it has to.
 */
function Who({
  name,
  email,
  you = false,
  inBox = false,
}: {
  readonly name: string
  readonly email: string
  readonly you?: boolean
  readonly inBox?: boolean
}) {
  const breaks = inBox ? '[overflow-wrap:anywhere]' : 'whitespace-nowrap'

  return (
    <>
      <span className={clsx('block text-[14px] font-semibold max-sm:text-[15px]', breaks)}>
        {name}
        {you ? <span className="ml-1.5 text-[12px] font-bold text-copper-text">Sie</span> : null}
      </span>
      <span className={clsx('block text-[13px] text-ink-faint', breaks)}>{email}</span>
    </>
  )
}

/**
 * What the tenant calls these roles, in the order it lists them. A key it has
 * no role for keeps its key: it stands in a membership or an invitation, and
 * leaving it out would hide that.
 */
function namesOf(keys: readonly string[], roles: readonly RoleDefinition[]): readonly string[] {
  return [
    ...roles.filter((role) => keys.includes(role.key)).map((role) => role.label),
    ...keys.filter((key) => !roles.some((role) => role.key === key)),
  ]
}

/** Whether one of these roles works only with a second factor, as the tenant has them. */
function asksSecondFactor(keys: readonly string[], roles: readonly RoleDefinition[]): boolean {
  return roles.some((role) => role.secondFactor && keys.includes(role.key))
}

/**
 * Which roles ask for a second factor, said above the table and before a box
 * is ticked. Nothing where no role does.
 */
function secondFactorNote(roles: readonly RoleDefinition[]): string | null {
  const names = roles.filter((role) => role.secondFactor).map((role) => role.label)
  const [first, ...more] = names

  if (first === undefined) {
    return null
  }

  if (more.length === 0) {
    return `Die Rolle ${first} verlangt einen zweiten Faktor. Wer sie bekommt, kommt ab dem nächsten Aufruf nicht weiter und wird zuerst zu dessen Einrichtung geführt.`
  }

  const last = more[more.length - 1] ?? ''
  const listed = [first, ...more.slice(0, -1)].join(', ')

  return `Die Rollen ${listed} und ${last} verlangen einen zweiten Faktor. Wer eine davon bekommt, kommt ab dem nächsten Aufruf nicht weiter und wird zuerst zu dessen Einrichtung geführt.`
}

/** Whether somebody can work, in the words of the column "Zustand". */
function StateOf({
  person,
  roles,
}: {
  readonly person: StaffEntry
  readonly roles: readonly RoleDefinition[]
}) {
  if (person.blockedAt) {
    return <b className="font-semibold text-conflict">Gesperrt seit {moment(person.blockedAt)}</b>
  }

  // The app or a passkey, which signs in only when confirmed on the device
  // and is a second factor as well (#167).
  if (person.twoFactorEnabled || person.hasPasskey) {
    return <>Aktiv, zweiter Faktor eingerichtet</>
  }

  return asksSecondFactor(person.roles, roles) ? (
    <b className="font-semibold text-conflict">Zweiter Faktor fehlt</b>
  ) : (
    <>Aktiv</>
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
    <Panel
      title="Der Link"
      roomy
      action={
        <Button size="small" onClick={onDone}>
          Fertig
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <SettingsText>
          Diesen Link an die Person weitergeben. Er gilt sieben Tage, funktioniert genau einmal, und
          er steht nur jetzt hier: gespeichert ist davon nur eine Prüfsumme.
        </SettingsText>
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
            icon={Copy}
            onClick={() => {
              void navigator.clipboard?.writeText(link)
            }}
          >
            Kopieren
          </Button>
        </div>
      </div>
    </Panel>
  )
}

/**
 * How an open invitation travels: passed on by hand, or by mail and how far
 * that got. A message that could not be delivered says why, because whoever
 * invited is the one who can do something about a mistyped address.
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
 * link exists in the message and nowhere else, this screen included. How long
 * it holds and how often it works is the foundation's to say, who does not
 * get to see it the application's.
 */
function MailedInvitation({
  email,
  onDone,
}: {
  readonly email: string
  readonly onDone: () => void
}) {
  const sentences = useStaffSentences()

  return (
    <Panel
      title="Einladung per E-Mail"
      roomy
      action={
        <Button size="small" onClick={onDone}>
          Fertig
        </Button>
      }
    >
      <p role="status" className="text-[14px] leading-[1.5] text-ink">
        Die Einladung geht per E-Mail an {email}. Der Link darin gilt sieben Tage und funktioniert
        genau einmal; {sentences.mailedLinkUnseen} Ob die E-Mail angekommen ist, steht unten bei den
        offenen Einladungen.
      </p>
    </Panel>
  )
}

/** Name, address and roles. The password is deliberately not here. */
function InviteForm({
  roles,
  byMail,
  suggestedRoles,
  onDone,
  onCancel,
  onTrouble,
}: {
  /** The roles this tenant has. */
  readonly roles: readonly RoleDefinition[]
  /** Whether the tenant sends mail, which offers the second way. */
  readonly byMail: boolean
  /** The roles that start ticked, as far as the tenant has them. */
  readonly suggestedRoles: readonly string[]
  readonly onDone: (made: { link: string | null; email: string }) => void
  readonly onCancel: () => void
  readonly onTrouble: (sentence: string | null) => void
}) {
  const sentences = useStaffSentences()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  // What goes out is only what the tenant has a role for, should it have none
  // of a key the application suggests.
  const [ticked, setTicked] = useState<readonly string[]>(suggestedRoles)
  const chosen = ticked.filter((key) => roles.some((role) => role.key === key))
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
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
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
      </div>

      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className="mb-1 font-condensed text-label font-semibold tracking-[1.1px] text-ink-faint uppercase">
          Rollen
        </legend>
        <div className="flex flex-wrap gap-x-3.5 gap-y-2">
          {roles.map((role) => (
            <label
              key={role.key}
              className="inline-flex min-h-6 items-center gap-[5px] text-[14px] max-lg:min-h-tap"
            >
              <input
                type="checkbox"
                className="size-[15px] accent-copper-solid max-lg:size-5"
                checked={chosen.includes(role.key)}
                onChange={(event) => {
                  setTicked(
                    event.target.checked
                      ? [...chosen, role.key]
                      : chosen.filter((picked) => picked !== role.key),
                  )
                }}
              />
              {role.label}
            </label>
          ))}
        </div>
        <SecondFactorWarning needed={asksSecondFactor(chosen, roles)} />
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
        <Button type="button" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
      {byMail ? null : <SettingsText muted>{sentences.noMail}</SettingsText>}
    </form>
  )
}

/**
 * The roles of one person, as checkboxes that take effect on the spot.
 *
 * No save button, because there is nothing else on the row to save with it and
 * a button that has to be found is a change that gets forgotten. The refusals
 * that matter are on the server: the last one who leads a tenant cannot be
 * demoted, whoever asks.
 */
function RolePicker({
  person,
  roles,
  disabled,
  inBox = false,
  onPick,
}: {
  readonly person: StaffEntry
  /** The roles this tenant has. */
  readonly roles: readonly RoleDefinition[]
  readonly disabled: boolean
  /** In a box on a phone, where they may wrap; in the table they stay in a line. */
  readonly inBox?: boolean
  readonly onPick: (roles: readonly string[]) => void
}) {
  // What goes out is what the tenant has a role for. A key in the membership
  // without one names nothing, and the server would refuse a change that
  // carried it along.
  const held = person.roles.filter((key) => roles.some((role) => role.key === key))

  return (
    <div
      className={clsx(
        'flex gap-x-3.5 gap-y-1 text-[13px] whitespace-nowrap max-sm:text-[15px]',
        inBox ? 'flex-wrap' : 'flex-nowrap',
      )}
    >
      {roles.map((role) => (
        <label key={role.key} className="inline-flex items-center gap-[5px] max-lg:min-h-tap">
          <input
            type="checkbox"
            className="size-[15px] accent-copper-solid max-lg:size-5"
            disabled={disabled}
            checked={held.includes(role.key)}
            onChange={(event) => {
              const wanted = event.target.checked
                ? [...held, role.key]
                : held.filter((picked) => picked !== role.key)

              if (wanted.length === 0) {
                return
              }

              onPick(wanted)
            }}
          />
          {role.label}
        </label>
      ))}
    </div>
  )
}

/**
 * The sentence that turns a 403 nobody expected into something somebody chose.
 *
 * Whether a role asks for a second factor is in the row of the role, which is
 * what the server checks, so this says the same thing rather than a second
 * opinion about it. The day another role asks for one, this warning covers it
 * without anybody editing a screen.
 */
function SecondFactorWarning({ needed }: { readonly needed: boolean }) {
  if (!needed) {
    return null
  }

  return (
    <p className="text-[13px] leading-[1.45] text-ink-muted">
      Für diese Rolle ist ein zweiter Faktor Pflicht. Ohne ihn kommt die Person ab dem nächsten
      Aufruf nicht weiter und wird zuerst zur Einrichtung geführt.
    </p>
  )
}

/**
 * The devices of somebody else, for the phone in the van that was broken into.
 *
 * Only the sessions that are working in this tenant. A session of the same
 * person in another tenant is none of this one's business, and the server
 * answers accordingly.
 */
function Devices({
  userId,
  name,
  mayWrite,
  onTrouble,
  onClose,
}: {
  readonly userId: string
  readonly name: string
  /** Whether whoever looks may sign a device out, which the list alone does not need. */
  readonly mayWrite: boolean
  readonly onTrouble: (sentence: string | null) => void
  readonly onClose: () => void
}) {
  const sentences = useStaffSentences()
  const entryName = useApplication().sentences.entry.name
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

  // How long a session holds is decided here, in the foundation, as under the
  // account; what the entry it was opened from is called, the application says.
  const sessionKind = (longLived: boolean) =>
    longLived ? `${entryName.site}, 30 Tage` : `${entryName.office}, 12 Stunden`

  const cards: readonly TableCard[] = (list.data ?? []).map((entry) => ({
    key: entry.sessionId,
    title: deviceName(entry.userAgent),
    sub: `${moment(entry.signedInAt)} bis ${moment(entry.expiresAt)}`,
    right: sessionKind(entry.longLived),
    actions: signOutButton(entry.sessionId, deviceName(entry.userAgent)),
  }))

  function signOutButton(sessionId: string, label: string): ReactNode {
    if (!mayWrite) {
      return null
    }

    return (
      <Button
        size="small"
        tone="danger"
        aria-label={`${label} abmelden`}
        disabled={revoke.isPending}
        onClick={() => {
          onTrouble(null)
          setSigningOut({ sessionId, label })
        }}
      >
        Abmelden
      </Button>
    )
  }

  const close = (
    <Button size="small" onClick={onClose}>
      Schließen
    </Button>
  )

  return (
    <>
      {list.isPending ? (
        <Panel title={`Geräte von ${name}`} action={close}>
          <SettingsText muted>Wird geladen.</SettingsText>
        </Panel>
      ) : list.isError ? (
        <Panel title={`Geräte von ${name}`} action={close}>
          <SettingsText muted>{saidWhy(list.error, 'Die Liste kam nicht an.')}</SettingsText>
        </Panel>
      ) : list.data.length === 0 ? (
        <Panel title={`Geräte von ${name}`} action={close}>
          <SettingsText muted>{sentences.noDevices}</SettingsText>
        </Panel>
      ) : (
        <TablePanel
          title={`Geräte von ${name}`}
          action={close}
          caption={sentences.devicesOf(name)}
          cards={cards}
        >
          <thead>
            <tr>
              <Column>Gerät</Column>
              <Column className="w-[150px]">Angemeldet</Column>
              <Column className="w-[150px]">Läuft ab</Column>
              <Column className="w-[140px]">Art</Column>
              <Column numeric className="w-[110px]">
                <span className="sr-only">Abmelden</span>
              </Column>
            </tr>
          </thead>
          <tbody>
            {list.data.map((entry) => (
              <tr key={entry.sessionId}>
                <Cell>{deviceName(entry.userAgent)}</Cell>
                <Cell className="text-[13px]">{moment(entry.signedInAt)}</Cell>
                <Cell className="text-[13px]">{moment(entry.expiresAt)}</Cell>
                <Cell className="text-[13px]">{sessionKind(entry.longLived)}</Cell>
                <Cell numeric>{signOutButton(entry.sessionId, deviceName(entry.userAgent))}</Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
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
    </>
  )
}
