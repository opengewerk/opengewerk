import 'reflect-metadata'

import { Controller, type DynamicModule, Module, Post, Req } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import {
  tableBodyType,
  type TableFile,
  tableFileNameHeader,
  tableLimits,
  tooMuch,
} from '@opengewerk/platform-domain'
import type { Request } from 'express'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PublicRoute } from '../api/authorization.js'
import { ClosedIdentitySource } from '../api/closed-identity.js'
import { ProbeModule } from '../authentication/probe-application.js'
import { Database } from '../database/database.js'
import { zipOf } from '../files/probe-zip.js'
import { createServer } from '../start/server.js'
import { tableFileTooLarge } from './read.js'
import {
  AcceptsTable,
  AcceptsTableFile,
  largestTableBodyBytes,
  tableBodyOf,
  uploadedTable,
} from './request.js'

/**
 * The two ways a table reaches a route, behind the server of an instance as
 * it is put together for every application: the guard that asks what a
 * request carries, and in front of it the parser that reads JSON up to a
 * form's worth and nothing else. What is held is that a table passes that
 * parser unread, whatever its size, and is read by the route; and what the
 * route answers to everything that is no table. No database is asked.
 */

/** Routes that answer with what the two helpers made of a request. */
@Controller('tables')
class TableController {
  @Post('file')
  @PublicRoute()
  @AcceptsTableFile()
  file(@Req() incoming: Request): Promise<TableFile> {
    return uploadedTable(incoming)
  }

  @Post('sheet')
  @PublicRoute()
  @AcceptsTable()
  async sheet(@Req() incoming: Request): Promise<{ carried: unknown }> {
    return { carried: await tableBodyOf(incoming) }
  }

  /** The same, answered with its size alone: for a body nobody wants to get back. */
  @Post('sheet/size')
  @PublicRoute()
  @AcceptsTable()
  async size(@Req() incoming: Request): Promise<{ characters: number }> {
    return { characters: JSON.stringify(await tableBodyOf(incoming)).length }
  }

  /** A route like every other, which takes JSON the parser in front has read. */
  @Post('form')
  @PublicRoute()
  form(@Req() incoming: Request): { body: unknown } {
    return { body: (incoming.body as unknown) ?? null }
  }
}

/** The module of an application with those routes beside its own. */
@Module({})
class TableModule {
  static around(application: DynamicModule): DynamicModule {
    return { module: TableModule, imports: [application], controllers: [TableController] }
  }
}

let app: NestExpressApplication

beforeAll(async () => {
  const database = Database.connect('postgres://nobody:nobody@127.0.0.1:1/probe')
  const { application } = await createServer(
    TableModule.around(ProbeModule.create(database, new ClosedIdentitySource())),
    { authenticationHandler: null, serverPaths: [], interfaceDirectory: null },
  )

  await application.init()
  app = application
})

afterAll(async () => {
  await app.close()
})

const server = () => app.getHttpServer()

/** A sheet with what was decided about it, of about as many bytes as asked for. */
function decided(bytes: number): { sheet: { name: string; rows: string[][] }; mapping: object } {
  const row = ['101', 'Büro Süd', '12,5', 'x'.repeat(70)]
  const length = JSON.stringify(row).length + 1

  return {
    sheet: {
      name: 'Räume',
      rows: [
        ['Raum-Nr.', 'Bezeichnung', 'Fläche', 'Notiz'],
        ...new Array<string[]>(Math.ceil(bytes / length)).fill(row),
      ],
    },
    mapping: { number: 0, title: 1, area: 2 },
  }
}

