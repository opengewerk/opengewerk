import { contactEntity, type ContactRules, contactTextFields } from '@opengewerk/platform-domain'

import type { SyncCheck } from '../sync/apply.js'
import type { RecordRule } from '../sync/record-rules.js'

/**
 * The rules over the fields of a contact, for the record rules of an
 * application whose devices make or change contacts (`recordRulesCheck`).
 *
 * One rule per text, each the rule a form and the routes ask as well
 * (`personProblems`): the family name no contact does without, and what the
 * application finds wrong beside. And one over the parents together: a
 * contact on several of them is refused with the sentence of the application.
 * Whose mistake a broken rule is, the record rules decide, the same way for
 * every rule: a device that makes the contact or sets every field of the rule
 * sent something its own form refuses.
 *
 * A contact on none of its parents is not among these, see
 * `contactWithoutParent`.
 */
export function contactRecordRules(rules: ContactRules): readonly RecordRule[] {
  return [
    ...contactTextFields.map((field): RecordRule => ({
      fields: [field],
      problem: (at) => rules.personProblems({ [field]: at(field) })[field] ?? null,
    })),
    {
      fields: rules.parents,
      problem: (at) =>
        rules.parentProblem(
          Object.fromEntries(rules.parents.map((field) => [field, at(field)])),
        ) === 'several'
          ? rules.parentText.several
          : null,
    },
  ]
}

/**
 * A contact that names none of its parents, judged as it would stand
 * afterwards: what the operation sets, over the row it lands on.
 *
 * Not a mistake of the form, which takes the parent from the screen it stands
 * on, but a record without the one it must have, like any record whose parent
 * is gone: a conflict about this one operation, with every field a parent
 * could stand in. Left to the check of the application in the database, it
 * would take the whole transmission along.
 */
export function contactWithoutParent<Sender>(rules: ContactRules): SyncCheck<Sender> {
  return ({ operation, values, current }) => {
    if (operation.entity !== contactEntity || operation.kind === 'delete') {
      return null
    }

    const standing = Object.fromEntries(
      rules.parents.map((field) => [field, field in values ? values[field] : current?.[field]]),
    )

    return rules.parentProblem(standing) === 'none'
      ? { kind: 'conflict', reason: 'record_missing', fields: [...rules.parents] }
      : null
  }
}
