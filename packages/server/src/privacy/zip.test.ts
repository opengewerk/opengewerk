import { describe, expect, it } from 'vitest'

import { dosMoment, uniqueNames } from './zip.js'

/** The names in the archive of an answer (#318) and the moment it keeps. */
describe('the names in an archive', () => {
  it('stay in the archive: no way up, no root, no backslash', () => {
    expect(
      uniqueNames(['../../etc/passwd', '/dateien/a.jpg', 'dateien\\..\\b.jpg', './c.pdf']),
    ).toEqual(['etc/passwd', 'dateien/a.jpg', 'dateien/b.jpg', 'c.pdf'])
  })

  it('are unique, counting on before the ending', () => {
    expect(
      uniqueNames(['dateien/Foto.jpg', 'dateien/foto.JPG', 'dateien/Foto.jpg', 'Plan']),
    ).toEqual(['dateien/Foto.jpg', 'dateien/foto (2).JPG', 'dateien/Foto (3).jpg', 'Plan'])
  })

  it('lose control characters and what Windows refuses', () => {
    expect(uniqueNames([`dateien/Rech${String.fromCharCode(0)}nung: 1?.pdf`])).toEqual([
      'dateien/Rech_nung_ 1_.pdf',
    ])
  })

  it('give a nameless entry a name', () => {
    expect(uniqueNames(['', '..'])).toEqual(['Datei', 'Datei (2)'])
  })
})

describe('the moment of an archive', () => {
  it('is kept as DOS time, two seconds at a time, from 1980 on', () => {
    expect(dosMoment({ year: 2026, month: 11, day: 5, hour: 14, minute: 7, second: 59 })).toEqual({
      time: (14 << 11) | (7 << 5) | 29,
      date: (46 << 9) | (11 << 5) | 5,
    })
    expect(dosMoment({ year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 }).date).toBe(
      (1 << 5) | 1,
    )
  })
})
