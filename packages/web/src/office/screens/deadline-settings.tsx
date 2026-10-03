import { actionsSentence, defaultResponsibleLabel, sourceWords } from '@opengewerk/domain'
import { Status } from '@opengewerk/platform-web'
import { DeadlineSettingsScreen as FoundationDeadlineSettingsScreen } from '@opengewerk/platform-web/office'

import { usePeople } from '../../app/tasks.js'
import type { DeadlineKindView } from '../../session/deadlines.js'

/** The title of a trade package, for the chip beside a kind that comes from one. */
const tradeTitles: Readonly<Record<string, string>> = { elektro: 'Elektro und PV' }

/**
 * The kinds of deadline and what the business sets for each (#283),
 * `einst_fristen()` of the canvas: the screen of the foundation (ADR 0010,
 * opengewerk-haustechnik#24) with the words of the business, the trade of a
 * kind beside its title, and the owner as whoever gets a deadline whose
 * person is blocked. The owner changes them, the office reads them.
 */
export function DeadlineSettingsScreen() {
  return (
    <FoundationDeadlineSettingsScreen<DeadlineKindView>
      rights={{ write: 'settings.write' }}
      usePeople={usePeople}
      responsibleLabel={defaultResponsibleLabel}
      intervalWords={(kind) => sourceWords[kind.source].interval}
      actionsSentence={(kind) => actionsSentence(kind.actions)}
      badge={(kind) =>
        kind.trade ? <Status tone="neutral">{tradeTitles[kind.trade] ?? kind.trade}</Status> : null
      }
      note="Eine einzelne Frist kann in der Liste „Fristen“ einen eigenen Vorlauf und eine andere verantwortliche Person bekommen. Ist die Person gesperrt, geht die Frist an den Inhaber."
    />
  )
}
