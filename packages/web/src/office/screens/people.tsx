import { shippedRoles } from '@opengewerk/domain'
import {
  NewPersonScreen,
  PeopleScreen,
  type PeopleScreenProps,
  PersonScreen,
} from '@opengewerk/platform-web/office'
import { useParams } from '@tanstack/react-router'

import { useMay } from '../../app/queries.js'

/**
 * The files of the people who work for the business (#287) on the screens of
 * the foundation (ADR 0016), with the words of this application: the names
 * of its roles, that only the owner reads the files, and what the deadline
 * of a qualification does. Boards "Mitarbeiter" and "Akte" of the canvas,
 * version 93.
 */

const roleLabel = new Map(shippedRoles.map((role) => [role.key, role.label]))

const peopleScreen: Omit<PeopleScreenProps, 'mayWrite'> = {
  words: {
    role: (key) => roleLabel.get(key) ?? key,
    whoReads:
      'Die Akten liest und pflegt, wer das Recht dazu hat, von Haus aus nur der Inhaber. Jede Person liest ihre eigene unter „Konto“.',
    beforeExpiry:
      'Vor dem Ablauf einer Qualifikation entsteht eine Frist mit einer Aufgabe für den Inhaber, 60 Tage vorher, solange unter Einstellungen, Fristen nichts anderes steht.',
  },
  paths: {
    people: '/mitarbeiter',
    person: (personId) => `/mitarbeiter/${personId}`,
    newPerson: '/mitarbeiter/neu',
  },
}

export function PeopleList() {
  const mayWrite = useMay('person.write')

  return <PeopleScreen {...peopleScreen} mayWrite={mayWrite} />
}

export function PersonFileScreen() {
  const { personId } = useParams({ strict: false }) as { personId?: string }
  const mayWrite = useMay('person.write')

  return <PersonScreen {...peopleScreen} mayWrite={mayWrite} personId={personId ?? ''} />
}

export function NewPersonFileScreen() {
  return <NewPersonScreen {...peopleScreen} />
}
