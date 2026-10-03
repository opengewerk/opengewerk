import { describe, expect, it } from 'vitest'

import {
  attachmentHomeProblem,
  attachmentMediaTypeProblem,
  attachmentTitleOf,
  isPhoto,
  isPicture,
} from './attachment.js'

describe('what a version says about its file', () => {
  it('has the type as it is recorded, and nothing else', () => {
    expect(attachmentMediaTypeProblem('application/pdf')).toBeNull()
    expect(attachmentMediaTypeProblem('application/octet-stream')).toBeNull()
    expect(attachmentMediaTypeProblem('Application/PDF')).toMatch(/nicht so angegeben/)
    expect(attachmentMediaTypeProblem('text/html')).toMatch(/nicht so angegeben/)
    expect(attachmentMediaTypeProblem(null)).toMatch(/nicht so angegeben/)
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
