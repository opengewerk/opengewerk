import { describe, expect, it } from 'vitest'

import {
  isLabelCode,
  labelAddress,
  labelCodeFrom,
  labelCodeFromScan,
  labelCodeLength,
  labelPrintProblem,
  printedLabelCode,
} from './installation-label.js'

describe('the code of a label', () => {
  it('takes five bits for each of its sixteen characters', () => {
    const zeros = new Uint8Array(10)
    const ones = new Uint8Array(10).fill(255)

    expect(labelCodeFrom(zeros)).toBe('0000000000000000')
    expect(labelCodeFrom(ones)).toBe('ZZZZZZZZZZZZZZZZ')
    // 0x08 0x42 ... puts 00001 00001 00001 ... into the characters.
    expect(labelCodeFrom(new Uint8Array([8, 66, 16, 132, 33, 8, 66, 16, 132, 33]))).toBe(
      '1111111111111111',
    )
  })

  it('makes only codes of the alphabet, never I, L, O or U', () => {
    for (let round = 0; round < 200; round++) {
      const random = new Uint8Array(10).map((_, index) => (round * 37 + index * 101) % 256)
      const code = labelCodeFrom(random)

      expect(code).toHaveLength(labelCodeLength)
      expect(isLabelCode(code)).toBe(true)
      expect(code).not.toMatch(/[ILOU]/)
    }
  })

  it('wants ten bytes', () => {
    expect(() => labelCodeFrom(new Uint8Array(9))).toThrow(RangeError)
  })

  it('prints in four groups', () => {
    expect(printedLabelCode('7K2M9QX4TBA3HW8P')).toBe('7K2M-9QX4-TBA3-HW8P')
  })

  it('stands in an address of the instance', () => {
    expect(labelAddress('https://msk.opengewerk.de', '7K2M9QX4TBA3HW8P')).toBe(
      'https://msk.opengewerk.de/a/7K2M9QX4TBA3HW8P',
    )
    expect(labelAddress('https://msk.opengewerk.de/', '7K2M9QX4TBA3HW8P')).toBe(
      'https://msk.opengewerk.de/a/7K2M9QX4TBA3HW8P',
    )
  })
})

describe('reading a label from a scan', () => {
  it('reads the code from the address of the label', () => {
    expect(labelCodeFromScan('https://msk.opengewerk.de/a/7K2M9QX4TBA3HW8P')).toBe(
      '7K2M9QX4TBA3HW8P',
    )
  })

  it('reads it whatever host is in front of it, so that a move of the instance changes nothing', () => {
    expect(labelCodeFromScan('https://alte-adresse.example/a/7K2M9QX4TBA3HW8P')).toBe(
      '7K2M9QX4TBA3HW8P',
    )
    expect(labelCodeFromScan('http://192.168.1.20:23700/a/7K2M9QX4TBA3HW8P')).toBe(
      '7K2M9QX4TBA3HW8P',
    )
    expect(labelCodeFromScan('https://example.de/opengewerk/a/7K2M9QX4TBA3HW8P/')).toBe(
      '7K2M9QX4TBA3HW8P',
    )
    expect(labelCodeFromScan('https://example.de/a/7K2M9QX4TBA3HW8P?quelle=etikett')).toBe(
      '7K2M9QX4TBA3HW8P',
    )
  })

  it('reads the code leniently, as Crockford does', () => {
    expect(labelCodeFromScan('https://example.de/a/7k2m-9qx4-tba3-hw8p')).toBe('7K2M9QX4TBA3HW8P')
    expect(labelCodeFromScan('https://example.de/a/7K2M9QX4TBA3HWBP'.replace('B', 'O'))).toBe(
      '7K2M9QX4T0A3HWBP',
    )
    expect(labelCodeFromScan('https://example.de/a/IK2M9QX4TBA3HW8L')).toBe('1K2M9QX4TBA3HW81')
  })

  it('takes nothing that is not the address of a label', () => {
    // A serial number of sixteen characters is not a label.
    expect(labelCodeFromScan('7K2M9QX4TBA3HW8P')).toBeNull()
    expect(labelCodeFromScan('https://example.de/anlagen/7K2M9QX4TBA3HW8P')).toBeNull()
    expect(labelCodeFromScan('https://example.de/a/7K2M9QX4TBA3HW8')).toBeNull()
    expect(labelCodeFromScan('https://example.de/a/7K2M9QX4TBA3HW8PX')).toBeNull()
    expect(labelCodeFromScan('https://example.de/a/7K2M9QX4TBA3HW8U')).toBeNull()
    expect(labelCodeFromScan('ftp://example.de/a/7K2M9QX4TBA3HW8P')).toBeNull()
    expect(labelCodeFromScan('https://example.de/a/7K2M 9QX4TBA3HW8P')).toBeNull()
    expect(labelCodeFromScan('')).toBeNull()
  })
})

describe('a print of labels', () => {
  it('makes 1 to 24 at once', () => {
    expect(labelPrintProblem('roll', 1, 1)).toBeNull()
    expect(labelPrintProblem('roll', 24, 1)).toBeNull()
    expect(labelPrintProblem('roll', 0, 1)).toBe('Gedruckt werden 1 bis 24 Etiketten auf einmal.')
    expect(labelPrintProblem('sheet', 25, 1)).toBe('Gedruckt werden 1 bis 24 Etiketten auf einmal.')
    expect(labelPrintProblem('sheet', 1.5, 1)).toBe(
      'Gedruckt werden 1 bis 24 Etiketten auf einmal.',
    )
  })

  it('starts on a sheet at any of its 24 fields, on a roll at the first', () => {
    expect(labelPrintProblem('sheet', 3, 24)).toBeNull()
    expect(labelPrintProblem('sheet', 3, 25)).toBe('Ein Bogen hat die Felder 1 bis 24.')
    expect(labelPrintProblem('sheet', 3, 0)).toBe('Ein Bogen hat die Felder 1 bis 24.')
    expect(labelPrintProblem('roll', 3, 2)).toBe(
      'Ein Etikettendrucker beginnt immer beim ersten Etikett.',
    )
  })
})
