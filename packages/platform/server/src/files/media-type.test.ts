import { describe, expect, it } from 'vitest'

import { dispositionFor, recognisedMediaType, storedMediaType } from './media-type.js'

/** The smallest PNG there is, one transparent pixel. */
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

describe('the type the first bytes show', () => {
  it('is named for a picture a browser shows and for a PDF', () => {
    expect(recognisedMediaType(png)).toBe('image/png')
    expect(recognisedMediaType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg')
    expect(
      recognisedMediaType(
        Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      ),
    ).toBe('image/webp')
    expect(recognisedMediaType(Buffer.from('GIF89a'))).toBe('image/gif')
    expect(recognisedMediaType(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf')
  })

  it('is none for anything else, a picture that is not one included', () => {
    expect(recognisedMediaType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(recognisedMediaType(Buffer.from('GIF90a'))).toBeNull()
    expect(recognisedMediaType(Buffer.alloc(0))).toBeNull()
  })
})

describe('the type a stored file is recorded with', () => {
  it('is the one the bytes show, whatever was declared', () => {
    expect(storedMediaType(png, 'application/octet-stream')).toBe('image/png')
    expect(storedMediaType(png, 'text/plain')).toBe('image/png')
  })

  it('is the declared one otherwise, but never one that is shown in place', () => {
    expect(storedMediaType(Buffer.from('a;b\n1;2\n'), 'text/csv')).toBe('text/csv')
    expect(storedMediaType(Buffer.from('<script>alert(1)</script>'), 'image/png')).toBe(
      'application/octet-stream',
    )
    expect(storedMediaType(Buffer.from('nicht leer'), 'application/pdf')).toBe(
      'application/octet-stream',
    )
  })
})

describe('the name a file is handed out with', () => {
  it('is in place for what a browser shows safely, and a download otherwise', () => {
    expect(dispositionFor('application/pdf', 'Plan.pdf')).toMatch(/^inline;/)
    expect(dispositionFor('text/plain', 'Notiz.txt')).toMatch(/^attachment;/)
  })

  it('is in plain ASCII and in full, and nothing in it ends the header', () => {
    expect(dispositionFor('application/pdf', 'Plan.pdf')).toBe(
      `inline; filename="Plan.pdf"; filename*=UTF-8''Plan.pdf`,
    )
    expect(dispositionFor('text/plain', 'Aufmaß "neu".txt')).toBe(
      `attachment; filename="Aufma_ _neu_.txt"; filename*=UTF-8''Aufma%C3%9F%20%22neu%22.txt`,
    )
    expect(dispositionFor('text/plain', 'a\r\nSet-Cookie: x')).not.toMatch(/[\r\n]/)
  })
})
