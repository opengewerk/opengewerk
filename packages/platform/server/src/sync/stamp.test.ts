import 'reflect-metadata'

import { Controller, Get, type INestApplication } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { leftOnTheServer, StampInterceptor, withoutTheStamp } from './stamp.js'

/** A record of a table that travels, as a route reads it from the database. */
function record(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    tenantId: 't-north',
    label: 'Keller',
    createdAt: new Date('2026-10-01T08:00:00Z'),
    updatedAt: new Date('2026-10-02T09:30:00Z'),
    version: 3,
    updatedBy: 'lena',
    deviceId: 'lenas-phone',
    deletedAt: null,
    changeSequence: 41,
    ...over,
  }
}

/** The stamp of the last change, named here and not taken from the list it is held against. */
const stamp = ['updatedAt', 'updatedBy', 'deviceId']

describe('the stamp of the last change', () => {
  it('is when, who and from which device, and neither the version nor the change sequence', () => {
    expect([...leftOnTheServer].sort()).toEqual([...stamp].sort())
  })
})

describe('an answer without the stamp', () => {
  it('keeps a record whole but for the stamp, the version and the change sequence included', () => {
    expect(withoutTheStamp(record('a'))).toEqual({
      id: 'a',
      tenantId: 't-north',
      label: 'Keller',
      createdAt: new Date('2026-10-01T08:00:00Z'),
      version: 3,
      deletedAt: null,
      changeSequence: 41,
    })
  })

  it('finds a record in a list, beside another of a join and under a field of a page', () => {
    const answer = {
      rows: [record('a'), record('b')],
      joined: [{ shelves: record('s'), notes: record('n', { shelfId: 's' }) }],
      page: { record: record('p'), document: { latest: record('v') } },
    }
    const left: string[] = []

    function walk(value: unknown): void {
      if (Array.isArray(value)) {
        value.forEach(walk)
      } else if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        for (const [field, inner] of Object.entries(value)) {
          if (stamp.includes(field)) {
            left.push(field)
          }

          walk(inner)
        }
      }
    }

    const stripped = withoutTheStamp(answer)

    walk(stripped)

    expect(left).toEqual([])
    expect(stripped.joined[0]?.notes).toMatchObject({ id: 'n', shelfId: 's', changeSequence: 41 })
    expect(stripped.page.document.latest).toMatchObject({ id: 'v', version: 3 })
  })

  it('takes who changed something out wherever it stands, and when and which device only from a record', () => {
    // A setting that is no record says when it was saved, and the device of a
    // session is that of whoever asks; neither is the stamp of a record.
    const setting = { host: 'mail.example.de', updatedAt: '2026-10-02T09:30:00.000Z' }
    const session = { userId: 'lena', deviceId: 'lenas-phone' }

    expect(withoutTheStamp({ setting, session, row: { id: 'x', updatedBy: 'lena' } })).toEqual({
      setting,
      session,
      row: { id: 'x' },
    })
  })

  it('changes nothing it is handed and hands back an answer without a record as it was', () => {
    const before = record('a')
    const kept = { ...before }
    const plain = { names: ['Keller', 'Dach'], at: new Date('2026-10-02T09:30:00Z') }
    const bytes = Buffer.from('%PDF-1.7')

    withoutTheStamp([before])

    expect(before).toEqual(kept)
    expect(withoutTheStamp(plain)).toBe(plain)
    expect(withoutTheStamp(bytes)).toBe(bytes)
    expect(withoutTheStamp('Keller')).toBe('Keller')
    expect(withoutTheStamp(null)).toBeNull()
  })
})

@Controller('probe-records')
class ProbeRecordsController {
  @Get()
  list(): Record<string, unknown>[] {
    return [record('a'), record('b')]
  }

  @Get('one')
  one(): Record<string, unknown> {
    return { ...record('c'), shelf: record('s') }
  }
}

describe('the answers of a module with the interceptor', () => {
  let app: INestApplication

  beforeAll(async () => {
    const built = await Test.createTestingModule({
      controllers: [ProbeRecordsController],
      providers: [{ provide: APP_INTERCEPTOR, useClass: StampInterceptor }],
    }).compile()

    app = built.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('carry no stamp, in a list and in a record with another inside it', async () => {
    const list = (await request(app.getHttpServer()).get('/probe-records').expect(200))
      .body as Record<string, unknown>[]
    const one = (await request(app.getHttpServer()).get('/probe-records/one').expect(200))
      .body as Record<string, unknown> & { shelf: Record<string, unknown> }

    for (const row of [...list, one, one.shelf]) {
      expect(Object.keys(row).filter((field) => stamp.includes(field))).toEqual([])
      expect(row['changeSequence']).toBe(41)
    }

    expect(list.map((row) => row['id'])).toEqual(['a', 'b'])
  })
})
