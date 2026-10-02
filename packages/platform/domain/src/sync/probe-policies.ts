import type { SyncPolicy } from './policy.js'

/**
 * The sync policies of an application that belongs to nobody, for the tests of
 * the foundation.
 *
 * A test that ran green with the entities of a real application would not
 * show that the mechanism knows none of them. So these are records no
 * application of the organisation has, one for every kind of rule there is:
 *
 * - `shelves` are master data: made on a device, corrected only with a
 *   connection.
 * - `notes` are what work produces: made and changed on a device, field by
 *   field.
 * - `parcels` are the same, with a number and a closing time only the server
 *   writes.
 * - `letters` may be written while they are a draft and not after, and the
 *   state, the number and the sending are the server's.
 * - `letter_lines` follow their letter: the gate sits on the parent.
 * - `letter_seals` are made on a device and never changed, on a draft only.
 * - `visits` are made on a device and never changed, and whose a visit is
 *   only the server says.
 * - `stamps` are made by the server alone; a device reads them.
 */
export const probePolicies: Readonly<Record<string, SyncPolicy>> = {
  shelves: { create: true, change: 'never' },
  notes: { create: true, change: 'merge' },
  parcels: { create: true, change: 'merge', reserved: ['number', 'closedAt'] },
  letters: {
    create: true,
    change: 'merge',
    onlyWhile: { field: 'status', values: ['draft'] },
    reserved: ['status', 'number', 'sentAt', 'sentBy'],
    createdAs: { status: 'draft' },
  },
  letter_lines: {
    create: true,
    change: 'merge',
    gateFrom: { reference: 'letterId', entity: 'letters', field: 'status', values: ['draft'] },
    reserved: ['total'],
  },
  letter_seals: {
    create: true,
    change: 'never',
    gateFrom: { reference: 'letterId', entity: 'letters', field: 'status', values: ['draft'] },
  },
  visits: { create: true, change: 'never', reserved: ['userId'] },
  stamps: { create: false, change: 'never' },
}
