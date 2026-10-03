import { describe, expect, it } from 'vitest'

import { fileHashProblem, fileMediaType, fileSizeProblem, largestFileBytes } from './file.js'

describe('the type a file is recorded as', () => {
  it('is the declared one, lower case and without parameters, when it is on the list', () => {
    expect(fileMediaType('application/pdf')).toBe('application/pdf')
    expect(fileMediaType('Image/JPEG')).toBe('image/jpeg')
    expect(fileMediaType('text/plain; charset=utf-8')).toBe('text/plain')
  })

  it('is a plain byte stream for anything else, and never a refusal', () => {
    // Nothing that a browser could run is on the list, and a type a browser
    // made up for an unknown ending is still a file somebody needs.
    expect(fileMediaType('text/html')).toBe('application/octet-stream')
    expect(fileMediaType('image/svg+xml')).toBe('application/octet-stream')
    expect(fileMediaType('')).toBe('application/octet-stream')
    expect(fileMediaType('application/x-messgeraet')).toBe('application/octet-stream')
  })
})

describe('the name of a stored file', () => {
  it('is a SHA-256 in lower case hex', () => {
    expect(fileHashProblem('a'.repeat(64))).toBeNull()
    expect(fileHashProblem('A'.repeat(64))).toMatch(/kein SHA-256/)
    expect(fileHashProblem('../../etc/passwd')).toMatch(/kein SHA-256/)
    expect(fileHashProblem(42)).toMatch(/kein SHA-256/)
  })
})

describe('the size of a file', () => {
  it('may be anything from one byte up to the limit', () => {
    expect(fileSizeProblem(1)).toBeNull()
    expect(fileSizeProblem(largestFileBytes)).toBeNull()
  })

  it('is refused above the limit, when empty and when it is no count of bytes', () => {
    expect(fileSizeProblem(largestFileBytes + 1)).toMatch(/größer als 25 MB/)
    expect(fileSizeProblem(0)).toBe('Die Datei ist leer.')
    expect(fileSizeProblem(-1)).toMatch(/keine Zahl/)
    expect(fileSizeProblem(1.5)).toMatch(/keine Zahl/)
  })
})
