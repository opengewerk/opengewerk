import type {
  IsoDate,
  PersonLevel,
  PersonStanding,
  QualificationKind,
  QualificationStanding,
} from '@opengewerk/platform-domain'

import { request } from '../sync/transport.js'

/**
 * The routes of the files of the people (ADR 0016, opengewerk#287) as the
 * screens of the office call them: everybody with a file and what runs out,
 * one file with its working times and qualifications, what the office keeps
 * of it, and the own file of whoever asks. A working time is in minutes per
 * weekday.
 */

/** The account of a file: who signs in with it, and the roles in this tenant. */
export interface FileAccount {
  readonly userId: string
  readonly name: string
  readonly email: string
  readonly roles: readonly string[]
}

/** A file as the list shows it. */
export interface PersonSummary {
  readonly id: string
  readonly name: string
  readonly userId: string | null
  readonly joinedOn: IsoDate | null
  readonly leftOn: IsoDate | null
  readonly standing: PersonStanding
  readonly account: FileAccount | null
  /** The minutes a week of the working time that holds today; null without one. */
  readonly weekMinutes: number | null
  readonly qualifications: {
    readonly valid: number
    readonly expiring: number
    readonly expired: number
  }
}

/** A working time of a file, from its day on. */
export interface WorkingTimeRow {
  readonly id: string
  readonly validFrom: IsoDate
  readonly mondayMinutes: number
  readonly tuesdayMinutes: number
  readonly wednesdayMinutes: number
  readonly thursdayMinutes: number
  readonly fridayMinutes: number
  readonly saturdayMinutes: number
  readonly sundayMinutes: number
  readonly weekMinutes: number
  /** Whether it is the one that holds today. */
  readonly holdsToday: boolean
  /** Whether its day has begun, after which it stays as it is. */
  readonly begun: boolean
}

/** A qualification of a file, with the label and level of its kind and how it stands today. */
export interface QualificationRow {
  readonly id: string
  readonly kindKey: string | null
  readonly ownKindId: string | null
  readonly validUntil: IsoDate | null
  readonly note: string | null
  readonly certificateSha256: string | null
  readonly kindLabel: string
  readonly kindLevel: PersonLevel | null
  readonly standing: QualificationStanding
}

/** One file, as the office and the person themself read it. */
export interface PersonFile {
  readonly id: string
  readonly name: string
  readonly userId: string | null
  readonly joinedOn: IsoDate | null
  readonly leftOn: IsoDate | null
  readonly standing: PersonStanding
  readonly account: FileAccount | null
  /** How many days before its last day a qualification counts as running out. */
  readonly leadDays: number
  readonly workingTimes: readonly WorkingTimeRow[]
  readonly qualifications: readonly QualificationRow[]
}

/** A kind the tenant adds to those of the catalogue. */
export interface OwnKindRow {
  readonly id: string
  readonly label: string
  readonly level: PersonLevel
}

export interface QualificationKinds {
  readonly catalogue: readonly QualificationKind[]
  readonly own: readonly OwnKindRow[]
}

const at = (personId: string) => `/people/${encodeURIComponent(personId)}`

export function peopleOf(): Promise<PersonSummary[]> {
  return request<PersonSummary[]>('/people')
}

export function personOf(personId: string): Promise<PersonFile> {
  return request<PersonFile>(at(personId))
}

/** The own file of whoever asks; null where they have none here. */
export async function ownFile(): Promise<PersonFile | null> {
  return (await request<PersonFile | null>('/people/mine')) ?? null
}

/** The accounts of the tenant that belong to no file yet. */
export function freeAccounts(): Promise<FileAccount[]> {
  return request<FileAccount[]>('/people/accounts')
}

export function newPerson(fields: Readonly<Record<string, unknown>>): Promise<{ id: string }> {
  return request<{ id: string }>('/people', { method: 'POST', body: JSON.stringify(fields) })
}

export function changePerson(
  personId: string,
  fields: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  return request(at(personId), { method: 'PATCH', body: JSON.stringify(fields) })
}

export function addWorkingTime(
  personId: string,
  fields: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  return request(`${at(personId)}/working-times`, {
    method: 'POST',
    body: JSON.stringify(fields),
  })
}

export function changeWorkingTime(
  personId: string,
  timeId: string,
  fields: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  return request(`${at(personId)}/working-times/${encodeURIComponent(timeId)}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  })
}

export function removeWorkingTime(personId: string, timeId: string): Promise<unknown> {
  return request(`${at(personId)}/working-times/${encodeURIComponent(timeId)}`, {
    method: 'DELETE',
  })
}

export function addQualification(
  personId: string,
  fields: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  return request(`${at(personId)}/qualifications`, {
    method: 'POST',
    body: JSON.stringify(fields),
  })
}

export function changeQualification(
  personId: string,
  qualificationId: string,
  fields: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  return request(`${at(personId)}/qualifications/${encodeURIComponent(qualificationId)}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  })
}

export function removeQualification(personId: string, qualificationId: string): Promise<unknown> {
  return request(`${at(personId)}/qualifications/${encodeURIComponent(qualificationId)}`, {
    method: 'DELETE',
  })
}

export function qualificationKindsOf(): Promise<QualificationKinds> {
  return request<QualificationKinds>('/qualification-kinds')
}

export function newOwnKind(fields: {
  readonly label: string
  readonly level: PersonLevel
}): Promise<OwnKindRow> {
  return request<OwnKindRow>('/qualification-kinds', {
    method: 'POST',
    body: JSON.stringify(fields),
  })
}
