import { Button, ButtonLink, Confirm, Panel, Status } from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import { NoteBox, SettingsText } from '@opengewerk/platform-web/office'
import { Calendar, Check, Copy, RefreshCw } from 'lucide-react'

import {
  calendarHow,
  calendarWords as words,
  subscriptionOf,
  useCalendarFeed,
} from '../../app/calendar-feed.js'

/**
 * "Konto": the own appointments in the own calendar (#291), `calendar_card()`
 * of the boards "Konto, Kalender-Abo": nothing yet, the address just made,
 * and set up. After "Benachrichtigungen", because both are how appointments
 * reach a person.
 */
export function CalendarPanel() {
  const feed = useCalendarFeed()
  const setUp = feed.since !== null || feed.address !== null

  return (
    <Panel title="Kalender-Abo" roomy>
      <div className="flex flex-col gap-3">
        {setUp ? (
          <div className="flex flex-wrap items-center gap-2.5">
            {feed.since !== null ? (
              <Status tone="done" icon={Check}>
                {`Eingerichtet am ${date(feed.since)}`}
              </Status>
            ) : null}
            <span className="grow" />
            <Button
              icon={RefreshCw}
              disabled={!feed.online || feed.busy}
              onClick={() => {
                feed.ask('renew')
              }}
            >
              Neue Adresse
            </Button>
            <Button
              size="small"
              tone="danger"
              disabled={!feed.online || feed.busy}
              onClick={() => {
                feed.ask('end')
              }}
            >
              Abo beenden
            </Button>
          </div>
        ) : (
          <>
            <SettingsText>{words.about}</SettingsText>
            <SettingsText muted>{words.secret}</SettingsText>
            <div>
              <Button
                tone="primary"
                icon={Calendar}
                disabled={!feed.online || feed.busy || feed.loading}
                onClick={feed.make}
              >
                Adresse erstellen
              </Button>
            </div>
          </>
        )}
        {feed.address !== null ? (
          <>
            <div className="flex flex-col gap-2">
              <div className="font-condensed text-label font-semibold uppercase tracking-[1.1px] text-ink-faint">
                Deine Adresse
              </div>
              <output
                aria-label="Deine Adresse"
                className="rounded-[5px] border border-line-strong bg-surface-sunken px-[11px] py-[9px] font-mono text-[13px] leading-[1.45] select-all [overflow-wrap:anywhere]"
              >
                {feed.address}
              </output>
              <div className="flex flex-wrap gap-2">
                <Button
                  tone="primary"
                  icon={Copy}
                  onClick={() => {
                    void navigator.clipboard?.writeText(feed.address ?? '')
                  }}
                >
                  Adresse kopieren
                </Button>
                <ButtonLink icon={Calendar} href={subscriptionOf(feed.address)}>
                  Im Kalender öffnen
                </ButtonLink>
              </div>
            </div>
            <NoteBox tone="waiting">{words.once}</NoteBox>
            <div className="flex flex-col gap-1.5">
              <div className="font-condensed text-label font-semibold uppercase tracking-[1.1px] text-ink-faint">
                So kommt sie in deinen Kalender
              </div>
              <ul className="m-0 flex list-disc flex-col gap-1 pl-[18px] text-[13px] leading-[1.45] text-ink-muted">
                {calendarHow.map(([name, how]) => (
                  <li key={name}>
                    <b className="font-semibold">{`${name}:`}</b> {how}
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : feed.since !== null ? (
          <SettingsText muted>{words.gone}</SettingsText>
        ) : null}
        {setUp ? <p className="m-0 text-[12px] text-ink-muted">{words.fetch}</p> : null}
        {feed.online ? null : <SettingsText muted>{words.offline}</SettingsText>}
        {feed.trouble !== null ? (
          <p role="alert" className="m-0 text-[13px] font-semibold text-conflict">
            {feed.trouble}
          </p>
        ) : null}
      </div>
      <Confirm
        open={feed.asking === 'renew'}
        title={words.renewTitle}
        confirm="Neue Adresse erstellen"
        tone="primary"
        busy={feed.busy}
        onConfirm={feed.make}
        onCancel={() => {
          feed.ask(null)
        }}
      >
        {words.renew}
      </Confirm>
      <Confirm
        open={feed.asking === 'end'}
        title={words.endTitle}
        confirm="Abo beenden"
        busy={feed.busy}
        onConfirm={feed.end}
        onCancel={() => {
          feed.ask(null)
        }}
      >
        {words.end}
      </Confirm>
    </Panel>
  )
}
