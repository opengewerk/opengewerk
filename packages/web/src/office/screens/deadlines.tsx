import { defaultResponsibleLabel, sourceWords } from '@opengewerk/domain'
import { DeadlineListScreen as FoundationDeadlineListScreen } from '@opengewerk/platform-web/office'
import { useSync } from '@opengewerk/platform-web/sync'
import { Link } from '@tanstack/react-router'

import { usePeople } from '../../app/tasks.js'
import type { DeadlineKindView, DeadlineView } from '../../session/deadlines.js'

/** Where the source of a deadline is found in the office. */
function sourceHref(deadline: DeadlineView): string | null {
  if (deadline.source.documentId !== null) {
    return `/belege/${deadline.source.documentId}`
  }

  if (deadline.source.installationId !== null) {
    return `/anlagen/${deadline.source.installationId}`
  }

  return null
}

/** What the source is, in the list: "Angebot A-2026-0091". */
function sourceName(deadline: DeadlineView): string {
  return deadline.source.documentId !== null
    ? `Angebot ${deadline.source.label}`
    : deadline.source.label
}

/**
 * Everything that falls due, the list "Fristen" of section 1.2 (#283),
 * `fristen()` of the canvas: the screen of the foundation (ADR 0010,
 * opengewerk-haustechnik#24) with the customer of a deadline as a column of
 * its own, its source as a document or an installation, and the words of the
 * business. A deadline done, open again or given to somebody else closes,
 * opens or hands on its task on the server, and tasks travel by sync: the
 * screen fetches them right away instead of at the next change.
 */
export function DeadlineListScreen() {
  const client = useSync()

  return (
    <FoundationDeadlineListScreen<DeadlineView, DeadlineKindView>
      rights={{ read: 'deadline.read', write: 'deadline.write' }}
      words={{
        sub: 'Was fällig wird, nach Fälligkeit. Eine Frist folgt ihrer Quelle: folgt dem Angebot ein Beleg, entfällt sie.',
        searchPlaceholder: 'Kunde, Angebot, Anlage …',
        emptyOpen:
          'Gerade ist keine Frist offen. Sobald ein Angebot festgeschrieben ist, steht hier seine Wiedervorlage.',
      }}
      usePeople={usePeople}
      source={{ href: sourceHref, name: sourceName }}
      columns={[
        {
          header: 'Kunde',
          className: 'w-[190px] min-w-[150px]',
          text: (deadline) => deadline.customer?.name,
        },
      ]}
      cardFacts={(deadline) =>
        deadline.customer ? (
          <span>
            Kunde:{' '}
            <Link to={`/kunden/${deadline.customer.id}`} className="text-copper-text">
              {deadline.customer.name}
            </Link>
          </span>
        ) : null
      }
      responsibleLabel={defaultResponsibleLabel}
      anchorWords={(kind) => sourceWords[kind.source].anchor}
      afterChange={() => {
        void client.synchronise().catch(() => undefined)
      }}
    />
  )
}
