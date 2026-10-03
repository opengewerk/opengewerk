import {
  businessNameProblem,
  type Permission,
  permissionCatalogue,
  type RoleKey,
  shippedRoles,
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

// The authentication is the foundation's (ADR 0010): accounts, sessions, the
// second factor and passkeys, the first run, the one time link, who works in
// a business and the roles of a business as rows. What it cannot know is
// which rights this application has, which roles a business starts with, and
// what a business and its owner are called. This is where it is told, and
// where what needs telling is bound, so that the rest of the server asks one
// module and gets the rights and the roles of this application.

/** What the authentication is told about this application. */
export const access: AccessRules<Permission> = {
  catalogue: permissionCatalogue,
  // The three roles a business starts with, rows of its own from the moment
  // it comes into being. The owner leads: the first account gets that role,
  // it hands out the others, and ADR 0006 hangs the second factor on it.
  shippedRoles,
  // The same rule as when the owner changes the name later (#276).
  tenantNameProblem: businessNameProblem,
  sentences: {
    noTenantChosen: 'Es ist noch kein Betrieb gewählt. Bitte zuerst einen Betrieb auswählen.',
    noAccessToTenant: 'Kein Zugang zu diesem Betrieb.',
    blockedInTenant:
      'Dieser Zugang ist im Betrieb gesperrt. Der Inhaber kann ihn wieder freigeben.',
    alreadyWorksHere: 'Diese Adresse arbeitet schon in diesem Betrieb.',
    notAMember: 'Dieses Konto arbeitet nicht in diesem Betrieb.',
    noSuchSessionHere: 'Diese Sitzung gibt es in diesem Betrieb nicht.',
    lastLead:
      'Das ist der letzte Inhaber dieses Betriebs. Erst einen zweiten Inhaber einsetzen, ' +
      'sonst kann niemand mehr Zugänge verwalten.',
    unusableLink: {
      redeemed: 'Dieser Link wurde schon benutzt. Bitte im Betrieb einen neuen anfordern.',
      revoked: 'Dieser Link wurde zurückgezogen. Bitte im Betrieb nachfragen.',
      expired: 'Dieser Link ist abgelaufen. Bitte im Betrieb einen neuen anfordern.',
    },
    passkeyNotRecorded:
      'Der Passkey ließ sich nicht im Protokoll der Betriebe festhalten und ist deshalb ' +
      'nicht angelegt. Bitte noch einmal versuchen.',
    emptyInstance:
      'Diese Instanz ist noch leer: im Browser steht die Ersteinrichtung, die den ' +
      'Betrieb und den ersten Zugang anlegt.',
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
      noSuchTenant: (tenantId) =>
        `Den Betrieb ${tenantId} gibt es auf dieser Instanz nicht. Die Kennung eines ` +
        'Betriebs steht im Bereich der Instanz bei seinem Namen.',
    },
    // The area of the instance (#188) and further businesses (#142). Whoever
    // runs an instance is its "Betreiber" here, and a tenant a "Betrieb" with
    // an "Inhaber"; another application has other words for all three.
    instance: {
      alreadyOperator: 'Dieses Konto ist schon Betreiber.',
      notAnOperator: 'Dieses Konto ist kein Betreiber.',
      notOneself: 'Sich selbst entfernt kein Betreiber; das macht ein anderer.',
      lastOperator: 'Der letzte Betreiber bleibt.',
      tenantNameMissing: 'Der Name des Betriebs fehlt.',
      leadNameMissing: 'Der Name des Inhabers fehlt.',
      leadEmailNotOne: 'Die E-Mail-Adresse des Inhabers sieht nicht wie eine aus.',
      appointOperator: {
        usage:
          'Aufruf: appoint-operator <e-mail>\n' +
          'Das Konto muss es auf dieser Instanz schon geben. Es wird Betreiber und erreicht ' +
          'den Bereich der Instanz, sobald ein zweiter Faktor eingerichtet ist.',
        appointed: (email) => `${email} ist jetzt Betreiber dieser Instanz.`,
        secondFactor:
          'Für den Bereich der Instanz ist ein zweiter Faktor Pflicht, eine Authenticator-App ' +
          'oder ein Passkey. Beides wird unter „Konto“ eingerichtet; bis dahin bleibt der ' +
          'Bereich zu.',
        failed: 'Der Betreiber konnte nicht benannt werden.',
      },
      addTenant: {
        usage: 'Aufruf: add-tenant "<name des betriebs>" <e-mail> "<name des inhabers>"',
        createdWithAccount: (name, tenantId, email) =>
          `Der Betrieb "${name}" ist angelegt, Kennung ${tenantId}. ` +
          `${email} ist dort Inhaber, mit einem neuen Konto.`,
        createdForAccount: (name, tenantId, email) =>
          `Der Betrieb "${name}" ist angelegt, Kennung ${tenantId}. ` +
          `${email} ist dort Inhaber; das Konto gab es schon, das Passwort ist unverändert.`,
        secondFactor:
          'Für die Rolle "Inhaber" ist ein zweiter Faktor Pflicht. Die Anwendung fragt bei der ' +
          'ersten Anmeldung danach und richtet ihn ein.',
        failed: 'Der Betrieb konnte nicht angelegt werden.',
      },
    },
  },
}

/** The authentication of this application: under its name and in its words. */
export function createAuthentication(
  options: Omit<AuthenticationOptions, 'application' | 'access'>,
): Authentication {
  return createFor({ ...options, application, access })
}

/** The identity of a session, with the rights of this application. */
export class SessionIdentitySource extends SessionIdentities<Permission> {
  constructor(authentication: Authentication, database: Database) {
    super(authentication, database, access)
  }
}

/**
 * The first run of an instance: a business and its owner, who also runs the
 * instance from then on (#188).
 */
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
