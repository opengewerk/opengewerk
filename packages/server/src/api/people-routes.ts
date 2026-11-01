import {
  leadOf,
  type Permission,
  qualificationCatalogue,
  qualificationDeadlineKind,
} from '@opengewerk/domain'
import {
  deadlineSettingsOf,
  type PeopleRights,
  type PeopleRoutes,
} from '@opengewerk/platform-server'

import {
  people,
  qualificationKinds,
  qualifications,
  workingTimes,
} from '../database/schema/index.js'
import { deadlineKinds } from '../deadlines/registry.js'

/**
 * The files of the people who work for the business (#287) on the routes of
 * the foundation (ADR 0016). Reading and keeping them is the owner's, with a
 * right of its own each; everybody reads their own file without one.
 */
export const peopleRights: PeopleRights<Permission> = {
  read: 'person.read',
  write: 'person.write',
}

const renewal = deadlineKinds.kind(qualificationDeadlineKind)

if (renewal === null) {
  throw new Error(`The deadline of a qualification is missing: ${qualificationDeadlineKind}`)
}

export const peopleRoutes: PeopleRoutes = {
  tables: { people, workingTimes, qualificationKinds, qualifications },
  kinds: qualificationCatalogue,
  // A qualification runs out from the day its deadline reminds of it, as the
  // business has set the lead for the kind.
  leadDays: async (tx) =>
    leadOf(renewal, (await deadlineSettingsOf(tx)).get(qualificationDeadlineKind) ?? null, null),
}
