import { describe, expect, it } from 'vitest'

import { packedOf, zipOf } from './probe-zip.js'
import { isZip, unzip, ZipRefused } from './zip.js'

const megabyte = 1_000_000
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

/** What reading the archive is refused with, or null where it is read. */
function refusalOf(read: () => unknown): string | null {
  try {
    read()

    return null
  } catch (error) {
    if (!(error instanceof ZipRefused)) {
      throw error
    }

    return error.message
  }
}

/** The archive with two bytes of its end changed: how many entries it says it has, or the like. */
function withEnd(archive: Uint8Array, at: number, value: number, bytes: 2 | 4 = 2): Uint8Array {
  const changed = new Uint8Array(archive)
  const view = new DataView(changed.buffer)

  if (bytes === 2) {
    view.setUint16(changed.length - 22 + at, value, true)
  } else {
    view.setUint32(changed.length - 22 + at, value, true)
  }

  return changed
}

describe('whether bytes begin like an archive', () => {
  it('is said of an archive with a file in it', () => {
    expect(isZip(zipOf([{ path: 'a.txt', bytes: 'a' }]))).toBe(true)
  })

  it('is not said of anything else', () => {
    expect(isZip(new TextEncoder().encode('Raum;Etage\n'))).toBe(false)
    expect(isZip(new TextEncoder().encode('PK'))).toBe(false)
    expect(isZip(new Uint8Array(0))).toBe(false)
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x03]))).toBe(false)
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x03, 0x05]))).toBe(false)
  })

  it('is read from where the bytes begin, not from where their memory does', () => {
    const archive = zipOf([{ path: 'a.txt', bytes: 'a' }])
    const behind = new Uint8Array(archive.length + 3)

    behind.set(archive, 3)

    expect(isZip(behind)).toBe(false)
    expect(isZip(behind.subarray(3))).toBe(true)
  })
})

describe('the files of an archive', () => {
  it('are its entries in the order of its directory, stored or deflated', () => {
    const entries = unzip(
      zipOf([
        { path: 'b.txt', bytes: 'zweite Datei' },
        { path: 'a.txt', bytes: 'erste Datei', stored: true },
        { path: 'leer.txt', bytes: '' },
        { path: 'leer-abgelegt.txt', bytes: '', stored: true },
      ]),
      megabyte,
    )

    expect(entries.map((entry) => [entry.path, text(entry.bytes)])).toEqual([
      ['b.txt', 'zweite Datei'],
      ['a.txt', 'erste Datei'],
      ['leer.txt', ''],
      ['leer-abgelegt.txt', ''],
    ])
  })

  it('keep the folders they lie in, and are not the folders themselves', () => {
    const entries = unzip(
      zipOf([
        { path: 'xl/', bytes: '', stored: true },
        { path: 'xl/workbook.xml', bytes: '<workbook/>' },
        { path: 'xl/worksheets/', bytes: '', stored: true },
        { path: 'xl/worksheets/sheet1.xml', bytes: '<worksheet/>' },
        { path: 'sheet1.xml', bytes: '<other/>' },
      ]),
      megabyte,
    )

    expect(entries.map((entry) => [entry.path, text(entry.bytes)])).toEqual([
      ['xl/workbook.xml', '<workbook/>'],
      ['xl/worksheets/sheet1.xml', '<worksheet/>'],
      ['sheet1.xml', '<other/>'],
    ])
  })

  it('are named in UTF-8 where the archive says so, and a byte a character where it does not', () => {
    const entries = unzip(
      zipOf([
        { path: 'Räume Süd.csv', bytes: 'a' },
        { path: 'Räume Nord.csv', bytes: 'b', legacyName: true },
      ]),
      megabyte,
    )

    expect(entries.map((entry) => entry.path)).toEqual(['Räume Süd.csv', 'Räume Nord.csv'])
  })

  it('hold exactly what was packed, byte for byte', () => {
    const bytes = new Uint8Array(70_000).map((_, index) => (index * 31 + (index >> 8)) % 256)
    const [deflated, stored] = unzip(
      zipOf([
        { path: 'deflated.bin', bytes },
        { path: 'stored.bin', bytes, stored: true },
      ]),
      megabyte,
    )

    expect(deflated?.bytes).toEqual(bytes)
    expect(stored?.bytes).toEqual(bytes)
  })

  it('are found from the directory where a packer wrote the sizes behind the data', () => {
    const entries = unzip(
      zipOf([
        { path: 'a.txt', bytes: 'erste Datei', streamed: true },
        { path: 'b.txt', bytes: 'zweite Datei', streamed: true, stored: true },
      ]),
      megabyte,
    )

    expect(entries.map((entry) => text(entry.bytes))).toEqual(['erste Datei', 'zweite Datei'])
  })

  it('are found behind a comment at the end of the archive', () => {
    const commented = zipOf([{ path: 'a.txt', bytes: 'erste Datei' }], 'Lieferung vom 02.10.2026')

    expect(unzip(commented, megabyte).map((entry) => text(entry.bytes))).toEqual(['erste Datei'])
  })

  it('are read from where the bytes begin, not from where their memory does', () => {
    const archive = zipOf([{ path: 'a.txt', bytes: 'erste Datei' }])
    const behind = new Uint8Array(archive.length + 7)

    behind.set(archive, 7)

    expect(unzip(behind.subarray(7), megabyte).map((entry) => text(entry.bytes))).toEqual([
      'erste Datei',
    ])
  })

  it('are none in an archive without entries', () => {
    expect(unzip(zipOf([]), megabyte)).toEqual([])
  })
})

