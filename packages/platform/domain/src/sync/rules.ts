import type { ConflictReason } from './conflict.js'
import type { Operation, SyncValue } from './operation.js'
import { sameValue } from './operation.js'
import { keptByTheServer, type SyncPolicy } from './policy.js'

/** The record as it stands on the server, field by field, already flattened. */
export type RecordState = Readonly<Record<string, SyncValue>>

export type MergeResult =
  | { readonly outcome: 'apply'; readonly values: RecordState }
  | {
      readonly outcome: 'conflict'
      readonly reason: ConflictReason
      /** The fields it hangs on, empty when the whole record is the reason. */
      readonly fields: readonly string[]
    }
  | { readonly outcome: 'skip'; readonly reason: 'already_there' | 'nothing_to_do' }

/**
 * The rules of the sync of one application: its policies, and the questions
 * asked of them.
 *
 * All of it is decided here rather than in a server, and the reason is the
 * same one that keeps the model in this package: a device has to be able to
 * work out the same answer before it sends anything, so that it can show a
 * conflict rather than discover one. A rule that lives in the server can only
 * be asked over a network, which is the one thing that is missing.
 */
export interface SyncRules {
  /** The policies as the application wrote them, by entity. */
  readonly policies: Readonly<Record<string, SyncPolicy>>
  /** The entities a device knows about, in the order of the list. */
  readonly entities: readonly string[]
  /** The policy of an entity, or null for one this application does not sync. */
  readonly policyFor: (entity: string) => SyncPolicy | null
  /** True when this field is the server's to write, on this entity. */
  readonly isSetByServer: (entity: string, field: string) => boolean
  /**
   * What the server does with one operation, given what it currently holds.
   *
   * An operation applies whole or not at all. Two devices that edited
   * different fields of the same record both go through, which is the merge
   * on field level ADR 0005 asks for. As soon as one field really collides,
   * nothing of that operation lands and the whole intended change goes into
   * the conflict, where a person can see it side by side. Applying half of it
   * would leave a record that neither device ever meant.
   *
   * `parent` is the record this one hangs on, when the policy has a
   * `gateFrom`. Null when there is no parent to be found, which for a line
   * means that what it belongs to is gone and the line has nothing left to
   * belong to.
   */
  readonly decideMerge: (
    operation: Operation,
    current: RecordState | null,
    parent?: RecordState | null,
  ) => MergeResult
}

function wanted(operation: Operation): RecordState {
  return Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to]))
}

/**
 * Where a list of policies contradicts itself, one sentence each.
 *
 * What is held here is that a record made on a device can be worked on before
 * the server has ever seen it. That is the case offline work is for, and it
 * broke once already: a record created in a cellar refused its own first
 * line, because the gate asked for a state only the server sets.
 */
function contradictions(policies: Readonly<Record<string, SyncPolicy>>): string[] {
  const found: string[] = []

  for (const [entity, policy] of Object.entries(policies)) {
    const gate = policy.onlyWhile
    const start = gate ? policy.createdAs?.[gate.field] : undefined

    if (policy.create && gate && policy.reserved?.includes(gate.field) && start === undefined) {
      found.push(
        `${entity}: its gate asks "${gate.field}", which only the server writes, and createdAs names no start for it`,
      )
    }

    // Or nothing could be written to it after creating it.
    if (gate && start !== undefined && !gate.values.some((value) => sameValue(value, start))) {
      found.push(`${entity}: it starts with "${gate.field}" outside its own gate`)
    }

    // A start for a field the device sends would quietly overrule what it
    // sent whenever the two are laid over each other in the wrong order.
    for (const field of Object.keys(policy.createdAs ?? {})) {
      if (!policy.reserved?.includes(field)) {
        found.push(`${entity}: createdAs names "${field}", which a device sends itself`)
      }
    }

    const inherited = policy.gateFrom

    if (!inherited) {
      continue
    }

    const parent = Object.hasOwn(policies, inherited.entity)
      ? policies[inherited.entity]
      : undefined

    if (!parent) {
      found.push(`${entity}: it hangs on "${inherited.entity}", which is not in the list`)
    } else if (
      parent.create &&
      parent.reserved?.includes(inherited.field) &&
      parent.createdAs?.[inherited.field] === undefined
    ) {
      found.push(
        `${entity}: its gate asks "${inherited.entity}.${inherited.field}", which only the server writes, and createdAs there names no start for it`,
      )
    }
  }

  return found
}

/**
 * The rules of an application, made once from the list of its policies.
 *
 * Nothing registers itself anywhere: an application makes its rules and hands
 * them to whatever needs them, the server that applies an operation and the
 * client that judges one before it is sent. Two applications in one process,
 * as in a test, then never read each other's policies.
 *
 * A list that contradicts itself is refused here, when it is made, with every
 * contradiction named. Found later, it would be a record that cannot be
 * worked on in a cellar, and nothing but the cellar would show it.
 */
