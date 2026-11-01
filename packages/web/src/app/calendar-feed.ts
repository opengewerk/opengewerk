import { RequestRefused, useSyncStatus } from '@opengewerk/platform-web/sync'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { endCalendar, makeCalendar, ownCalendar, ownCalendarKey } from '../session/calendar-feed.js'

/**
 * The card "Kalender-Abo" (#291), in the office under "Konto" and on site
 * under "Meine Termine", as the boards "Konto, Kalender-Abo" and "Meine
 * Termine, Kalender-Abo" draw it. What it says is the same in both places;
 * the two screens dress it.
 *
 * The address is in this card only right after it was made, as the link of an
 * invitation is: the server keeps its hash. Leaving the screen loses it, and
 * whoever needs it again makes a new one.
 */

export const calendarWords = {
  about:
    'Deine Termine aus der Plantafel in deinem eigenen Kalender, etwa Google Kalender, Apple Kalender oder Outlook. ' +
    'Der Kalender liest nur; geändert wird ein Termin weiter in OpenGewerk.',
  siteAbout: 'Deine Termine im Kalender deines Telefons, nur lesend.',
  secret:
    'Wer die Adresse kennt, sieht deine Termine mit Kunde und Anschrift. Gib sie nicht weiter.',
  once: 'Die Adresse steht nur jetzt hier. Brauchst du sie später wieder, erstellst du eine neue; die alte hört dann auf.',
  gone: 'Die Adresse steht nicht mehr hier. Ist sie verloren gegangen oder bei jemand anderem, erstelle eine neue: die alte hört sofort auf.',
  fetch:
    'Dein Kalender holt Änderungen selbst ab, Google Kalender oft erst nach Stunden. Neue, verschobene und entfallene ' +
    'Termine meldet OpenGewerk sofort per Push.',
  android:
    'Auf Android mit Google Kalender: Adresse kopieren und im Browser unter „Weitere Kalender“, „Per URL“ ' +
    'einfügen, oder mit der App ICSx⁵.',
  offline: 'Zum Einrichten braucht es Netz.',
  renewTitle: 'Neue Adresse erstellen?',
  renew:
    'Die bisherige Adresse hört sofort auf. Kalender, die sie abonniert haben, bekommen keine Termine mehr, bis du dort die neue einträgst.',
  endTitle: 'Abo beenden?',
  end: 'Die Adresse hört sofort auf. Kalender, die sie abonniert haben, leeren sich beim nächsten Abruf.',
}

/** How the address goes into a calendar, calendar by calendar. */
export const calendarHow: readonly (readonly [string, string])[] = [
  [
    'Google Kalender',
    'im Browser unter „Weitere Kalender“, „Per URL“ einfügen. Danach steht er auch in der App auf dem Telefon.',
  ],
  ['Apple Kalender', '„Im Kalender öffnen“, oder unter „Ablage“, „Neues Kalenderabonnement“.'],
  ['Outlook', '„Kalender hinzufügen“, „Aus dem Internet abonnieren“.'],
  ['Android ohne Google', 'mit der App ICSx⁵.'],
]

/**
 * The address as a subscription: `webcal:` opens the calendar of the device
 * with the question whether to subscribe, where one answers to it.
 */
export function subscriptionOf(address: string): string {
  return address.replace(/^https?:\/\//, 'webcal://')
}

export type CalendarQuestion = 'renew' | 'end' | null

/** Where the card stands, and what it can do. */
export function useCalendarFeed() {
  const queries = useQueryClient()
  const { online } = useSyncStatus()
  const own = useQuery({ queryKey: ownCalendarKey, queryFn: ownCalendar, enabled: online })
  const [address, setAddress] = useState<string | null>(null)
  const [asking, setAsking] = useState<CalendarQuestion>(null)
  const [trouble, setTrouble] = useState<string | null>(null)

  const refused = (error: unknown, otherwise: string) => {
    setTrouble(error instanceof RequestRefused ? error.message : otherwise)
  }

  const make = useMutation({
    mutationFn: makeCalendar,
    onSuccess: (made) => {
      setAddress(made.address)
      setAsking(null)
      queries.setQueryData(ownCalendarKey, { since: made.since })
    },
    onError: (error) => {
      setAsking(null)
      refused(error, 'Die Adresse ließ sich nicht erstellen. Ist der Server erreichbar?')
    },
  })

  const end = useMutation({
    mutationFn: endCalendar,
    onSuccess: () => {
      setAddress(null)
      setAsking(null)
      queries.setQueryData(ownCalendarKey, { since: null })
    },
    onError: (error) => {
      setAsking(null)
      refused(error, 'Das Abo ließ sich nicht beenden. Ist der Server erreichbar?')
    },
  })

  return {
    online,
    loading: online && own.isPending,
    since: own.data?.since ?? null,
    address,
    asking,
    trouble,
    busy: make.isPending || end.isPending,
    ask: (question: CalendarQuestion) => {
      setTrouble(null)
      setAsking(question)
    },
    make: () => {
      setTrouble(null)
      make.mutate()
    },
    end: () => {
      setTrouble(null)
      end.mutate()
    },
  }
}
