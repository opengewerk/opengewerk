import type { IsoDate } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import {
  reminderGroundProblem,
  reminderGroundText,
  reminderSentence,
  reminderWay,
} from './customer-reminder.js'

const day = (value: string) => value as IsoDate

describe('the way a customer is reminded', () => {
  it('belongs to the contract, by mail or else by a call', () => {
    expect(reminderWay(null, true, true)).toBe('mail')
    expect(reminderWay(null, true, false)).toBe('call')
    expect(reminderWay('existing_customer', true, false)).toBe('call')
  })

  it('needs a consent or a customer of the business without a contract, and goes nowhere with neither', () => {
    expect(reminderWay(null, false, true)).toBeNull()
    expect(reminderWay(null, false, false)).toBeNull()
    expect(reminderWay('consent', false, true)).toBe('mail')
    expect(reminderWay('consent', false, false)).toBe('call')
    expect(reminderWay('existing_customer', false, true)).toBe('mail')
  })

  it('calls a customer of the business only with a consent, since § 7 Abs. 3 UWG covers mail alone', () => {
    expect(reminderWay('existing_customer', false, false)).toBeNull()
  })

  it('stops for a customer who stopped them, a contract and all', () => {
    expect(reminderWay('objected', true, true)).toBeNull()
    expect(reminderWay('objected', true, false)).toBeNull()
    expect(reminderWay('objected', false, true)).toBeNull()
  })
})

describe('the sentence below a reminder', () => {
  it('names the contract it belongs to, before any ground', () => {
    expect(reminderSentence('existing_customer', 'WV-2026-0003')).toBe(
      'Diese Erinnerung gehört zu Ihrem Wartungsvertrag WV-2026-0003. Möchten Sie keine Erinnerungen mehr, genügt eine kurze Antwort auf diese E-Mail.',
    )
  })

  it('names the right to object of § 7 Abs. 3 Nr. 4 UWG for a customer of the business', () => {
    expect(reminderSentence('existing_customer', null)).toContain('jederzeit widersprechen')
    expect(reminderSentence('existing_customer', null)).toContain(
      'Übermittlungskosten nach den Basistarifen',
    )
  })

  it('names the withdrawal of a consent', () => {
    expect(reminderSentence('consent', null)).toContain('Einwilligung jederzeit widerrufen')
  })
})

describe('the ground of a customer', () => {
  it('reads as a fact of the record', () => {
    expect(reminderGroundText(null, null)).toBe('Nur zu einem Wartungsvertrag')
    expect(reminderGroundText('consent', day('2024-03-12'))).toBe('Einwilligung vom 12.03.2024')
    expect(reminderGroundText('existing_customer', day('2024-03-12'))).toBe(
      'Bestandskunde nach § 7 Abs. 3 UWG, seit 12.03.2024',
    )
    expect(reminderGroundText('objected', day('2026-11-02'))).toBe('Abbestellt am 02.11.2026')
  })

  it('is one of the list with its day, or none without one', () => {
    expect(reminderGroundProblem(null, null)).toBeNull()
    expect(reminderGroundProblem('consent', '2024-03-12')).toBeNull()
    expect(reminderGroundProblem('objected', '2026-11-02')).toBeNull()
    expect(reminderGroundProblem('newsletter', '2024-03-12')).not.toBeNull()
    expect(reminderGroundProblem('consent', null)).not.toBeNull()
    expect(reminderGroundProblem('consent', '12.03.2024')).not.toBeNull()
    expect(reminderGroundProblem(null, '2024-03-12')).not.toBeNull()
  })
})
