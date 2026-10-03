// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { alsoReached, bandOf, fileFor, heightFor, kindOf, stepsIn, widths } from './widths.js'

/**
 * What the check of the widths decides before a browser is involved: which
 * pages are of one kind, which a scan stands for, where the layouts change,
 * and where a photograph of a failure goes. The walk itself runs in the CI
 * against the preview of an application.
 */

describe('the widths of the board', () => {
  it('go from the smallest phone to the widest screen, each with its height', () => {
    expect(widths[0]).toBe(320)
    expect(widths.at(-1)).toBe(3840)
    expect([...widths].sort((a, b) => a - b)).toEqual(widths)
    expect(widths.map(heightFor)).toEqual([
      844, 844, 844, 844, 1024, 900, 900, 900, 900, 900, 900, 1440, 1440, 1440,
    ])
  })
})

describe('the kind of a page', () => {
  it('stands for every record and every day of its kind', () => {
    expect(kindOf('/notizen/0193a2b4-0000-7000-8000-000000000001')).toBe('/notizen/:id')
    expect(kindOf('/m/zeiten/2026-10-03')).toBe('/m/zeiten/:day')
    expect(
      kindOf(
        '/regale/0193a2b4-0000-7000-8000-000000000001/fach/0193a2b4-0000-7000-8000-000000000002',
      ),
    ).toBe('/regale/:id/fach/:id')
    expect(kindOf('/konto')).toBe('/konto')
    // What only looks like an id is a page of its own.
    expect(kindOf('/a/0000000000000000')).toBe('/a/0000000000000000')
  })
})

describe('a page only a scan reaches', () => {
  const scannedOnly = [[/^\/regale\/([^/]+)$/, (id) => `/m/regale/${id}`]]

  it('is found through a link to the same record', () => {
    expect(alsoReached(scannedOnly, '/regale/0193a2b4-0000-7000-8000-000000000001')).toEqual([
      '/m/regale/0193a2b4-0000-7000-8000-000000000001',
    ])
  })

  it('is not found through a link that names no record, or another page', () => {
    expect(alsoReached(scannedOnly, '/regale/neu')).toEqual([])
    expect(alsoReached(scannedOnly, '/regale/0193a2b4-0000-7000-8000-000000000001/fach')).toEqual(
      [],
    )
    expect(alsoReached([], '/regale/0193a2b4-0000-7000-8000-000000000001')).toEqual([])
  })
})

describe('the bands a layout changes at', () => {
  const steps = stepsIn(
    readFileSync(join(import.meta.dirname, '../src/components/band.ts'), 'utf8'),
  )

  it('are read from the bands of this package, in pixels', () => {
    expect(steps.length).toBeGreaterThanOrEqual(5)
    expect([...steps].sort((a, b) => a - b)).toEqual(steps)
    expect(steps).toContain(1024)
  })

  it('count how many steps a width has passed', () => {
    expect(bandOf([600, 1024], 599)).toBe(0)
    expect(bandOf([600, 1024], 600)).toBe(1)
    expect(bandOf([600, 1024], 3840)).toBe(2)
  })

  it('refuse a file that names fewer than five, rather than open a form too seldom', () => {
    expect(() => stepsIn('@media (min-width: 40rem) {} @media (min-width: 64rem) {}')).toThrow(
      'In band.ts stehen 2 Stufen',
    )
  })
})

describe('the photograph of a failure', () => {
  it('is named after the kind, the width and the theme', () => {
    expect(fileFor('report', '/notizen/:id (Bearbeiten)', 390, 'dark')).toBe(
      join('report', 'notizen-id (Bearbeiten)-390-dark.png'),
    )
    expect(fileFor('report', '/', 1280, 'light')).toBe(join('report', 'start-1280-light.png'))
    expect(fileFor('report', '//konto//', 320, 'light')).toBe(join('report', 'konto-320-light.png'))
  })

  it('is named in one pass, however many slashes a kind has', () => {
    const started = performance.now()

    expect(fileFor('report', `${'/'.repeat(100_000)}x`, 320, 'dark')).toBe(
      join('report', 'x-320-dark.png'),
    )
    expect(fileFor('report', '/'.repeat(100_000), 320, 'dark')).toBe(
      join('report', 'start-320-dark.png'),
    )
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
