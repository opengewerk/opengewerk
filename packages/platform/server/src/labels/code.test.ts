import { isLabelCode } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { drawLabelCode, LabelCodeUnavailableError, withLabelCode } from './code.js'

/** What the driver throws when a unique index refuses a row. */
function taken(index: string): Error {
  return Object.assign(new Error('duplicate key'), { code: '23505', constraint: index })
}

describe('the code of a new label', () => {
  it('is drawn as a code, and not the same twice', () => {
    const drawn = new Set(Array.from({ length: 50 }, () => drawLabelCode()))

    expect([...drawn].every(isLabelCode)).toBe(true)
    expect(drawn.size).toBe(50)
  })

  it('is drawn again when it stood in the table already', async () => {
    const codes: string[] = []

    const written = await withLabelCode('labels_code_once', async (draw) => {
      codes.push(draw())

      if (codes.length < 3) {
        throw taken('labels_code_once')
      }

      return codes.at(-1)
    })

    expect(codes).toHaveLength(3)
    expect(new Set(codes).size).toBe(3)
    expect(written).toBe(codes[2])
  })

  it('gives up after three attempts with a sentence', async () => {
    let attempts = 0

    await expect(
      withLabelCode('labels_code_once', async () => {
        attempts += 1
        throw taken('labels_code_once')
      }),
    ).rejects.toBeInstanceOf(LabelCodeUnavailableError)
    expect(attempts).toBe(3)
  })

  it('hands on every other refusal at once, another index included', async () => {
    let attempts = 0

    await expect(
      withLabelCode('labels_code_once', async () => {
        attempts += 1
        throw taken('labels_one_valid')
      }),
    ).rejects.toMatchObject({ constraint: 'labels_one_valid' })
    expect(attempts).toBe(1)
  })
})