export function syncRules(policies: Readonly<Record<string, SyncPolicy>>): SyncRules {
  const problems = contradictions(policies)

  if (problems.length > 0) {
    throw new Error(`The sync policies contradict themselves. ${problems.join('. ')}.`)
  }

  // Asked by a name that arrives from a device, so by what the list holds
  // itself and not by what every object has: `constructor` is no entity.
  const policyFor = (entity: string): SyncPolicy | null =>
    Object.hasOwn(policies, entity) ? (policies[entity] ?? null) : null

  const isSetByServer = (entity: string, field: string): boolean =>
    keptByTheServer.includes(field) || (policyFor(entity)?.reserved?.includes(field) ?? false)

  const decideMerge = (
    operation: Operation,
    current: RecordState | null,
    parent: RecordState | null = null,
  ): MergeResult => {
    const policy = policyFor(operation.entity)

    if (!policy) {
      return { outcome: 'conflict', reason: 'unknown_entity', fields: [] }
    }

    const inherited = policy.gateFrom

    if (inherited) {
      // Before everything else, including creating. A line arriving for
      // something that was fixed in the meantime is refused whether it is new
      // or a change, because in both cases it would add something to what is
      // already closed.
      if (!parent) {
        return { outcome: 'conflict', reason: 'record_missing', fields: [inherited.reference] }
      }

      if (!inherited.values.some((value) => sameValue(parent[inherited.field], value))) {
        return { outcome: 'conflict', reason: 'record_is_fixed', fields: [inherited.field] }
      }
    }

    // Before everything else, and deliberately before the branch for creating.
    // A field the server reserves is refused whether the record already exists
    // or is arriving for the first time; the first time is the easier way in.
    //
    // A conflict and not an error, unlike the columns the server keeps
    // everywhere: a device that sets the state of a record wanted something
    // sensible and may not have it. That belongs in front of a person, with
    // what the device intended still attached, and it has to be an answer the
    // device could have worked out itself before sending.
    const reserved = operation.patches
      .filter((patch) => policy.reserved?.includes(patch.field))
      .map((patch) => patch.field)

    if (reserved.length > 0) {
      return { outcome: 'conflict', reason: 'set_by_server', fields: reserved }
    }

    if (operation.kind === 'create') {
      // An entity a device only reads: what the server makes, a device cannot
      // make as well.
      if (!policy.create) {
        return { outcome: 'conflict', reason: 'online_only', fields: [] }
      }

      // The id came from the device before there was a network, so a record
      // that is already there under that id is this very operation, arriving
      // twice. The recorded operation ids catch the ordinary repeat; this
      // catches the half finished one, where the row landed and the receipt
      // did not.
      return current
        ? { outcome: 'skip', reason: 'already_there' }
        : { outcome: 'apply', values: wanted(operation) }
    }

    if (!current) {
      return { outcome: 'conflict', reason: 'record_missing', fields: [] }
    }

    // Deleted counts as not there, and this is the half of `record_missing`
    // that could never be reached: nothing is ever removed for real, so a row
    // is found whatever state it is in. Without this, a change to a deleted
    // record is answered with "applied" and lands on a row no list will ever
    // show again.
    //
    // It sits after the branch for creating on purpose. Creating has to keep
    // finding the deleted row, because that is what makes a repeated create a
    // `skip` instead of a primary key collision.
    if (!sameValue(current['deletedAt'], null)) {
      // Deleting something that is already deleted is not a disagreement, it
      // is a queue arriving twice. A conflict here would put an entry in front
      // of a person for every repeat of a transmission that did exactly what
      // it said.
      return operation.kind === 'delete'
        ? { outcome: 'skip', reason: 'nothing_to_do' }
        : { outcome: 'conflict', reason: 'record_missing', fields: [] }
    }

    if (policy.change === 'never') {
      return { outcome: 'conflict', reason: 'online_only', fields: [] }
    }

    const gate = policy.onlyWhile

    if (gate && !gate.values.some((value) => sameValue(current[gate.field], value))) {
      return { outcome: 'conflict', reason: 'record_is_fixed', fields: [gate.field] }
    }

    if (operation.kind === 'delete') {
      // A delete carries no patches, so the field by field comparison below
      // has nothing to work on and the version is the only thing left to ask.
      // It is also the right question: deleting touches every field at once,
      // so it collides with any change somebody made in the meantime, and that
      // is a decision for a person and not for whoever sent last.
      //
      // Without a base version the device made no claim about the state it
      // saw, so there is nothing to contradict and the delete stands.
      if (operation.baseVersion !== null && !sameValue(operation.baseVersion, current['version'])) {
        return { outcome: 'conflict', reason: 'changed_elsewhere', fields: [] }
      }

      return { outcome: 'apply', values: {} }
    }

    // The shortcut. Nothing has happened to the record since the device read
    // it, so there is nothing to compare field by field.
    if (operation.baseVersion !== null && operation.baseVersion === current['version']) {
      return { outcome: 'apply', values: wanted(operation) }
    }

    const collided = operation.patches
      .filter((patch) => !sameValue(current[patch.field], patch.from))
      .map((patch) => patch.field)

    if (collided.length > 0) {
      return { outcome: 'conflict', reason: 'changed_elsewhere', fields: collided }
    }

    const changing = operation.patches.filter((patch) => !sameValue(patch.from, patch.to))

    if (changing.length === 0) {
      return { outcome: 'skip', reason: 'nothing_to_do' }
    }

    return { outcome: 'apply', values: wanted(operation) }
  }

  return { policies, entities: Object.keys(policies), policyFor, isSetByServer, decideMerge }
}
