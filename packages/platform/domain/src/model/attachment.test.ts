import { describe, expect, it } from 'vitest'

import { syncRules } from '../sync/rules.js'
import {
  attachmentEntity,
  attachmentRules,
  attachmentTitleOf,
  attachmentVersionEntity,
  attachmentVersionPolicy,
  isPhoto,
  isPicture,
} from './attachment.js'

// The files of an application that is nobody's: a scan hangs on a shelf, on
// a letter, or on both. An application of the organisation binds the rules to
// its own records and asks them the same way.

const shelf = '0199a1b2-0000-7000-8000-000000000001'
const letter = '0199a1b2-0000-7000-8000-000000000002'

const text = {
  noHome: 'Eine Datei hängt an einem Regal oder an einem Brief, diese an keinem davon.',
  mediaType: 'Der Typ der Datei ist nicht so angegeben, wie die Ablage ihn festhält.',
}

const rules = attachmentRules({ homes: ['shelfId', 'letterId'], text })

describe('where a file hangs', () => {
  it('is at least one of the records its application names, and may be several', () => {
    expect(rules.homeProblem({ shelfId: shelf })).toBeNull()
    expect(rules.homeProblem({ shelfId: null, letterId: letter })).toBeNull()
    expect(rules.homeProblem({ shelfId: shelf, letterId: letter })).toBeNull()
  })

  it('is refused on none of them, however a form hands them over, in the sentence of the application', () => {
    expect(rules.homeProblem({})).toBe(text.noHome)
    expect(rules.homeProblem({ shelfId: null, letterId: null })).toBe(text.noHome)
    expect(rules.homeProblem({ shelfId: '', letterId: undefined })).toBe(text.noHome)
  })

  it('does not count a field the application did not name', () => {
    const elsewhere: Readonly<Record<string, unknown>> = { drawerId: shelf }

    expect(rules.homeProblem(elsewhere)).toBe(text.noHome)
  })

  it('hands on the places that name a record and leaves out the empty ones', () => {
    expect(rules.homesOf({ shelfId: shelf, letterId: null })).toEqual({ shelfId: shelf })
    expect(rules.homesOf({ shelfId: '', letterId: letter })).toEqual({ letterId: letter })
    expect(rules.homesOf({ shelfId: shelf, letterId: letter })).toEqual({
      shelfId: shelf,
      letterId: letter,
    })
    expect(rules.homesOf({})).toEqual({})
  })

  it('leaves out what is no key, and what the application did not name', () => {
    const sent: Readonly<Record<string, unknown>> = { shelfId: 7, letterId: letter, title: 'Scan' }

    expect(rules.homesOf(sent)).toEqual({ letterId: letter })
  })

  it('names each place once', () => {
    expect(rules.homes).toEqual(['shelfId', 'letterId'])
    expect(() => attachmentRules({ homes: ['shelfId', 'shelfId'], text })).toThrow(/once/)
  })
})

describe('what a version says about its file', () => {
  it('has the type as it is recorded, and nothing else, in the sentence of the application', () => {
    expect(rules.mediaTypeProblem('application/pdf')).toBeNull()
    expect(rules.mediaTypeProblem('application/octet-stream')).toBeNull()
    expect(rules.mediaTypeProblem('Application/PDF')).toBe(text.mediaType)
    expect(rules.mediaTypeProblem('text/html')).toBe(text.mediaType)
    expect(rules.mediaTypeProblem('image/jpeg; charset=binary')).toBe(text.mediaType)
    expect(rules.mediaTypeProblem(null)).toBe(text.mediaType)
    expect(rules.mediaTypeProblem(7)).toBe(text.mediaType)
  })
})

describe('a picture and a photo', () => {
  it('is a picture when a browser can decode it, and not HEIC', () => {
    expect(isPicture('image/jpeg')).toBe(true)
    expect(isPicture('image/png')).toBe(true)
    expect(isPicture('image/webp')).toBe(true)
    expect(isPicture('image/gif')).toBe(true)
    expect(isPicture('image/heic')).toBe(false)
    expect(isPicture('application/pdf')).toBe(false)
  })

  it('is a photo, made smaller, as a JPEG or WebP and not as a PNG', () => {
    expect(isPhoto('image/jpeg')).toBe(true)
    expect(isPhoto('image/webp')).toBe(true)
    expect(isPhoto('image/png')).toBe(false)
    expect(isPhoto('image/gif')).toBe(false)
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
    expect(attachmentTitleOf('', 'Dokument')).toBe('Dokument')
  })
})

describe('what a device may do with a version', () => {
  const offline = syncRules({
    [attachmentEntity]: { create: true, change: 'merge' },
    [attachmentVersionEntity]: attachmentVersionPolicy,
  })

  it('is to make one, and to change nothing of it afterwards', () => {
    expect(offline.policyFor(attachmentVersionEntity)?.create).toBe(true)
    expect(offline.policyFor(attachmentVersionEntity)?.change).toBe('never')
  })

  it('leaves who stored it to the server', () => {
    expect(offline.isSetByServer(attachmentVersionEntity, 'createdBy')).toBe(true)
    expect(offline.isSetByServer(attachmentVersionEntity, 'fileName')).toBe(false)
  })
})