describe('the entries of an archive that are wanted', () => {
  const archive = zipOf([
    { path: 'xl/workbook.xml', bytes: '<workbook/>' },
    { path: 'xl/media/image1.png', bytes: 'x'.repeat(5000) },
    { path: 'xl/worksheets/sheet1.xml', bytes: '<worksheet/>' },
    { path: 'workbook.xml', bytes: '<other/>' },
  ])

  it('are the only ones that are unpacked, asked for by their whole path', () => {
    const asked: string[] = []
    const entries = unzip(archive, megabyte, {
      wanted: (path) => {
        asked.push(path)

        return path === 'xl/workbook.xml' || path === 'xl/worksheets/sheet1.xml'
      },
    })

    expect(entries.map((entry) => [entry.path, text(entry.bytes)])).toEqual([
      ['xl/workbook.xml', '<workbook/>'],
      ['xl/worksheets/sheet1.xml', '<worksheet/>'],
    ])
    expect(asked).toEqual([
      'xl/workbook.xml',
      'xl/media/image1.png',
      'xl/worksheets/sheet1.xml',
      'workbook.xml',
    ])
  })

  it('are all of them where nothing is said', () => {
    expect(unzip(archive, megabyte)).toHaveLength(4)
  })

  it('are the only ones that count against the limit', () => {
    // The picture alone is over the limit, and so are the three others together.
    const wanted = (path: string) => path === 'xl/worksheets/sheet1.xml'

    expect(unzip(archive, 20, { wanted }).map((entry) => entry.path)).toEqual([
      'xl/worksheets/sheet1.xml',
    ])
    expect(refusalOf(() => unzip(archive, 20))).toBe('Das Archiv entpackt sich zu mehr als 0 MB.')
  })

  it('are the only ones that are looked at: what is wrong with another does not matter', () => {
    const mixed = zipOf([
      { path: 'gut.txt', bytes: 'gut' },
      { path: 'riesig.bin', bytes: packedOf({ piece: new Uint8Array(megabyte), times: 200 }) },
      { path: 'falsche-summe.txt', bytes: 'x', says: { checksum: 1 } },
      { path: 'gelogen.bin', bytes: 'x'.repeat(5000), says: { size: 5 } },
      { path: 'geheim.txt', bytes: 'x', says: { flags: 0x1 } },
      { path: 'anders.txt', bytes: 'x', says: { method: 93 } },
    ])

    expect(
      unzip(mixed, megabyte, { wanted: (path) => path === 'gut.txt' }).map((entry) => [
        entry.path,
        text(entry.bytes),
      ]),
    ).toEqual([['gut.txt', 'gut']])
    expect(unzip(mixed, megabyte, { wanted: () => false })).toEqual([])
  })
})