describe('a sheet with what was decided about it', () => {
  it('is read by the route, as the JSON it is', async () => {
    const sent = decided(2000)
    const answer = await request(server())
      .post('/tables/sheet')
      .set('Content-Type', tableBodyType)
      .send(JSON.stringify(sent))
      .expect(201)

    expect(answer.body).toEqual({ carried: sent })
  })

  it('passes the parser in front of the routes unread, at several times what that one takes', async () => {
    const sent = decided(500 * 1024)
    const body = JSON.stringify(sent)

    expect(Buffer.byteLength(body)).toBeGreaterThan(500 * 1024)

    // The same bytes as the JSON of every other route are turned away before any route sees them.
    await request(server())
      .post('/tables/form')
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(413)

    const answer = await request(server())
      .post('/tables/sheet')
      .set('Content-Type', tableBodyType)
      .send(body)
      .expect(201)

    expect(answer.body).toEqual({ carried: sent })
  })

  it('is taken with the parameters a sender adds to its type', async () => {
    const answer = await request(server())
      .post('/tables/sheet')
      .set('Content-Type', `${tableBodyType}; charset=utf-8`)
      .send('{"sheet":{"name":"Räume","rows":[]}}')
      .expect(201)

    expect(answer.body).toEqual({ carried: { sheet: { name: 'Räume', rows: [] } } })
  })

  it('is refused as the JSON of every other route, which a parser has read before anybody asked', async () => {
    const answer = await request(server())
      .post('/tables/sheet')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(decided(2000)))

    expect(answer.status).toBe(415)
    expect(answer.body.message).toBe(
      'Eine Tabelle mit ihrer Zuordnung wird als application/x.table+json geschickt.',
    )
  })

  it('is refused as anything a form can send', async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      const answer = await request(server())
        .post('/tables/sheet')
        .set('Content-Type', type)
        .send('{"sheet":{"name":"","rows":[]}}')

      expect(answer.status, type).toBe(415)
    }
  })

  it('is taken up to the limit of such a request, and refused in words beyond it', async () => {
    const full = `"${'x'.repeat(largestTableBodyBytes - 2)}"`

    expect(Buffer.byteLength(full)).toBe(largestTableBodyBytes)
    expect(
      (
        await request(server())
          .post('/tables/sheet/size')
          .set('Content-Type', tableBodyType)
          .send(full)
          .expect(201)
      ).body,
    ).toEqual({ characters: largestTableBodyBytes })

    const answer = await request(server())
      .post('/tables/sheet/size')
      .set('Content-Type', tableBodyType)
      .send(`${full} `)

    expect(answer.status).toBe(413)
    expect(answer.body.message).toBe(tooMuch)
  })

  it('is nothing where the request carries nothing', async () => {
    expect((await request(server()).post('/tables/sheet').expect(201)).body).toEqual({
      carried: {},
    })
    expect(
      (await request(server()).post('/tables/sheet').set('Content-Type', tableBodyType).expect(201))
        .body,
    ).toEqual({ carried: {} })
  })

  it('is refused where it is no JSON', async () => {
    for (const body of ['{"sheet":', 'Raum;Etage', '{"sheet": undefined}']) {
      const answer = await request(server())
        .post('/tables/sheet')
        .set('Content-Type', tableBodyType)
        .send(body)

      expect(answer.status, body).toBe(400)
      expect(answer.body.message).toBe('Die Anfrage ist kein gültiges JSON.')
    }
  })

  it('is whatever JSON was sent: what it has to be, the route asks', async () => {
    for (const body of ['[1,2]', '"Raum"', '7', 'null']) {
      const answer = await request(server())
        .post('/tables/sheet')
        .set('Content-Type', tableBodyType)
        .send(body)
        .expect(201)

      expect(answer.body).toEqual({ carried: JSON.parse(body) as unknown })
    }
  })
})

