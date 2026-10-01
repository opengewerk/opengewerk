import {
  businessNameProblem,
  requiresSecondFactor,
  type RoleKey,
  roleKeys,
} from '@opengewerk/domain'
import {
  type AccessRules,
  addStaffMember as addMember,
  type Authentication,
  type AuthenticationOptions,
  createAuthentication as createFor,
  type Database,
  type FirstRun,
  type FirstRunResult,
  SessionIdentitySource as SessionIdentities,
  setUpInstance as setUp,
  type StaffMember as Member,
} from '@opengewerk/platform-server'

import { application } from '../configuration.js'
import { instanceOperators } from '../database/schema/index.js'

// The authentication is the foundation's (ADR 0010): accounts, sessions, the
// second factor and passkeys, the first run and the one time link. What it
// cannot know is which roles this application has, which of them leads a
// business, and what a business and its owner are called. This is where it is
// told, and where what needs telling is bound, so that the rest of the server
// asks one module and gets the roles of this application.

/** What the authentication is told about this application. */
export const access: AccessRules<RoleKey> = {
  roles: roleKeys,
  // The owner is the only role that can hand out the others, so the first
  // account gets it, and ADR 0006 hangs the second factor on it.
  leadingRole: 'owner',
  requiresSecondFactor,
  // The same rule as when the owner changes the name later (#276).
  tenantNameProblem: businessNameProblem,
  // Whoever sets the instance up runs it (#188).
  firstAccount: async (tx, userId) => {
    await tx.insert(instanceOperators).values({ userId })
  },
  sentences: {
    noTenantChosen: 'Es ist noch kein Betrieb gewählt. Bitte zuerst einen Betrieb auswählen.',
    noAccessToTenant: 'Kein Zugang zu diesem Betrieb.',
    blockedInTenant:
      'Dieser Zugang ist im Betrieb gesperrt. Der Inhaber kann ihn wieder freigeben.',
    unusableLink: {
      redeemed: 'Dieser Link wurde schon benutzt. Bitte im Betrieb einen neuen anfordern.',
      revoked: 'Dieser Link wurde zurückgezogen. Bitte im Betrieb nachfragen.',
      expired: 'Dieser Link ist abgelaufen. Bitte im Betrieb einen neuen anfordern.',
    },
    passkeyNotRecorded:
      'Der Passkey ließ sich nicht im Protokoll der Betriebe festhalten und ist deshalb ' +
      'nicht angelegt. Bitte noch einmal versuchen.',
    addStaff: {
      usage: 'Aufruf: add-staff <betriebs-id> <e-mail> "<name>" <rolle> [<rolle> ...]',
      added: (email, tenantId, roles) =>
        `${email} ist im Betrieb ${tenantId} angelegt, Rollen: ${roles.join(', ')}.`,
      kept: (email, tenantId, roles) =>
        `${email} gab es schon auf dieser Instanz. Die Rollen im Betrieb ${tenantId} ` +
        `stehen jetzt auf: ${roles.join(', ')}. Das Passwort ist unverändert.`,
      secondFactor:
        'Für die Rolle "Inhaber" ist ein zweiter Faktor Pflicht. Die Anwendung fragt bei der ' +
        'ersten Anmeldung danach und richtet ihn ein.',
    },
  },
}

/** The authentication of this application: under its name and in its words. */
export function createAuthentication(
  options: Omit<AuthenticationOptions, 'application' | 'access'>,
): Authentication {
  return createFor({ ...options, application, access })
}

/** The identity of a session, with the roles of this application. */
export class SessionIdentitySource extends SessionIdentities<RoleKey> {
  constructor(authentication: Authentication, database: Database) {
    super(authentication, database, access)
  }
}

/** The first run of an instance: a business, its owner and the first operator. */
export function setUpInstance(
  authentication: Authentication,
  database: Database,
  firstRun: FirstRun,
): Promise<FirstRunResult> {
  return setUp(access, authentication, database, firstRun)
}

/** Somebody to put into a business, with roles the compiler knows. */
export type StaffMember = Member<RoleKey>

/** Puts a person into a business and gives them a way in. */
export function addStaffMember(
  authentication: Authentication,
  database: Database,
  member: StaffMember,
): Promise<{ userId: string; created: boolean }> {
  return addMember(authentication, database, member)
}
