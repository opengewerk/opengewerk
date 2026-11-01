import { Button, ButtonLink, Confirm, Panel, Status } from '@opengewerk/platform-web'
import { date } from '@opengewerk/platform-web/format'
import { NoteBox } from '@opengewerk/platform-web/office'
import { SiteText } from '@opengewerk/platform-web/site'
import { Calendar, Check, Copy, RefreshCw } from 'lucide-react'

import { calendarWords as words, subscriptionOf, useCalendarFeed } from '../../app/calendar-feed.js'

/**
 * "Meine Termine": the own appointments in the calendar of the phone (#291),
 * at the foot of the list, as the boards "Meine Termine, Kalender-Abo" draw
 * it. "Im Kalender öffnen" asks the phone to subscribe; Google Kalender on
 * Android takes the address only in the browser, which the card says.
 */
export function SiteCalendarPanel() {
  const feed = useCalendarFeed()
  const setUp = feed.since !== null || feed.address !== null

  return (
    <Panel title="Kalender-Abo">
      <div className="flex flex-col gap-2.5">
        {setUp ? (
          feed.since !== null ? (
            <div>
              <Status tone="done" icon={Check}>
                {`Eingerichtet am ${date(feed.since)}`}
              </Status>
            </div>
          ) : null
        ) : (
          <>
            <SiteText size={16}>{words.siteAbout}</SiteText>
            <SiteText muted size={15}>
              {words.secret}
            </SiteText>
            <Button
              wide
              height={52}
              icon={Calendar}
              disabled={!feed.online || feed.busy || feed.loading}
              onClick={feed.make}
            >
              Adresse erstellen
            </Button>
          </>
        )}
        {feed.address !== null ? (
          <>
            <output
              aria-label="Deine Adresse"
              className="rounded-[5px] border border-line-strong bg-surface-sunken px-[11px] py-[9px] font-mono text-[15px] leading-[1.45] select-all [overflow-wrap:anywhere]"
            >
              {feed.address}
            </output>
            <ButtonLink
              tone="primary"
              wide
              height={52}
              icon={Calendar}
              href={subscriptionOf(feed.address)}
            >
              Im Kalender öffnen
            </ButtonLink>
            <Button
              wide
              height={52}
              icon={Copy}
              onClick={() => {
                void navigator.clipboard?.writeText(feed.address ?? '')
              }}
            >
              Adresse kopieren
            </Button>
            <NoteBox tone="waiting">{words.once}</NoteBox>
            <SiteText muted size={15}>
              {words.android}
            </SiteText>
            <SiteText muted size={15}>
              {words.fetch}
            </SiteText>
          </>
        ) : feed.since !== null ? (
          <>
            <SiteText muted size={15}>
              {words.gone}
            </SiteText>
            <Button
              wide
              height={52}
              icon={RefreshCw}
              disabled={!feed.online || feed.busy}
              onClick={() => {
                feed.ask('renew')
              }}
            >
              Neue Adresse
            </Button>
            <Button
              wide
              height={52}
              tone="danger"
              disabled={!feed.online || feed.busy}
              onClick={() => {
                feed.ask('end')
              }}
            >
              Abo beenden
            </Button>
          </>
        ) : null}
        {feed.online ? null : (
          <SiteText muted size={15}>
            {words.offline}
          </SiteText>
        )}
        {feed.trouble !== null ? (
          <p role="alert" className="m-0 text-[15px] font-semibold text-conflict">
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
