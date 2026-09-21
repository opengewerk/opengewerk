import { describe, expect, it } from 'vitest'

import { sameValue } from './operation.js'
import { policyFor, syncPolicies } from './policy.js'

/**
 * The policies as a whole, where the merge tests look at one operation.
 *
 * What is held here is that a record made on a device can be worked on before
 * the server has ever seen it. That is the case offline work is for, and it
 * broke once already: a report created in a cellar refused its own first line,
 * because the gate asked for a status only the server sets.
 */

const policies = Object.entries(syncPolicies)

describe('a record a device creates', () => {
  it('knows the start of every reserved field its own gate asks', () => {
    for (const [entity, policy] of policies) {
      const gate = policy.onlyWhile

      if (policy.create && gate && policy.reserved?.includes(gate.field)) {
        expect(policy.createdAs?.[gate.field], `${entity}.${gate.field}`).toBeDefined()
      }
    }
  })

  it('knows the start of every reserved field a gate on another record asks', () => {
    for (const [entity, policy] of policies) {
      const gate = policy.gateFrom

      if (!gate) {
        continue
      }

      const parent = policyFor(gate.entity)

      expect(parent, `${entity} hangs on ${gate.entity}`).not.toBeNull()

      if (parent?.create && parent.reserved?.includes(gate.field)) {
        expect(parent.createdAs?.[gate.field], `${gate.entity}.${gate.field}`).toBeDefined()
      }
    }
  })

  it('starts inside its gate, or nothing could be written to it after creating it', () => {
    for (const [entity, policy] of policies) {
      const gate = policy.onlyWhile
      const start = gate ? policy.createdAs?.[gate.field] : undefined

      if (gate && start !== undefined) {
        expect(
          gate.values.some((value) => sameValue(value, start)),
          entity,
        ).toBe(true)
      }
    }
  })

  it('starts only in fields the server keeps for itself', () => {
    // A start for a field the device sends would quietly overrule what it
    // sent whenever the two are laid over each other in the wrong order.
    for (const [entity, policy] of policies) {
      for (const field of Object.keys(policy.createdAs ?? {})) {
        expect(policy.reserved ?? [], `${entity}.${field}`).toContain(field)
      }
    }
  })
})
