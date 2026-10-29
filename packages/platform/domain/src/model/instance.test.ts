import { describe, expect, it } from 'vitest'

import { tenantStorageProblem } from './instance.js'

/**
 * The budget of a tenant in the file store as somebody types it (B9 of the
 * security audit): whole gigabytes, or nothing for no limit.
 */
describe('the budget of a tenant in the file store', () => {
  it('takes whole gigabytes and nothing, and nothing else', () => {
    for (const fine of ['', '   ', '1', '50', ' 200 ', '1000000']) {
      expect(tenantStorageProblem(fine)).toBeNull()
    }

    for (const wrong of ['0', '5,5', '5.5', '-1', 'viel', '1e3']) {
      expect(tenantStorageProblem(wrong)).toBe(
        'Eine ganze Zahl von Gigabyte, mindestens 1, oder nichts für ohne Grenze.',
      )
    }

    expect(tenantStorageProblem('1000001')).toBe('Höchstens 1.000.000 GB.')
  })
})
