import type { Operation, RecordState } from '@opengewerk/platform-domain'

import type { SyncCheck, SyncRefusal } from './apply.js'

/**
 * A rule over the fields of one record, the way a check in the database holds
 * it: the fields it reads, and the sentence for a record that breaks it.
 *
 * `at` gives a field as the record would stand afterwards: what the operation
 * sets, over what the server holds.
 */
export interface RecordRule {
  readonly fields: readonly string[]
  readonly problem: (at: (field: string) => unknown) => string | null
}

/** The rules of an application, per entity. */
export type RecordRules = Readonly<Record<string, readonly RecordRule[]>>

/**
 * The first rule an operation would break, judged on the record as it would
 * stand afterwards, and how to answer it; null when it breaks none.
 *
 * Whose mistake a broken rule is follows from the fields the operation sets,
 * and that is the same in every application. When it sets every field the
 * rule reads, or makes the record, the break is in its own values, and its
 * form asked the same rule of those values before anything was queued: a
 * mistake only the client can make, refused with the sentence for the whole
 * transmission. When it sets only some of them, the break comes from a value
 * it did not set, and the form judged by the value it had in front of it.
 * That value has changed since, so somebody else wrote the other half: two
 * changes that each fit and do not fit together, which is a conflict about
 * this one operation, with all the fields of the rule for a person to look at.
 *
 * Only the rules whose fields the operation touches: one it leaves alone
 * stands as the database already holds it.
 */
export function recordRuleRefusal(
  rules: RecordRules,
): (
  operation: Operation,
  values: Readonly<Record<string, unknown>>,
  current: RecordState | null,
) => SyncRefusal | null {
  return (operation, values, current) => {
    if (operation.kind === 'delete') {
      return null
    }

    const at = (field: string) => (field in values ? values[field] : current?.[field])
    // Own entries only: the name comes from a device, and "constructor" is
    // not an entity of anybody's.
    const own = Object.hasOwn(rules, operation.entity) ? rules[operation.entity] : undefined

    for (const rule of own ?? []) {
      const touched = rule.fields.filter((field) => field in values)

      if (operation.kind !== 'create' && touched.length === 0) {
        continue
      }

      const problem = rule.problem(at)

      if (problem === null) {
        continue
      }

      return operation.kind === 'create' || touched.length === rule.fields.length
        ? { kind: 'client', message: problem }
        : { kind: 'conflict', reason: 'changed_elsewhere', fields: rule.fields }
    }

    return null
  }
}

/** The same rules as a check of the sync, for the list of an application. */
export function recordRulesCheck<Sender>(rules: RecordRules): SyncCheck<Sender> {
  const refusal = recordRuleRefusal(rules)

  return ({ operation, values, current }) => refusal(operation, values, current)
}
