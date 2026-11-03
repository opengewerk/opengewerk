import { describe, expect, it } from 'vitest'

import { invitationOf } from './calendar-feed.js'
import {
  appointmentWhen,
  filledMailSubject,
  filledMailText,
  type MailFacts,
  mailSnippetProblem,
  shippedMails,
} from './confirmation-mail.js'

const facts: MailFacts = {
  kunde: 'Klaus Lehmann',
  termin: 'Mittwoch, 04.11.2026, 13:30 bis 15:00 Uhr',
  auftrag: 'AU-2026-0233 Sicherung Küche löst aus',
  benutzer: 'Britta Kohm',
  briefkopf: 'Elektro Kohm GmbH\nHauptstraße 103',
}

describe('the placeholders of a snippet for mails (#315)', () => {
  it('fill in the name of the customer for {kunde}', () => {
    expect(filledMailText('Guten Tag {kunde},', facts)).toBe('Guten Tag Klaus Lehmann,')
  })

  it('fill in day and time of the appointment for {termin}', () => {
    expect(filledMailText('Ihr Termin: {termin}.', facts)).toBe(
      'Ihr Termin: Mittwoch, 04.11.2026, 13:30 bis 15:00 Uhr.',
    )
  })

  it('fill in number and designation of the job for {auftrag}', () => {
    expect(filledMailText('Auftrag {auftrag}', facts)).toBe(
      'Auftrag AU-2026-0233 Sicherung Küche löst aus',
    )
  })

  it('fill in who sends for {benutzer}, and drop its line in an automatic mail', () => {
    expect(filledMailText('Viele Grüße\n{benutzer}', facts)).toBe('Viele Grüße\nBritta Kohm')
    expect(
      filledMailText('Viele Grüße\n{benutzer}\nGesendet von {benutzer}\nIhr Team', {
        ...facts,
        benutzer: null,
      }),
    ).toBe('Viele Grüße\nIhr Team')
  })

  it('fill in the letterhead for {briefkopf}', () => {
    expect(filledMailText('{briefkopf}', facts)).toBe('Elektro Kohm GmbH\nHauptstraße 103')
  })

  it('leave braces that name no placeholder, and keep a subject on one line', () => {
    expect(filledMailText('{preis} und {kunde}', facts)).toBe('{preis} und Klaus Lehmann')
    expect(filledMailSubject('Von {briefkopf}', facts)).toBe(
      'Von Elektro Kohm GmbH, Hauptstraße 103',
    )
  })

  it('make the shipped texts read without a brace left', () => {
    for (const mail of Object.values(shippedMails)) {
      expect(filledMailText(mail.text, facts)).not.toMatch(/[{}]/)
      expect(filledMailSubject(mail.subject, facts)).not.toMatch(/[{}]/)
    }
  })
})

describe('the time of an appointment in a mail', () => {
  it('is the day and both clock times in German time', () => {
    expect(
      appointmentWhen(new Date('2026-11-04T12:30:00Z'), new Date('2026-11-04T14:00:00Z')),
    ).toBe('Mittwoch, 04.11.2026, 13:30 bis 15:00 Uhr')
  })

  it('names both days when it runs over midnight, in summer time as well', () => {
    expect(
      appointmentWhen(new Date('2026-07-01T20:00:00Z'), new Date('2026-07-02T04:00:00Z')),
    ).toBe('Mittwoch, 01.07.2026, 22:00 Uhr bis Donnerstag, 02.07.2026, 06:00 Uhr')
  })
})

describe('a snippet for mails', () => {
  it('names its occasion and has a subject on one line', () => {
    expect(mailSnippetProblem('mail', 'appointment_arranged', 'Ihr Termin am {termin}')).toBeNull()
    expect(mailSnippetProblem('mail', null, 'Ihr Termin')).toContain('Anlass')
    expect(mailSnippetProblem('mail', 'birthday', 'Ihr Termin')).toContain('Anlass')
    expect(mailSnippetProblem('mail', 'job_received', 'Zwei\nZeilen')).toContain('einer Zeile')
    expect(mailSnippetProblem('mail', 'job_received', 'x'.repeat(201))).toContain('200')
  })

  it('is the only one with an occasion', () => {
    expect(mailSnippetProblem('intro', null, 'Dank für die Anfrage')).toBeNull()
    expect(mailSnippetProblem('intro', 'job_received', 'Dank')).toContain('nur ein Textbaustein')
  })
})

describe('the calendar file of a confirmation', () => {
  const entry = {
    uid: 'a-1',
    revision: 2,
    createdAt: new Date('2026-11-03T09:00:00Z'),
    changedAt: new Date('2026-11-03T10:00:00Z'),
    startsAt: new Date('2026-11-04T12:30:00Z'),
    endsAt: new Date('2026-11-04T14:00:00Z'),
    rrule: null,
    exdates: [],
    title: 'Sicherung Küche löst aus',
    place: 'Eppendorfer Weg 112, 20259 Hamburg',
    description: null,
    url: null,
  }
  const parties = {
    organizer: { name: 'Elektro Kohm GmbH', address: 'info@elektro-kohm.de' },
    attendee: { name: 'Klaus Lehmann', address: 'klaus.lehmann@example.com' },
  }

  it('asks the calendar to take the appointment, with organizer and the customer', () => {
    // Unfolded, as a calendar reads it.
    const file = invitationOf(entry, parties, false).replaceAll('\r\n ', '')

    expect(file).toContain('METHOD:REQUEST\r\n')
    expect(file).toContain('UID:a-1@opengewerk\r\n')
    expect(file).toContain('SEQUENCE:1\r\n')
    expect(file).toContain('DTSTART;TZID=Europe/Berlin:20261104T133000\r\n')
    expect(file).toContain('ORGANIZER;CN="Elektro Kohm GmbH":mailto:info@elektro-kohm.de\r\n')
    expect(file).toContain('mailto:klaus.lehmann@example.com')
    expect(file).not.toContain('STATUS:CANCELLED')
  })

  it('takes it out again when cancelled, under the same identity', () => {
    const file = invitationOf({ ...entry, revision: 3 }, parties, true).replaceAll('\r\n ', '')

    expect(file).toContain('METHOD:CANCEL\r\n')
    expect(file).toContain('UID:a-1@opengewerk\r\n')
    expect(file).toContain('SEQUENCE:2\r\n')
    expect(file).toContain('STATUS:CANCELLED\r\n')
  })
})
