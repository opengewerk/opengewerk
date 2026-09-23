import { describe, expect, it } from 'vitest'

import {
  attachmentHomeProblem,
  attachmentMediaType,
  attachmentMediaTypeProblem,
  fileHashProblem,
  attachmentSizeProblem,
  attachmentTitleOf,
  isPhoto,
  isPicture,
  largestAttachmentBytes,
} from './attachment.js'

describe('the type a file is recorded as', () => {
  it('is the declared one, lower case and without parameters, when it is on the list', () => {
    expect(attachmentMediaType('application/pdf')).toBe('application/pdf')
    expect(attachmentMediaType('Image/JPEG')).toBe('image/jpeg')
    expect(attachmentMediaType('text/plain; charset=utf-8')).toBe('text/plain')
  })

  it('is a plain byte stream for anything else, and never a refusal', () => {
    // Nothing that a browser could run is on the list, and a type a browser
    // made up for an unknown ending is still a file somebody needs.
    expect(attachmentMediaType('text/html')).toBe('application/octet-stream')
    expect(attachmentMediaType('image/svg+xml')).toBe('application/octet-stream')
    expect(attachmentMediaType('')).toBe('application/octet-stream')
    expect(attachmentMediaType('application/x-messgeraet')).toBe('application/octet-stream')
  })
})

describe('what a version says about its file', () => {
  it('has the type as it is recorded, and nothing else', () => {
    expect(attachmentMediaTypeProblem('application/pdf')).toBeNull()
    expect(attachmentMediaTypeProblem('application/octet-stream')).toBeNull()
    expect(attachmentMediaTypeProblem('Application/PDF')).toMatch(/nicht so angegeben/)
    expect(attachmentMediaTypeProblem('text/html')).toMatch(/nicht so angegeben/)
    expect(attachmentMediaTypeProblem(null)).toMatch(/nicht so angegeben/)
  })

  it('names the file by a SHA-256 in lower case hex', () => {
    expect(fileHashProblem('a'.repeat(64))).toBeNull()
    expect(fileHashProblem('A'.repeat(64))).toMatch(/kein SHA-256/)
    expect(fileHashProblem('../../etc/passwd')).toMatch(/kein SHA-256/)
    expect(fileHashProblem(42)).toMatch(/kein SHA-256/)
  })
})

describe('a picture and a photo', () => {
  it('is a picture when a browser can decode it, and not HEIC', () => {
    expect(isPicture('image/jpeg')).toBe(true)
    expect(isPicture('image/png')).toBe(true)
    expect(isPicture('image/gif')).toBe(true)
    expect(isPicture('image/heic')).toBe(false)
    expect(isPicture('application/pdf')).toBe(false)
  })

  it('is a photo, made smaller, as a JPEG or WebP and not as a PNG', () => {
    expect(isPhoto('image/jpeg')).toBe(true)
    expect(isPhoto('image/webp')).toBe(true)
    expect(isPhoto('image/png')).toBe(false)
  })
})

describe('the size of a file', () => {
  it('may be anything from one byte up to the limit', () => {
    expect(attachmentSizeProblem(1)).toBeNull()
    expect(attachmentSizeProblem(largestAttachmentBytes)).toBeNull()
  })

  it('is refused above the limit, when empty and when it is no count of bytes', () => {
    expect(attachmentSizeProblem(largestAttachmentBytes + 1)).toMatch(/größer als 25 MB/)
    expect(attachmentSizeProblem(0)).toBe('Die Datei ist leer.')
    expect(attachmentSizeProblem(-1)).toMatch(/keine Zahl/)
    expect(attachmentSizeProblem(1.5)).toMatch(/keine Zahl/)
  })
})

describe('where a file hangs', () => {
  it('is at least one of customer, site, installation and job', () => {
    expect(attachmentHomeProblem({ customerId: 'c-1' })).toBeNull()
    expect(attachmentHomeProblem({ jobId: 'j-1', installationId: 'i-1' })).toBeNull()
  })

  it('is refused when it is none of them, an empty string counting as none', () => {
    expect(attachmentHomeProblem({})).toMatch(/hängt an einem Kunden/)
    expect(attachmentHomeProblem({ customerId: '', siteId: null })).toMatch(/hängt an/)
  })
})

describe('the name of a new file', () => {
  it('is the file name without its ending', () => {
    expect(attachmentTitleOf('Schaltplan UV Keller.pdf')).toBe('Schaltplan UV Keller')
    expect(attachmentTitleOf('foto.2026-09-23.jpg')).toBe('foto.2026-09-23')
  })

  it('keeps a name that only starts with a dot, and has one when the name is empty', () => {
    expect(attachmentTitleOf('.notizen')).toBe('.notizen')
    expect(attachmentTitleOf('  ')).toBe('Datei')
  })
})
