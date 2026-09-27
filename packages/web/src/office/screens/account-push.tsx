import { Bell, Send } from 'lucide-react'

import { usePush } from '../../app/push-state.js'
import { Button, Panel, Status } from '../../components/index.js'
import { date } from '../../app/format.js'
import { NoteBox } from '../kit.js'
import { SettingsText } from '../settings-frame.js'

/** Why this device cannot have push, in the words of the card. */
const blocked = {
  unsupported: 'Dieser Browser kann keine Push-Nachrichten empfangen.',
  install:
    'Auf dem iPhone und dem iPad kommen Push-Nachrichten nur, wenn OpenGewerk über „Zum Home-Bildschirm“ als App installiert ist. Dort, in der App, lassen sie sich hier einschalten.',
  denied:
    'Der Browser lässt für diese Seite keine Benachrichtigungen zu. Erlauben lassen sie sich in seinen Einstellungen zu dieser Seite, danach hier einschalten.',
} as const

/**
 * Push on this device and the occasions for every device (#284), as the card
 * "Benachrichtigungen" on the board "Konto" draws it: whether it is on here,
 * a test message, and which occasions come as push at all.
 */
export function PushPanel() {
  const push = usePush('office')
  const overview = push.overview

  return (
    <Panel title="Benachrichtigungen" roomy>
      <div className="flex flex-col gap-3">
        <SettingsText>
          Push-Nachrichten kommen auch, wenn OpenGewerk geschlossen ist. Sie sagen nur, was ansteht;
          Namen und Anschriften stehen erst in OpenGewerk.
        </SettingsText>

        {overview === undefined ? (
          <SettingsText muted>
            {push.failedToLoad ? 'Die Einstellungen kamen nicht an.' : 'Wird geladen.'}
          </SettingsText>
        ) : !overview.available ? (
          <NoteBox>
            Diese Instanz verschickt keine Push-Nachrichten, ihr fehlt der Schlüssel dafür. Der
            Betreiber bekommt ihn mit dem nächsten Start über „sh docker/start.sh“.
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
          Die Anlässe gelten für jedes Gerät, auf dem Push eingeschaltet ist. Auf dem iPhone und dem
          iPad kommen Push-Nachrichten nur, wenn OpenGewerk über „Zum Home-Bildschirm“ als App
          installiert ist.
        </p>
      </div>
    </Panel>
  )
}
