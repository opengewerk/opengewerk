import { describe, expect, it } from 'vitest'

import { SecretKey } from './key.js'

/**
 * The seal on the credentials a tenant hands the instance. What is held on
 * to is what makes it a seal: the value is not in what is stored, and what is
 * stored opens only with the same key and for the same tenant and purpose.
 */

const key = SecretKey.from('s'.repeat(64))
const context = '0199a3c0-0000-7000-8000-000000000001:mailbox'

describe('a sealed secret', () => {
  it('opens again with the same key and for the same context', () => {
    const sealed = key.seal(context, 'das-passwort-zum-postfach')

    expect(key.unseal(context, sealed)).toBe('das-passwort-zum-postfach')
  })

  it('does not carry the value in what is stored', () => {
    const sealed = key.seal(context, 'das-passwort-zum-postfach')

    expect(sealed).not.toContain('passwort')
    expect(sealed).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/)
  })

  it('looks different every time, so two tenants with one password cannot be told apart', () => {
    expect(key.seal(context, 'gleich')).not.toBe(key.seal(context, 'gleich'))
  })

  it('opens with no other key, for no other tenant and no other purpose', () => {
    const sealed = key.seal(context, 'geheim')

    expect(SecretKey.from('a'.repeat(64)).unseal(context, sealed)).toBeNull()
    expect(key.unseal(context.replace('0001:', '0002:'), sealed)).toBeNull()
    expect(key.unseal(context.replace('mailbox', 'locker'), sealed)).toBeNull()
  })

  it('does not open once it has been changed, and says so rather than throwing', () => {
    const [version, iv, tag, body] = key.seal(context, 'geheim').split(':')
    const flipped = (body ?? '').startsWith('A')
      ? `B${(body ?? '').slice(1)}`
      : `A${(body ?? '').slice(1)}`

    expect(key.unseal(context, [version, iv, tag, flipped].join(':'))).toBeNull()
    expect(key.unseal(context, 'kein versiegelter Wert')).toBeNull()
  })
})
