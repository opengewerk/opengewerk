import { accessRights, type RoleDefinition } from '@opengewerk/platform-domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { useApplication, useStaffSentences } from '../application.js'
import { Button } from '../components/button.js'
import { Choice } from '../components/choice.js'
import { Confirm } from '../components/confirm.js'
import { Dialog, DialogActions } from '../components/dialog.js'
import { Field, FieldLabel } from '../components/field.js'
import { Panel, TablePanel } from '../components/panel.js'
import type { TableCard } from '../components/panel.js'
import { Cell, Column } from '../components/table.js'
import { date, moment } from '../format.js'
import { deviceName } from '../session/device-name.js'
import { accountQuery, useRight } from '../session/queries.js'
import {
  correctAccount,
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
import type { InvitationEntry, StaffEntry } from '../session/session.js'
import { rolesInWords } from '../session/who.js'
import { SettingsPage, SettingsText } from './settings.js'
import {
  asksSecondFactor,
  deliveryInWords,
  MailedInvitation,
  namesOf,
  NewLink,
  saidWhy,
  SecondFactorWarning,
  StateOf,
  Who,
} from './staff-parts.js'

/**
 * What an application keeps beside a membership, as "Zugänge" shows and
 * changes it (ADR 0010, `MembershipAdditions` on the server): a column in
 * both tables, a part of both dialogs, and what goes out under `additions`
 * with a new access and with a change of the role.
 *
 * `Value` is what the part of a dialog holds while somebody works in it. Its
 * shape is the application's, as is what it sends.
 */
export interface StaffAdditions<Value> {
  /** The head of the column and of the part of a dialog. */
  readonly title: string
  /** How wide the column is, as the class of its head: `w-[96px]`. */
  readonly column?: string
  /**
   * Whether the application knows what it keeps, for everybody listed. Until
   * then no dialog opens: it would start with what nobody has.
   */
  readonly known: boolean
  /** The cell of somebody who works here. */
  readonly ofMember: (person: StaffEntry) => ReactNode
  /** The cell of an open invitation. */
  readonly ofInvitation: (invitation: InvitationEntry) => ReactNode
  /** Under the accounts, before what the foundation says there: a sentence on what the column shows. */
  readonly note?: string | null
  /** What a dialog starts with: for somebody who works here, or for a new access. */
  readonly startWith: (person: StaffEntry | null) => Value
  /** The fields in a dialog, under the roles. */
  readonly fields: (part: StaffAdditionsPart<Value>) => ReactNode
  /** What goes out under `additions`, beside this role. */
  readonly toSend: (value: Value, role: string) => unknown
  /** After something was saved: the application asks again what it shows. */
  readonly refresh: () => void
}

/** What the fields of an application are handed in a dialog. */
export interface StaffAdditionsPart<Value> {
  readonly value: Value
  /** The role picked in the dialog right now, by its key. */
  readonly role: string | null
  readonly onChange: (next: Value) => void
}

export interface StaffDialogsScreenProps<Value> {
  /**
   * Whether the tenant sends mail, which offers the invitation by mail beside
   * the link. The application asks, and says where mail is set up when it is
   * not: the route is its own.
   */
  readonly byMail: boolean
  /**
   * The role a new access starts with, if the tenant has it: what a new
   * colleague usually is, which only the application knows.
   */
  readonly suggestedRole: string
  /** Under the name of a role on its card, by the key of the role: what the role is for. */
  readonly roleNotes: Readonly<Record<string, string>>
  /** What only this screen says, in the words of the application. */
  readonly sentences: {
    /** Under the accounts, after the roles that ask for a second factor: whom nobody demotes. */
    readonly lastLead: string
    /**
     * Under name and address of an access: that the change is recorded, and
     * whose account only the person corrects.
     */
    readonly correction: string
  }
  /** What the application keeps beside a membership, where it keeps something. */
  readonly additions?: StaffAdditions<Value>
  /** Cards of the application, between the accounts and the invitations. */
  readonly children?: ReactNode
}

/**
 * Who works in this tenant, where an access has one role and is made and
 * changed in a dialog.
 *
 * The other screen of "Zugänge" (`StaffScreen`) ticks the roles in the row,
 * which is right while a row has nothing else to say. Here an access has one
 * role with a sentence on what it is for, and the application keeps something
 * beside it that belongs to the same decision. That needs room and one
 * "Speichern", so both stand in a dialog, and the row only says what is.
 * Which of the two screens an application shows is its choice.
 *
 * What is said there about the password, the second factor, the roles of the
 * tenant and about nobody being deleted holds here as well.
 *
 * Name and address of an account are corrected in the same dialog and go to a
 * route of their own, first: an account that is not this tenant's alone is
 * refused there, and then nothing else of the dialog is saved either.
 *
 * The devices of somebody stand in the dialog of their access, for the phone
 * that was stolen. Whoever may read the list and not change it reaches them
 * by a button of their own.
 */
export function StaffDialogsScreen<Value = undefined>({
  byMail,
  suggestedRole,
  roleNotes,
  sentences: own,
  additions,
  children,
}: StaffDialogsScreenProps<Value>) {
  const sentences = useStaffSentences()
  const queries = useQueryClient()
  const people = useQuery({ queryKey: ['staff'], queryFn: staff })
  const known = useQuery({ queryKey: ['staff-roles'], queryFn: staffRoles })
  const invitations = useQuery({ queryKey: ['invitations'], queryFn: openInvitations })
  const account = useQuery(accountQuery)
  // Reading the list takes one right and changing it another. Without the
  // second nothing is offered that the routes would refuse.
  const mayWrite = useRight(accessRights.write)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [mailedTo, setMailedTo] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [devicesOf, setDevicesOf] = useState<string | null>(null)
  // Blocking and withdrawing ask first; unblocking does not, it takes nothing
  // away.
  const [blocking, setBlocking] = useState<{ userId: string; name: string } | null>(null)
  const [withdrawing, setWithdrawing] = useState<{ id: string; email: string } | null>(null)

  function refresh() {
    void queries.invalidateQueries({ queryKey: ['staff'] })
    void queries.invalidateQueries({ queryKey: ['invitations'] })
    additions?.refresh()
  }

  const available = known.data ?? []
  // Not before the roles of the tenant are known, and what the application
  // keeps: a dialog offers both.
  const ready = known.data !== undefined && (additions?.known ?? true)

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
  const edited = people.data?.find((person) => person.userId === editing) ?? null
  const shown = people.data?.find((person) => person.userId === devicesOf) ?? null

  function lastSeen(person: StaffEntry): string {
    return person.lastSignInAt ? `zuletzt ${moment(person.lastSignInAt)}` : 'noch nie angemeldet'
  }

  function actionsOf(person: StaffEntry) {
    return (
      <span className="inline-flex flex-wrap justify-end gap-1.5">
        {mayWrite ? (
          <Button
            size="small"
            aria-label={`${person.name} bearbeiten`}
            disabled={!ready}
            onClick={() => {
              setTrouble(null)
              setEditing(person.userId)
            }}
          >
            Bearbeiten
          </Button>
        ) : (
          <Button
            size="small"
            aria-label={`Geräte von ${person.name}`}
            onClick={() => {
              setDevicesOf(person.userId)
            }}
          >
            Geräte
          </Button>
        )}
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

  function withdrawButton(entry: InvitationEntry) {
    if (!mayWrite) {
      return null
    }

    return (
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
    )
  }

  const accountCards: readonly TableCard[] = (people.data ?? []).map((person) => ({
    key: person.userId,
    title: '',
    form: (
      <div className="flex flex-col gap-2 text-[15px]">
        <Who name={person.name} email={person.email} you={person.userId === you} inBox />
        <span className="font-semibold">{rolesInWords(namesOf(person.roles, available))}</span>
        {additions ? (
          <span className="text-[14px]">
            <span className="text-ink-muted">{additions.title}: </span>
            {additions.ofMember(person)}
          </span>
        ) : null}
        <span className="text-[13px] text-ink-muted">
          <StateOf person={person} roles={available} />
          {', '}
          {lastSeen(person)}
        </span>
        <div>{actionsOf(person)}</div>
      </div>
    ),
  }))

  // How an invitation travels is worth a column once one can go by mail.
  // Where every link is passed on by hand, the column would say so in every
  // row.
  const showWay = byMail || (invitations.data ?? []).some((entry) => entry.mail !== null)

  const invitationCards: readonly TableCard[] = (invitations.data ?? []).map((entry) => ({
    key: entry.id,
    title: entry.name,
    sub: (
      <>
        {entry.email} · {rolesInWords(namesOf(entry.roles, available))} · bis{' '}
        {date(entry.expiresAt)}
        {additions ? (
          <span className="mt-0.5 block">
            {additions.title}: {additions.ofInvitation(entry)}
          </span>
        ) : null}
        {showWay ? <span className="mt-0.5 block">{deliveryInWords(entry.mail)}</span> : null}
      </>
    ),
    actions: withdrawButton(entry),
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
            disabled={creating || !ready}
            onClick={() => {
              setTrouble(null)
              setLink(null)
              setMailedTo(null)
              setCreating(true)
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
          title={sentences.accounts}
          caption={sentences.accounts}
          cards={accountCards}
          note={accountsNote(available, own.lastLead, additions?.note ?? null)}
        >
          <thead>
            <tr>
              <Column>Zugang</Column>
              <Column className="w-[150px]">Rolle</Column>
              {additions ? <Column className={additions.column}>{additions.title}</Column> : null}
              <Column className="w-[190px]">Zustand</Column>
              <Column numeric className="w-[176px]">
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
                <Cell className="text-[13px] font-semibold">
                  {rolesInWords(namesOf(person.roles, available))}
                </Cell>
                {additions ? (
                  <Cell className="text-[13px]">{additions.ofMember(person)}</Cell>
                ) : null}
                <Cell className="text-[13px]">
                  <span className="block">
                    <StateOf person={person} roles={available} />
                  </span>
                  <span className="block text-ink-faint">{lastSeen(person)}</span>
                </Cell>
                <Cell numeric>{actionsOf(person)}</Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}

      {children}

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
          note={byMail ? null : sentences.noMail}
        >
          <thead>
            <tr>
              <Column>Eingeladen</Column>
              <Column className="w-[150px]">Rolle</Column>
              {additions ? <Column className={additions.column}>{additions.title}</Column> : null}
              <Column className="w-[100px]">Gilt bis</Column>
              {showWay ? <Column className="w-[250px]">Weg</Column> : null}
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
                {additions ? (
                  <Cell className="text-[13px]">{additions.ofInvitation(entry)}</Cell>
                ) : null}
                <Cell className="text-[13px]">{date(entry.expiresAt)}</Cell>
                {showWay ? (
                  <Cell className="text-[13px]">{deliveryInWords(entry.mail)}</Cell>
                ) : null}
                <Cell numeric>{withdrawButton(entry)}</Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}

      {creating ? (
        <NewAccess
          roles={available}
          byMail={byMail}
          suggestedRole={suggestedRole}
          roleNotes={roleNotes}
          additions={additions}
          onDone={(made) => {
            setCreating(false)
            setLink(made.link)
            setMailedTo(made.link === null ? made.email : null)
            refresh()
          }}
          onClose={() => {
            setCreating(false)
          }}
        />
      ) : null}

      {edited ? (
        <EditAccess
          key={edited.userId}
          person={edited}
          roles={available}
          roleNotes={roleNotes}
          correction={own.correction}
          additions={additions}
          onSaved={refresh}
          onClose={() => {
            setEditing(null)
          }}
        />
      ) : null}

      {shown ? (
        <Dialog
          title={`Geräte von ${shown.name}`}
          onClose={() => {
            setDevicesOf(null)
          }}
        >
          <AccessDevices userId={shown.userId} name={shown.name} mayWrite={false} />
          <DialogActions>
            <Button
              onClick={() => {
                setDevicesOf(null)
              }}
            >
              Schließen
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}

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
 * Under the accounts: what the application says of its column, which roles
 * ask for a second factor, and whom nobody demotes. That a role asks for one
 * is said again in the dialog, at the moment it is picked.
 */
function accountsNote(
  roles: readonly RoleDefinition[],
  lastLead: string,
  ofTheColumn: string | null,
): string {
  const names = roles.filter((role) => role.secondFactor).map((role) => role.label)
  const last = names.at(-1)
  const secondFactor =
    last === undefined
      ? null
      : names.length === 1
        ? `Die Rolle ${last} verlangt einen zweiten Faktor.`
        : `Die Rollen ${names.slice(0, -1).join(', ')} und ${last} verlangen einen zweiten Faktor.`

  return [ofTheColumn, secondFactor, lastLead].filter(Boolean).join(' ')
}

/**
 * What a dialog holds of the application's part: where it stands, whether
 * somebody changed it, its fields, and what goes out.
 */
function useAdditions<Value>(
  additions: StaffAdditions<Value> | undefined,
  person: StaffEntry | null,
) {
  // Read once, as a form reads what it starts with. In a box of its own,
  // because what an application keeps may be nothing at all.
  const [held, setHeld] = useState(() =>
    additions ? { value: additions.startWith(person) } : null,
  )
  const [touched, setTouched] = useState(false)

  return {
    touched,
    fields(role: string | null): ReactNode {
      if (!additions || !held) {
        return null
      }

      return (
        <div role="group" aria-label={additions.title} className="flex flex-col gap-2">
          <FieldLabel>{additions.title}</FieldLabel>
          {additions.fields({
            value: held.value,
            role,
            onChange: (next) => {
              setHeld({ value: next })
              setTouched(true)
            },
          })}
        </div>
      )
    },
    toSend(role: string): unknown {
      return additions && held ? additions.toSend(held.value, role) : undefined
    },
  }
}

/** The roles of the tenant as cards to pick one from, each with what it is for. */
function RoleCards({
  roles,
  notes,
  value,
  onChange,
}: {
  readonly roles: readonly RoleDefinition[]
  readonly notes: Readonly<Record<string, string>>
  readonly value: string | null
  readonly onChange: (key: string) => void
}) {
  return (
    <Choice
      label="Rolle"
      options={roles.map((role) => ({ value: role.key, label: role.label, note: notes[role.key] }))}
      value={value}
      onChange={onChange}
    />
  )
}

function Trouble({ children }: { readonly children: string | null }) {
  return children ? (
    <p role="alert" className="text-[13px] font-semibold text-conflict">
      {children}
    </p>
  ) : null
}

/** Name, address, the role and what the application keeps. The password is deliberately not here. */
function NewAccess<Value>({
  roles,
  byMail,
  suggestedRole,
  roleNotes,
  additions,
  onDone,
  onClose,
}: {
  /** The roles this tenant has. */
  readonly roles: readonly RoleDefinition[]
  readonly byMail: boolean
  readonly suggestedRole: string
  readonly roleNotes: Readonly<Record<string, string>>
  readonly additions: StaffAdditions<Value> | undefined
  readonly onDone: (made: { link: string | null; email: string }) => void
  readonly onClose: () => void
}) {
  const sentences = useStaffSentences()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  // Only a role the tenant has; without one the buttons wait for a pick.
  const [role, setRole] = useState<string | null>(
    roles.some((known) => known.key === suggestedRole) ? suggestedRole : null,
  )
  const beside = useAdditions(additions, null)
  const [trouble, setTrouble] = useState<string | null>(null)
  // Which way is being worked on, for the button that says so.
  const [working, setWorking] = useState<'link' | 'mail' | null>(null)
  // Which of the two buttons submitted the form. A ref and not state: the
  // click sets it and the submit that follows in the same moment reads it,
  // before React would have rendered a new value.
  const way = useRef<'link' | 'mail'>('link')

  async function submit() {
    if (role === null) {
      return
    }

    const send = way.current

    setWorking(send)
    setTrouble(null)

    try {
      const { link } = await invite({
        name,
        email,
        roles: [role],
        send,
        additions: beside.toSend(role),
      })

      onDone({ link, email: email.trim() })
    } catch (error) {
      setTrouble(saidWhy(error, 'Der Zugang ließ sich nicht anlegen.'))
      setWorking(null)
    }
  }

  return (
    <Dialog title="Zugang anlegen" width={640} onClose={onClose}>
      <form
        className="flex flex-col gap-2.5"
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
            autoFocus
            required
            starred
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
            starred
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
            }}
            hint="Damit meldet sich die Person später an."
          />
        </div>

        <RoleCards roles={roles} notes={roleNotes} value={role} onChange={setRole} />
        <SecondFactorWarning needed={role !== null && asksSecondFactor([role], roles)} />
        {beside.fields(role)}

        <SettingsText muted small>
          Die Person bekommt einen Link, der sieben Tage gilt und genau einmal funktioniert. Ihr
          Passwort wählt sie selbst; hier sieht es niemand.{byMail ? null : ` ${sentences.noMail}`}
        </SettingsText>
        <Trouble>{trouble}</Trouble>

        <DialogActions>
          <Button type="button" disabled={working !== null} onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            type="submit"
            tone={byMail ? 'secondary' : 'primary'}
            disabled={working !== null || role === null}
            onClick={() => {
              way.current = 'link'
            }}
          >
            {working === 'link' ? 'Einen Moment' : 'Link erzeugen'}
          </Button>
          {byMail ? (
            <Button
              type="submit"
              tone="primary"
              disabled={working !== null || role === null}
              onClick={() => {
                way.current = 'mail'
              }}
            >
              {working === 'mail' ? 'Einen Moment' : 'Per E-Mail einladen'}
            </Button>
          ) : null}
        </DialogActions>
      </form>
    </Dialog>
  )
}

/**
 * The access of one person: name and address of the account, the role, what
 * the application keeps, and the devices.
 *
 * "Speichern" sends what was changed and nothing else. The account goes first
 * and to its own route; refused there, the role stays as it is, and the
 * dialog says why. A role that was not touched goes out as it is held, should
 * the application's part have changed: one request writes both or neither.
 */
function EditAccess<Value>({
  person,
  roles,
  roleNotes,
  correction,
  additions,
  onSaved,
  onClose,
}: {
  readonly person: StaffEntry
  /** The roles this tenant has. */
  readonly roles: readonly RoleDefinition[]
  readonly roleNotes: Readonly<Record<string, string>>
  readonly correction: string
  readonly additions: StaffAdditions<Value> | undefined
  /** After each request that went through, so that the lists behind the dialog follow. */
  readonly onSaved: () => void
  readonly onClose: () => void
}) {
  // What goes out is what the tenant has a role for. A key in the membership
  // without one names nothing, and the server would refuse a change that
  // carried it along.
  const held = person.roles.filter((key) => roles.some((role) => role.key === key))
  const [name, setName] = useState(person.name)
  const [email, setEmail] = useState(person.email)
  // The role somebody picked here. Until then the dialog shows the one held.
  // Several are none of the cards: the row names them, they stay until one is
  // picked, and the application's part stands beside the first of them.
  const [picked, setPicked] = useState<string | null>(null)
  const shownRole = picked ?? (held.length === 1 ? (held[0] ?? null) : null)
  const role = picked ?? held[0] ?? null
  const beside = useAdditions(additions, person)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const nameChanged = name.trim() !== person.name
  const emailChanged = email.trim() !== person.email
  const roleChanged = picked !== null && !(held.length === 1 && held[0] === picked)

  async function save() {
    if (role === null) {
      return
    }

    setWorking(true)
    setTrouble(null)

    try {
      if (nameChanged || emailChanged) {
        await correctAccount(person.userId, {
          ...(nameChanged ? { name: name.trim() } : {}),
          ...(emailChanged ? { email: email.trim() } : {}),
        })
        onSaved()
      }

      if (roleChanged || beside.touched) {
        await setRoles(person.userId, picked === null ? held : [picked], beside.toSend(role))
        onSaved()
      }

      onClose()
    } catch (error) {
      setTrouble(saidWhy(error, 'Der Zugang ließ sich nicht ändern.'))
      setWorking(false)
    }
  }

  return (
    <Dialog title="Zugang bearbeiten" width={640} onClose={onClose}>
      <form
        className="flex flex-col gap-2.5"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <FieldLabel>Angaben</FieldLabel>
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
            hint="Damit meldet sich die Person an."
          />
        </div>
        <SettingsText muted small>
          {correction}
        </SettingsText>

        <RoleCards roles={roles} notes={roleNotes} value={shownRole} onChange={setPicked} />
        <SecondFactorWarning
          needed={
            asksSecondFactor(picked === null ? held : [picked], roles) &&
            !(person.twoFactorEnabled || person.hasPasskey)
          }
        />
        {beside.fields(role)}

        <AccessDevices userId={person.userId} name={person.name} mayWrite headed />
        <Trouble>{trouble}</Trouble>

        <DialogActions>
          <Button type="button" disabled={working} onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" tone="primary" icon={Check} disabled={working || role === null}>
            {working ? 'Einen Moment' : 'Speichern'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/**
 * The devices of somebody else, for the phone in the van that was broken
 * into, as a part of a dialog.
 *
 * Only the sessions that are working in this tenant. A session of the same
 * person in another tenant is none of this one's business, and the server
 * answers accordingly.
 */
function AccessDevices({
  userId,
  name,
  mayWrite,
  headed = false,
}: {
  readonly userId: string
  readonly name: string
  /** Whether whoever looks may sign a device out, which the list alone does not need. */
  readonly mayWrite: boolean
  /** With "Geräte" over the list, where the heading of the dialog does not say it. */
  readonly headed?: boolean
}) {
  const sentences = useStaffSentences()
  const entryName = useApplication().sentences.entry.name
  const queries = useQueryClient()
  const list = useQuery({
    queryKey: ['staff-devices', userId],
    queryFn: () => staffDevices(userId),
  })
  const [trouble, setTrouble] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState<{ sessionId: string; label: string } | null>(null)
  const revoke = useMutation({
    mutationFn: (sessionId: string) => revokeStaffDevice(userId, sessionId),
    onSuccess: () => {
      setSigningOut(null)
      void queries.invalidateQueries({ queryKey: ['staff-devices', userId] })
    },
    onError: (error) => {
      setSigningOut(null)
      setTrouble(saidWhy(error, 'Das Gerät ließ sich nicht abmelden.'))
    },
  })

  // How long a session holds is decided here, in the foundation, as under the
  // account; what the entry it was opened from is called, the application says.
  const sessionKind = (longLived: boolean) =>
    longLived ? `${entryName.site}, 30 Tage` : `${entryName.office}, 12 Stunden`

  return (
    <div role="group" aria-label="Geräte" className="flex flex-col gap-2">
      {headed ? <FieldLabel>Geräte</FieldLabel> : null}
      <Trouble>{trouble}</Trouble>
      {list.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : list.isError ? (
        <SettingsText muted>{saidWhy(list.error, 'Die Liste kam nicht an.')}</SettingsText>
      ) : list.data.length === 0 ? (
        <SettingsText muted>{sentences.noDevices}</SettingsText>
      ) : (
        <ul
          aria-label={sentences.devicesOf(name)}
          className="flex flex-col divide-y divide-line rounded-[4px] border border-line"
        >
          {list.data.map((entry) => {
            const label = deviceName(entry.userAgent)

            return (
              <li
                key={entry.sessionId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2"
              >
                <span className="min-w-0 grow">
                  <span className="block text-[14px] font-semibold">{label}</span>
                  <span className="block text-[13px] text-ink-muted">
                    {sessionKind(entry.longLived)}, angemeldet {moment(entry.signedInAt)}, läuft ab{' '}
                    {moment(entry.expiresAt)}
                  </span>
                </span>
                {mayWrite ? (
                  <Button
                    size="small"
                    tone="danger"
                    aria-label={`${label} abmelden`}
                    disabled={revoke.isPending}
                    onClick={() => {
                      setTrouble(null)
                      setSigningOut({ sessionId: entry.sessionId, label })
                    }}
                  >
                    Abmelden
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
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
    </div>
  )
}
