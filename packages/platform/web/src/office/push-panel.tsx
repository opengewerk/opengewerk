import { Bell, Send } from 'lucide-react'

import { useApplication } from '../application.js'
import { Button } from '../components/button.js'
import { Panel } from '../components/panel.js'
import { Status } from '../components/status.js'
import { date } from '../format.js'
import { usePush } from '../session/push-state.js'
import { NoteBox } from './kit.js'
import { SettingsText } from './settings.js'

/** What only an application can say on the card. */
export interface PushPanelWords {
  /**
   * The first sentences of the card: that a message comes while the
   * application is closed, and what it says and leaves out.
   */
  readonly about: string
  /** Who gets the key an instance without one is missing, and how: a sentence. */
  readonly keyMissing: string
  /** Under the occasions, after the sentence that they hold for every device. */
  readonly footnote?: string
}

export interface PushPanelProps {
  /** The entry this card is shown in, as the application names it to the server. */
  readonly entry: string
  readonly words: PushPanelWords
}

/**
 * Push on this device and the occasions for every device (#284), as a card of
 * the account: whether it is on here, a test message, and which occasions
 * come as push at all. Which occasions there are the server says, the
 * application names them there (ADR 0010).
 */
export function PushPanel({ entry, words }: PushPanelProps) {
  const { name } = useApplication()
  const push = usePush(entry)
  const overview = push.overview

  /** Why this device cannot have push, in the words of the card. */
  const blocked = {
    unsupported: 'Dieser Browser kann keine Push-Nachrichten empfangen.',
    install: `Auf dem iPhone und dem iPad kommen Push-Nachrichten nur, wenn ${name} über „Zum Home-Bildschirm“ als App installiert ist. Dort, in der App, lassen sie sich hier einschalten.`,
    denied:
      'Der Browser lässt für diese Seite keine Benachrichtigungen zu. Erlauben lassen sie sich in seinen Einstellungen zu dieser Seite, danach hier einschalten.',
  } as const

  return (
    <Panel title="Benachrichtigungen" roomy>
      <div className="flex flex-col gap-3">
        <SettingsText>{words.about}</SettingsText>

        {overview === undefined ? (
          <SettingsText muted>
            {push.failedToLoad ? 'Die Einstellungen kamen nicht an.' : 'Wird geladen.'}
          </SettingsText>
        ) : !overview.available ? (
          <NoteBox>
            {`Diese Instanz verschickt keine Push-Nachrichten, ihr fehlt der Schlüssel dafür. ${words.keyMissing}`}
          </NoteBox>
        ) : (
          <>
            {push.here ? (
              <div className="flex flex-wrap items-center gap-2.5">
                <Status tone="done">Auf diesem Gerät eingeschaltet</Status>
                <span className="text-[13px] text-ink-muted">
                  {`${push.here.label}, seit ${date(push.here.since)}`}
                </span>
                <div className="grow" />
                <Button icon={Send} disabled={push.busy} onClick={push.test}>
                  Probenachricht senden
                </Button>
                <Button disabled={push.busy} onClick={push.turnOff}>
                  Ausschalten
                </Button>
              </div>
            ) : push.blocker !== null ? (
              <NoteBox>{blocked[push.blocker]}</NoteBox>
            ) : (
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[13px] text-ink-muted">Auf diesem Gerät ausgeschaltet.</span>
                <div className="grow" />
                <Button tone="primary" icon={Bell} disabled={push.busy} onClick={push.turnOn}>
                  Auf diesem Gerät einschalten
                </Button>
              </div>
            )}

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 font-condensed text-label font-semibold uppercase tracking-[1.1px] text-ink-faint">
                Anlässe
              </legend>
              <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                {overview.occasions.map((occasion) => (
                  <label key={occasion.key} className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-copper-solid"
                      checked={occasion.on}
                      onChange={(event) => {
                        push.choose(occasion.key, event.target.checked)
                      }}
                    />
                    <span className="text-[14px] leading-[1.4]">
                      {occasion.label}
                      <span className="block text-[13px] text-ink-muted">{occasion.about}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        )}

        {push.said ? (
          <p
            role={push.said.tone === 'conflict' ? 'alert' : 'status'}
            className={
              push.said.tone === 'conflict'
                ? 'text-[13px] font-semibold text-conflict'
                : 'text-[13px] font-semibold text-done'
            }
          >
            {push.said.text}
          </p>
        ) : null}

        <p className="text-[12px] leading-[1.5] text-ink-muted">
          {`Die Anlässe gelten für jedes Gerät, auf dem Push eingeschaltet ist.${
            words.footnote ? ` ${words.footnote}` : ''
          }`}
        </p>
      </div>
    </Panel>
  )
}
