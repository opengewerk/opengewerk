import { describe, expect, it } from 'vitest'

import { missingPermission, permissionLabel, permissions } from './authorization.js'

/**
 * A refusal over a missing right is read by a person on a screen (#271), so it
 * says what the access may not do, in words, and never the key of the right.
 */
describe('a right in words', () => {
  it('has a label for every right, and none of them looks like a key', () => {
    for (const permission of permissions) {
      const label = permissionLabel[permission]

      expect(label.trim(), permission).not.toBe('')
      expect(label, permission).not.toMatch(/[a-z]\.[a-z]/)
      expect(label.charAt(0), permission).toBe(label.charAt(0).toUpperCase())
    }
  })

  it('says what the access may not do and who can change that', () => {
    expect(missingPermission('document.issue')).toBe(
      'Belege festschreiben darf dieser Zugang nicht. Der Inhaber vergibt die Rollen unter „Zugänge“.',
    )
  })
})