describe('the file of a table', () => {
  const list = Buffer.from('Raum;Größe\r\n101;12,5 m²\r\n', 'utf-8')
  const table = [
    ['Raum', 'Größe'],
    ['101', '12,5 m²'],
  ]

  it('comes back as the table it is, under the name its header carries', async () => {
    const answer = await request(server())
      .post('/tables/file')
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', encodeURIComponent('Räume Süd 2026.csv'))
      .send(list)
      .expect(201)

    expect(answer.body).toEqual({
      name: 'Räume Süd 2026.csv',
      sheets: [{ name: '', rows: table }],
    })
    expect(tableFileNameHeader).toBe('x-file-name')
    expect(encodeURIComponent('Räume Süd 2026.csv')).toBe('R%C3%A4ume%20S%C3%BCd%202026.csv')
  })

  it('arrives byte for byte: a workbook is read, and so is a list in another encoding', async () => {
    const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    const relations = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    const workbook = zipOf([
      {
        path: 'xl/workbook.xml',
        bytes: `<workbook xmlns="${main}" xmlns:r="${relations}"><sheets><sheet name="Räume" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      },
      {
        path: 'xl/_rels/workbook.xml.rels',
        bytes: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relations}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      },
      {
        path: 'xl/worksheets/sheet1.xml',
        bytes: `<worksheet xmlns="${main}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Raum</t></is></c><c r="B1"><v>12.5</v></c></row></sheetData></worksheet>`,
        stored: true,
      },
    ])

    expect(
      (
        await request(server())
          .post('/tables/file')
          .set('Content-Type', 'application/octet-stream')
          .set('X-File-Name', 'Liste.xlsx')
          .send(Buffer.from(workbook))
          .expect(201)
      ).body,
    ).toEqual({ name: 'Liste.xlsx', sheets: [{ name: 'Räume', rows: [['Raum', '12,5']] }] })
    expect(
      (
        await request(server())
          .post('/tables/file')
          .set('Content-Type', 'application/octet-stream')
          .set('X-File-Name', 'Liste.csv')
          .send(Buffer.from('Raum;Größe\r\n101;12,5 m²\r\n', 'latin1'))
          .expect(201)
      ).body.sheets,
    ).toEqual([{ name: '', rows: table }])
  })

  it('has no name where the header is missing, and the name as written where it is not encoded', async () => {
    const without = await request(server())
      .post('/tables/file')
      .set('Content-Type', 'application/octet-stream')
      .send(list)
      .expect(201)
    const broken = await request(server())
      .post('/tables/file')
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', 'R%E4ume 100%.csv')
      .send(list)
      .expect(201)

    expect(without.body.name).toBe('')
    expect(broken.body.name).toBe('R%E4ume 100%.csv')
  })

  it('is refused as JSON, and as anything a form can send', async () => {
    for (const type of [
      'application/json',
      tableBodyType,
      'text/csv',
      'text/plain',
      'multipart/form-data',
    ]) {
      const answer = await request(server())
        .post('/tables/file')
        .set('Content-Type', type)
        .send('{"name":"Liste.csv"}')

      expect(answer.status, type).toBe(415)
      expect(answer.body.message).toBe(
        'Eine Tabelle wird als application/octet-stream geschickt, mit ihrem Namen im Kopf X-File-Name.',
      )
    }
  })

  it('is refused in words where it is over the limit of a file', async () => {
    const over = Buffer.alloc(tableLimits.fileBytes + 1, 0x20)

    list.copy(over)

    const answer = await request(server())
      .post('/tables/file')
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', 'Liste.csv')
      .send(over)

    expect(answer.status).toBe(413)
    expect(answer.body.message).toBe(tableFileTooLarge)
    expect(tableFileTooLarge).toBe(
      'Die Datei hat mehr als 10 MB. Teilen Sie die Tabelle in mehrere Dateien.',
    )
  })

  it('is refused with what to do instead where it is no table', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    )
    const sentences: readonly (readonly [Buffer, string])[] = [
      [
        png,
        'Die Datei ist weder eine Arbeitsmappe (.xlsx) noch eine Tabelle als Text (.csv). Speichern Sie die Tabelle in einem der beiden Formate.',
      ],
      [
        Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]),
        'Die Datei ist im alten Format (.xls) oder mit einem Kennwort geschützt. Speichern Sie die Tabelle als .xlsx ohne Kennwort oder als .csv.',
      ],
      [
        Buffer.from(zipOf([{ path: 'Liste.csv', bytes: list }])),
        'Die Datei ist ein ZIP-Archiv, aber keine Arbeitsmappe (.xlsx). Speichern Sie die Tabelle als .xlsx oder .csv.',
      ],
      [Buffer.from(' ;\r\n;\r\n'), 'In der Datei steht keine Zeile.'],
    ]

    for (const [bytes, sentence] of sentences) {
      const answer = await request(server())
        .post('/tables/file')
        .set('Content-Type', 'application/octet-stream')
        .set('X-File-Name', 'Liste.xlsx')
        .send(bytes)

      expect(answer.status, sentence).toBe(422)
      expect(answer.body.message).toBe(sentence)
    }
  })

  it('is refused as empty where the request carries no byte', async () => {
    const answer = await request(server())
      .post('/tables/file')
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', 'Liste.csv')

    expect(answer.status).toBe(422)
    expect(answer.body.message).toBe('Die Datei ist leer.')
  })
})
