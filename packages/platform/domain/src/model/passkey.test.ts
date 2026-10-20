import { describe, expect, it } from 'vitest'

import {
  hasSecondFactor,
  isSignInMethod,
  passkeyNameMaxLength,
  passkeyNameProblem,
} from './passkey.js'

describe('the name of a passkey', () => {
  it('is fine when there is one', () => {
    expect(passkeyNameProblem('Laptop Büro')).toBeNull()
    expect(passkeyNameProblem('  Telefon  ')).toBeNull()
  })

  it('is missing when it is empty or only spaces', () => {
    expect(passkeyNameProblem('')).toContain('braucht einen Namen')
    expect(passkeyNameProblem('   ')).toContain('braucht einen Namen')
  })

  it('may be as long as the limit and no longer, spaces around it not counted', () => {
    expect(passkeyNameProblem('x'.repeat(passkeyNameMaxLength))).toBeNull()
    expect(passkeyNameProblem(` ${'x'.repeat(passkeyNameMaxLength)} `)).toBeNull()
    expect(passkeyNameProblem('x'.repeat(passkeyNameMaxLength + 1))).toContain(
      `höchstens ${String(passkeyNameMaxLength)} Zeichen`,
    )
  })
})

describe('the second factor of a session', () => {
  it('is there when the session says so', () => {
    expect(hasSecondFactor({ secondFactor: true })).toBe(true)
  })

  it('is missing otherwise, also where nothing is said', () => {
    expect(hasSecondFactor({ secondFactor: false })).toBe(false)
    expect(hasSecondFactor({ secondFactor: null })).toBe(false)
    expect(hasSecondFactor({ secondFactor: undefined })).toBe(false)
  })
})

describe('the way a session began', () => {
  it('is one of the two', () => {
    expect(isSignInMethod('password')).toBe(true)
    expect(isSignInMethod('passkey')).toBe(true)
    expect(isSignInMethod('magic-link')).toBe(false)
    expect(isSignInMethod(null)).toBe(false)
  })
})
