import { applicationRoleName, auditLanguage } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { auditVocabulary } from './audit-log.js'

// The change log of the business as the foundation is told it (ADR 0010).
// Whether every table and column has a name the server holds against the
// database; what is held here is what only this application can get wrong:
// the words of the office where the foundation may not say them itself.

const audit = auditLanguage(auditVocabulary)

describe('the change log in the words of the office', () => {
  it('calls a tenant a business and whoever runs the instance an operator', () => {
    expect(audit.tableLabel('tenants')).toBe('Betrieb')
    expect(audit.fieldLabel('customers', 'tenant_id')).toBe('Kunde, Betrieb')
    expect(audit.tableLabel('tenant_parameters')).toBe('Einstellung des Betriebs')
    expect(audit.fieldLabel('tenant_roles', 'leads')).toBe('Rolle, Führt den Betrieb')
    expect(audit.tableLabel('instance_operators')).toBe('Betreiber')
  })

  it('says the ways that name a business or an operator in its own words', () => {
    const way = (reason: string) => audit.way(reason, applicationRoleName).text

    expect(way('session.switch')).toBe('Wechsel in einen anderen Betrieb')
    expect(way('instance.tenant')).toBe('Betrieb für andere anlegen')
    expect(way('operator.cli')).toBe('Betreiber über die Kommandozeile')
    expect(way('deadline')).toBe('Von selbst, Fristen')
    expect(way('customer.write')).toBe('Kunden ändern')
  })

  it('names a contact by both names and a membership by its person', () => {
    expect(audit.titleFrom('contacts', { given_name: 'Sabine', family_name: 'Keller' })).toBe(
      'Sabine Keller',
    )
    expect(audit.titleFields('job_assignments')).toEqual(['user_id'])
    expect(audit.titleFields('memberships')).toEqual(['user_id'])
  })

  it('opens the log from the records the office has a screen for', () => {
    expect(audit.records).toEqual([
      'customers',
      'sites',
      'installations',
      'jobs',
      'documents',
      'articles',
      'suppliers',
    ])
    expect(audit.partsOf('documents').map((part) => part.table)).toContain('payments')
  })
})
