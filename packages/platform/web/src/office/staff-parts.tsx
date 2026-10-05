import type { RoleDefinition } from '@opengewerk/platform-domain'
import clsx from 'clsx'
import { Copy } from 'lucide-react'

import { useStaffSentences } from '../application.js'
import { Button } from '../components/button.js'
import { Field } from '../components/field.js'
import { Panel } from '../components/panel.js'
import { moment } from '../format.js'
import type { InvitationMail, StaffEntry } from '../session/session.js'
import { RequestRefused } from '../sync/transport.js'
import { SettingsText } from './settings.js'

// What both screens of "Zugänge" are built from: the one with the roles as
// boxes in the row (`staff.tsx`) and the one with a dialog for an access
// (`staff-dialogs.tsx`). An application binds one of them.

export function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/**
 * Name and address of a person, `who()` of the board, with "Sie" for the one
 * looking. In the table on one line each, as the board has them: an address
 * broken in the middle reads as two, and a table too narrow for it scrolls in
 * its frame (#218). In a box on a phone it breaks where it has to.
 */
export function Who({
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
export function namesOf(
  keys: readonly string[],
  roles: readonly RoleDefinition[],
): readonly string[] {
  return [
    ...roles.filter((role) => keys.includes(role.key)).map((role) => role.label),
    ...keys.filter((key) => !roles.some((role) => role.key === key)),
  ]
}

/** Whether one of these roles works only with a second factor, as the tenant has them. */
export function asksSecondFactor(
  keys: readonly string[],
  roles: readonly RoleDefinition[],
): boolean {
  return roles.some((role) => role.secondFactor && keys.includes(role.key))
}

/** Whether somebody can work, in the words of the column "Zustand". */
export function StateOf({
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
export function NewLink({ link, onDone }: { readonly link: string; readonly onDone: () => void }) {
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
export function deliveryInWords(mail: InvitationMail | null): string {
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
export function MailedInvitation({
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

/**
 * The sentence that turns a 403 nobody expected into something somebody chose.
 *
 * Whether a role asks for a second factor is in the row of the role, which is
 * what the server checks, so this says the same thing rather than a second
 * opinion about it. The day another role asks for one, this warning covers it
 * without anybody editing a screen.
 */
export function SecondFactorWarning({ needed }: { readonly needed: boolean }) {
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
