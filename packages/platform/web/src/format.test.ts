import { describe, expect, it } from 'vitest'

import {
  amount,
  centsAsInput,
  clockTime,
  date,
  euros,
  fileSize,
  moment,
  parseEuros,
  parseQuantity,
  percent,
  sinceThen,
  today,
} from './format.js'

/**
 * Reading a number the way it is typed in Germany. The cases are the ones a
 * price field meets in an office: a thousands separator, a slip on an English
 * keyboard, a euro sign pasted along, and the figures that must be refused
 * rather than guessed at.
 */
describe('a typed amount', () => {
  it('reads the comma as the decimal separator and dots as thousands', () => {
    expect(parseEuros('1.234,56')).toBe(123456)
    expect(parseEuros('1234,56')).toBe(123456)
    expect(parseEuros('49,9')).toBe(4990)
    expect(parseEuros('12')).toBe(1200)
  })

  it('takes a single dot as a decimal point, unless three digits follow it', () => {
    expect(parseEuros('2.5')).toBe(250)
    expect(parseQuantity('2.5')).toBe(2500)
    expect(parseQuantity('1.234')).toBe(1_234_000)
  })

  it('ignores spaces, a no-break space and a euro sign', () => {
    expect(parseEuros('1 234,56 €')).toBe(123456)
    expect(parseEuros(`1${String.fromCharCode(0xa0)}234,56`)).toBe(123456)
  })

  it('keeps a sign, and never a negative zero', () => {
    expect(parseEuros('-50')).toBe(-5000)
    expect(Object.is(parseEuros('-0'), 0)).toBe(true)
  })

  it('refuses what it cannot read instead of reading part of it', () => {
    for (const typed of ['', 'zwölf', '1,2,3', '12,345', '1e3', '--5']) {
      expect(parseEuros(typed)).toBeNull()
    }
  })

  it('reads a quantity to three places and not more', () => {
    expect(parseQuantity('0,125')).toBe(125)
    expect(parseQuantity('0,1255')).toBeNull()
  })

  it('refuses a figure the database could not hold', () => {
    expect(parseEuros('21.474.836,47')).toBe(2_147_483_647)
    expect(parseEuros('21.474.836,48')).toBeNull()
  })

  it('writes cents back the way they are read', () => {
    expect(parseEuros(centsAsInput(123456))).toBe(123456)
  })
})

describe('the rest of the formatting', () => {
  it('writes a rate the way the printed document does', () => {
    expect(percent(1900)).toBe('19 %')
    expect(percent(750)).toBe('7,5 %')
  })

  it('knows the day in Germany, not in UTC', () => {
    // Half past midnight in Berlin is still the evening before in UTC.
    expect(today(new Date('2026-09-20T22:30:00Z'))).toBe('2026-09-21')
  })

  it('writes a day as it is written and a moment as the day it was in Germany', () => {
    // A day of a record goes through no time zone, on no device.
    expect(date('2026-09-25')).toBe('25.09.2026')
    expect(date('2026-01-01')).toBe('01.01.2026')
    // The same half past midnight as above, the 21st and not the 20th.
    expect(date('2026-09-20T22:30:00Z')).toBe('21.09.2026')
    expect(date('')).toBe('')
    expect(date('kein Datum')).toBe('')
  })
})

describe('the size of a file', () => {
  it('is in bytes, kilobytes or megabytes, written the German way', () => {
    expect(fileSize(512)).toBe('512 Byte')
    expect(fileSize(340_400)).toBe('340 kB')
    expect(fileSize(1_234_567)).toBe('1,2 MB')
    expect(fileSize(25_000_000)).toBe('25 MB')
  })
})

describe('an amount and a quantity', () => {
  it('writes cents as euros, with the thousands and the sign the German way', () => {
    // The space before the sign is a no-break space, as `Intl` writes it.
    const space = String.fromCharCode(0xa0)

    expect(euros(0)).toBe(`0,00${space}€`)
    expect(euros(123456)).toBe(`1.234,56${space}€`)
    expect(euros(-995)).toBe(`-9,95${space}€`)
  })

  it('writes thousandths as a figure with no more places than it has', () => {
    expect(amount(2500)).toBe('2,5')
    expect(amount(1000)).toBe('1')
    expect(amount(1)).toBe('0,001')
    expect(amount(1_234_567)).toBe('1.234,567')
  })
})

describe('a moment', () => {
  it('is written with its day and its time, and as nothing when it is none', () => {
    const at = new Date(2026, 8, 25, 17, 10)

    expect(clockTime(at)).toBe('17:10')
    expect(moment(at)).toBe('25.09.2026, 17:10')
    expect(moment(null)).toBe('')
    expect(moment('kein Moment')).toBe('')
    expect(clockTime(new Date('kein Moment'))).toBe('')
  })
})

describe('how long ago something was', () => {
  const now = new Date('2026-09-25T15:10:00Z')
  const before = (seconds: number) => new Date(now.getTime() - seconds * 1000)

  it('is said in words, and the coarser the longer ago', () => {
    expect(sinceThen(null, now)).toBe('noch nie')
    expect(sinceThen(before(20), now)).toBe('gerade eben')
    expect(sinceThen(before(60), now)).toBe('vor 1 Minute')
    expect(sinceThen(before(5 * 60), now)).toBe('vor 5 Minuten')
    expect(sinceThen(before(3600), now)).toBe('vor 1 Stunde')
    expect(sinceThen(before(5 * 3600), now)).toBe('vor 5 Stunden')
    expect(sinceThen(before(3 * 86_400), now)).toBe('am 22.09.2026')
  })
})