describe('how much an archive may unpack to', () => {
  it('is held for every entry, and said in megabytes', () => {
    const limit = 2 * megabyte

    expect(
      unzip(zipOf([{ path: 'voll.bin', bytes: new Uint8Array(limit) }]), limit).map(
        (entry) => entry.bytes.length,
      ),
    ).toEqual([limit])
    expect(
      refusalOf(() =>
        unzip(zipOf([{ path: 'mehr.bin', bytes: new Uint8Array(limit + 1) }]), limit),
      ),
    ).toBe('Das Archiv entpackt sich zu mehr als 2 MB.')
  })

  it('is held for all entries together', () => {
    const half = new Uint8Array(megabyte / 2)
    const two = [
      { path: 'a.bin', bytes: half },
      { path: 'b.bin', bytes: half, stored: true },
    ]

    expect(unzip(zipOf(two), megabyte)).toHaveLength(2)
    expect(refusalOf(() => unzip(zipOf([...two, { path: 'c.txt', bytes: 'x' }]), megabyte))).toBe(
      'Das Archiv entpackt sich zu mehr als 1 MB.',
    )
  })

  it('is said the way the caller says it where the caller names the limit', () => {
    const archive = zipOf([{ path: 'mehr.bin', bytes: new Uint8Array(megabyte + 1) }])

    expect(
      refusalOf(() => unzip(archive, megabyte, { tooLarge: 'Die Lieferung ist zu groß.' })),
    ).toBe('Die Lieferung ist zu groß.')
  })

  /**
   * Two bombs, a megabyte of archive each that unpacks to a gigabyte. The
   * honest one says so in its directory and is refused by the limit before a
   * byte is unpacked. The other says a kilobyte, which the limit does not
   * see: its unpacking stops at what the directory says, and it is refused as
   * damaged. Either answer is there at once; unpacked to its end, a gigabyte
   * takes the better part of a second on a fast machine and its size twice in
   * memory. The fastest of three attempts is measured, so that a machine that
   * was busy elsewhere for a moment does not fail this.
   */
  const gigabyte = packedOf({ piece: new Uint8Array(megabyte), times: 1024 })

  function fastestOf(attempt: () => void): number {
    return Math.min(
      ...[1, 2, 3].map(() => {
        const started = performance.now()

        attempt()

        return performance.now() - started
      }),
    )
  }

  it('is asked of what the directory says before anything is unpacked', () => {
    const bomb = zipOf([
      { path: 'klein.txt', bytes: 'x' },
      { path: 'xl/worksheets/sheet1.xml', bytes: gigabyte },
    ])

    expect(bomb.length).toBeLessThan(2 * megabyte)
    expect(
      fastestOf(() => {
        expect(refusalOf(() => unzip(bomb, 60 * megabyte))).toBe(
          'Das Archiv entpackt sich zu mehr als 60 MB.',
        )
      }),
    ).toBeLessThan(150)
  })

  it('ends the unpacking of an entry where the directory says it ends', () => {
    const bomb = zipOf([
      { path: 'xl/worksheets/sheet1.xml', bytes: gigabyte, says: { size: 1000 } },
    ])

    expect(bomb.length).toBeLessThan(2 * megabyte)
    expect(
      fastestOf(() => {
        expect(refusalOf(() => unzip(bomb, 60 * megabyte))).toBe(
          'xl/worksheets/sheet1.xml ist im Archiv beschädigt.',
        )
      }),
    ).toBeLessThan(150)
  })

  it('refuses an entry that unpacks to less than the directory says', () => {
    const short = zipOf([{ path: 'kurz.txt', bytes: 'kurz', says: { size: 400 } }])
    const stored = zipOf([{ path: 'kurz.txt', bytes: 'kurz', stored: true, says: { size: 3 } }])

    expect(refusalOf(() => unzip(short, megabyte))).toBe('kurz.txt ist im Archiv beschädigt.')
    expect(refusalOf(() => unzip(stored, megabyte))).toBe('kurz.txt ist im Archiv beschädigt.')
  })

  it('refuses an entry of nothing that unpacks to something', () => {
    const empty = zipOf([{ path: 'leer.txt', bytes: 'doch nicht', says: { size: 0 } }])

    expect(refusalOf(() => unzip(empty, megabyte))).toBe('leer.txt ist im Archiv beschädigt.')
  })
})

