import type { NavigationGroup } from '@opengewerk/platform-web/office'
import { accountQuery } from '@opengewerk/platform-web/session'
import { text, useRecords } from '@opengewerk/platform-web/sync'
import { useQuery } from '@tanstack/react-query'
import {
  Calendar,
  CalendarClock,
  Clock,
  File,
  House,
  Package,
  SquareCheck,
  TextAlignStart,
  Truck,
  Users,
  Zap,
} from 'lucide-react'
import { useMemo } from 'react'

import { documentStatusOf, taskStatusOf } from '../app/labels.js'
import { useMay } from '../app/queries.js'

/**
 * What the office offers, in the groups of the canvas: the records a business
 * keeps, the work it does and its material. The frame of the foundation draws
 * them beside every screen and adds the two places at the foot that are
 * visited rather than worked in, the exchange with the server and the
 * settings (ADR 0010).
 *
 * An entry that somebody may not use is left out, and a group without an
 * entry goes with its title. A courtesy and not the gate: the routes behind
 * every screen ask the membership on every request.
 */
export function useNavigation(): readonly NavigationGroup[] {
  // Whoever reads documents reads the texts they are written from.
  const readsDocuments = useMay('document.read')
  const readsTasks = useMay('task.read')
  const readsDeadlines = useMay('deadline.read')
  const readsTime = useMay('time.read')
  const readsArticles = useMay('article.read')
  const readsSuppliers = useMay('supplier.read')
  const mine = useOpenTasksOfMine()
  const drafts = useRecords('documents').filter(
    (document) => documentStatusOf(document) === 'draft',
  ).length

  return [
    {
      title: 'Stammdaten',
      entries: [
        { to: '/', label: 'Kunden', icon: Users, also: ['/kunden'] },
        { to: '/objekte', label: 'Objekte', icon: House },
        {
          to: '/anlagen',
          label: 'Anlagen',
          icon: Zap,
          also: ['/verteiler', '/stromkreise', '/wechselrichter', '/strings', '/pruefprotokolle'],
        },
        ...(readsDocuments
          ? [{ to: '/textbausteine', label: 'Textbausteine', icon: TextAlignStart }]
          : []),
      ],
    },
    {
      title: 'Arbeit',
      entries: [
        { to: '/auftraege', label: 'Aufträge', icon: Calendar },
        ...(readsDocuments
          ? [
              {
                to: '/belege',
                label: 'Belege',
                icon: File,
                // The drafts, what is written and not yet out, as the canvas
                // counts beside "Belege" in the colour of what waits.
                ...(drafts > 0
                  ? {
                      badge: {
                        value: drafts,
                        tone: 'waiting' as const,
                        spoken: drafts === 1 ? 'ein Entwurf' : `${String(drafts)} Entwürfe`,
                      },
                    }
                  : {}),
              },
            ]
          : []),
        ...(readsTasks
          ? [
              {
                to: '/aufgaben',
                label: 'Aufgaben',
                icon: SquareCheck,
                ...(mine > 0
                  ? {
                      badge: {
                        value: mine,
                        tone: 'waiting' as const,
                        spoken:
                          mine === 1 ? 'eine für dich offen' : `${String(mine)} für dich offen`,
                      },
                    }
                  : {}),
              },
            ]
          : []),
        ...(readsDeadlines ? [{ to: '/fristen', label: 'Fristen', icon: CalendarClock }] : []),
        ...(readsTime ? [{ to: '/zeiten', label: 'Zeiterfassung', icon: Clock }] : []),
      ],
    },
    // The articles and where they come from (#296), a group of their own as
    // the module "Material" of the concept, which the store joins later.
    {
      title: 'Material',
      entries: [
        ...(readsArticles ? [{ to: '/artikel', label: 'Artikel', icon: Package }] : []),
        ...(readsSuppliers ? [{ to: '/lieferanten', label: 'Lieferanten', icon: Truck }] : []),
      ],
    },
  ]
}

/**
 * What waits for the person signed in, as "Deine Aufgaben" on the task screen
 * counts it: open, and theirs. Read from the local store, so the figure is
 * there without a network and moves as soon as a task is done.
 */
function useOpenTasksOfMine(): number {
  const account = useQuery(accountQuery)
  const tasks = useRecords('tasks')
  const me = account.data?.userId

  return useMemo(
    () =>
      me
        ? tasks.filter(
            (task) => taskStatusOf(task) === 'open' && text(task, 'assigneeUserId') === me,
          ).length
        : 0,
    [tasks, me],
  )
}