describe('an archive that is damaged', () => {
  it('is refused where an entry does not match its checksum', () => {
    const deflated = zipOf([
      { path: 'gut.txt', bytes: 'gut' },
      { path: 'ordner/falsch.txt', bytes: 'falsch', says: { checksum: 0x12345678 } },
    ])
    const stored = zipOf([
      { path: 'falsch.txt', bytes: 'falsch', stored: true, says: { checksum: 0 } },
    ])

    expect(refusalOf(() => unzip(deflated, megabyte))).toBe(
      'ordner/falsch.txt ist im Archiv beschädigt.',
    )
    expect(refusalOf(() => unzip(stored, megabyte))).toBe('falsch.txt ist im Archiv beschädigt.')
  })

  it('is refused where one byte of an entry changed on the way', () => {
    const archive = zipOf([{ path: 'a.txt', bytes: 'erste Datei', stored: true }])
    const changed = new Uint8Array(archive)
    // The data of the one entry begins behind its header of 30 bytes and its name.
    const at = 30 + 'a.txt'.length

    changed[at] = (changed[at] ?? 0) ^ 0x01

    expect(unzip(archive, megabyte)).toHaveLength(1)
    expect(refusalOf(() => unzip(changed, megabyte))).toBe('a.txt ist im Archiv beschädigt.')
  })

  it('is refused where the data of an entry cannot be unpacked', () => {
    const garbage = zipOf([
      {
        path: 'kaputt.txt',
        bytes: { packed: new Uint8Array([0xff, 0xff, 0xff, 0xff]), size: 4, checksum: 0 },
      },
    ])

    expect(refusalOf(() => unzip(garbage, megabyte))).toBe('kaputt.txt ist im Archiv beschädigt.')
  })

  it('is refused where an entry is not where the directory says', () => {
    const archive = zipOf([{ path: 'a.txt', bytes: 'erste Datei' }])
    const changed = new Uint8Array(archive)

    // The signature the entry begins with.
    changed[0] = 0x51

    expect(refusalOf(() => unzip(changed, megabyte))).toBe('a.txt ist im Archiv beschädigt.')
  })

  it('is refused where its end is missing or it is no archive at all', () => {
    const archive = zipOf([{ path: 'a.txt', bytes: 'erste Datei' }])
    const incomplete = 'Die Datei ist kein vollständiges ZIP-Archiv.'

    expect(refusalOf(() => unzip(archive.subarray(0, archive.length - 1), megabyte))).toBe(
      incomplete,
    )
    expect(refusalOf(() => unzip(archive.subarray(0, 30), megabyte))).toBe(incomplete)
    expect(
      refusalOf(() => unzip(new TextEncoder().encode('Raum;Etage\n'.repeat(10)), megabyte)),
    ).toBe(incomplete)
    expect(refusalOf(() => unzip(new Uint8Array(0), megabyte))).toBe(incomplete)
  })

  it('is refused where its directory holds less than its end says', () => {
    const archive = zipOf([{ path: 'a.txt', bytes: 'erste Datei' }])

    expect(refusalOf(() => unzip(withEnd(archive, 10, 2), megabyte))).toBe(
      'Das Verzeichnis des Archivs ist beschädigt.',
    )
    // And where the end points somewhere that is no directory.
    expect(refusalOf(() => unzip(withEnd(archive, 16, 0, 4), megabyte))).toBe(
      'Das Verzeichnis des Archivs ist beschädigt.',
    )
  })
})

describe('an archive that is not read', () => {
  const archive = zipOf([{ path: 'a.txt', bytes: 'erste Datei' }])

  it('is one of the large kind, said by the number of its entries or by where its directory lies', () => {
    const large =
      'Das Archiv ist ein ZIP64-Archiv. Bitte die Dateien einzeln oder als kleineres ZIP hochladen.'

    expect(refusalOf(() => unzip(withEnd(archive, 10, 0xffff), megabyte))).toBe(large)
    expect(refusalOf(() => unzip(withEnd(archive, 16, 0xffffffff, 4), megabyte))).toBe(large)
  })

  it('is one with a password', () => {
    const locked = zipOf([
      { path: 'offen.txt', bytes: 'offen' },
      { path: 'ordner/geheim.txt', bytes: 'geheim', says: { flags: 0x1 } },
    ])

    expect(refusalOf(() => unzip(locked, megabyte))).toBe(
      'ordner/geheim.txt ist verschlüsselt. Bitte ohne Kennwort packen.',
    )
  })

  it('is one packed another way than the two every packer writes', () => {
    for (const method of [1, 9, 12, 14, 93, 99]) {
      const other = zipOf([{ path: 'anders.txt', bytes: 'anders', says: { method } }])

      expect(refusalOf(() => unzip(other, megabyte))).toBe(
        'anders.txt ist mit einem Verfahren gepackt, das hier nicht gelesen wird.',
      )
    }
  })
})
