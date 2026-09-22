import type { IsoDate } from '@opengewerk/domain'
import { lineUnits, signedContentFingerprint } from '@opengewerk/domain'

import { newId } from '../database/identifier.js'
import { previewUser } from './preview-database.js'

type Answer = Record<string, unknown>

/**
 * One call to the running preview. Through HTTP and the real routes rather
 * than into the tables, so that the sample data goes through everything a
 * person's data goes through: the checks, the proposal of a tax treatment,
 * the number range and the snapshot at issuing. Data that only exists because
 * somebody wrote it into a table would show screens a real business never
 * reaches.
 */
async function send(base: string, method: string, path: string, body?: unknown): Promise<Answer> {
  const response = await fetch(new URL(path, base), {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const answer = (await response.json().catch(() => ({}))) as Answer

  if (!response.ok) {
    throw new Error(
      `The sample data broke at ${method} ${path}: ${String(response.status)} ` +
        `${String(answer['message'] ?? '')}`,
    )
  }

  return answer
}

function idOf(answer: Answer): string {
  const id = answer['id']

  if (typeof id !== 'string') {
    throw new Error('The sample data expected an id in the answer and got none')
  }

  return id
}

interface Line {
  readonly kind?: 'title'
  readonly designation: string
  readonly description?: string
  readonly quantityMilli?: number
  readonly unit?: string
  readonly unitPriceCents?: number
}

const title = (designation: string, description?: string): Line => ({
  kind: 'title',
  designation,
  ...(description ? { description } : {}),
})

const item = (
  designation: string,
  quantityMilli: number,
  unit: string,
  unitPriceCents: number,
  description?: string,
): Line => ({
  designation,
  quantityMilli,
  unit,
  unitPriceCents,
  ...(description ? { description } : {}),
})

/** Two strokes that pass for a name, in the units of the signature box. */
const sampleSignature =
  'M120,300L150,200L185,120L215,205L250,300M205,215L160,215' +
  'M320,280L350,190L385,265L420,175L455,280L520,230L600,260L690,215L780,250L860,205'

/**
 * A business with enough in it to reach every screen that exists: two
 * customers, a building with an installation, two jobs, an issued quote with
 * the order confirmation made out of it, a progress invoice out of the same
 * quote with the final invoice after it, a cost estimate in progress, a report
 * the customer has signed on site, a maintenance invoice to the property
 * management company, the snippets they are written from, and three tasks on
 * the jobs, one of them overdue and one done.
 *
 * The quote is issued and the confirmation is a draft on purpose. Together
 * they show both states of a document, the chain between them, and a document
 * that refuses to be changed next to one that can be. The signed report is
 * the third state, waiting in the office for its number. The final invoice is
 * a draft, so the office sees what it takes off before anybody issues it.
 *
 * The two customers are the two formats. The family gets its invoices as a
 * PDF; the property management company is a business in Germany with a
 * reference for its invoices, and its maintenance invoice is issued, so the
 * XRechnung of it can be fetched.
 */
export async function plantSampleData(base: string, today: IsoDate): Promise<void> {
  const post = (path: string, body: unknown) => send(base, 'POST', path, body)

  await send(base, 'PUT', '/settings/letterhead', {
    companyName: 'Elektro Nord GmbH',
    street: 'Hafenstraße',
    houseNumber: '12',
    postalCode: '20457',
    city: 'Hamburg',
    country: 'DE',
    phone: '040 123 456 78',
    email: 'buero@elektro-nord.example',
    website: 'www.elektro-nord.example',
    taxNumber: '22/815/08154',
    vatId: 'DE123456789',
    iban: 'DE89 3704 0044 0532 0130 00',
    bic: 'COBADEFFXXX',
    bankName: 'Commerzbank Hamburg',
    registerCourt: 'Amtsgericht Hamburg',
    registerNumber: 'HRB 12345',
    managingDirectors: 'Geschäftsführer: Max Nord',
  })

  const berg = idOf(
    await post('/customers', {
      kind: 'private',
      name: 'Familie Berg',
      street: 'Lindenweg',
      houseNumber: '3',
      postalCode: '22301',
      city: 'Hamburg',
      phone: '040 987 654 32',
    }),
  )
  const nordblick = idOf(
    await post('/customers', {
      kind: 'property_management',
      name: 'Hausverwaltung Nordblick GmbH',
      street: 'Elbchaussee',
      houseNumber: '140',
      postalCode: '22763',
      city: 'Hamburg',
      email: 'technik@nordblick.example',
      vatId: 'DE987654321',
      buyerReference: 'Objekt Elbchaussee 140',
      isBusiness: true,
    }),
  )

  const house = idOf(
    await post('/sites', {
      customerId: berg,
      designation: 'Einfamilienhaus Berg',
      street: 'Lindenweg',
      houseNumber: '3',
      postalCode: '22301',
      city: 'Hamburg',
    }),
  )
  const estate = idOf(
    await post('/sites', {
      customerId: nordblick,
      designation: 'Wohnanlage Elbchaussee',
      street: 'Elbchaussee',
      houseNumber: '140',
      postalCode: '22763',
      city: 'Hamburg',
    }),
  )
  const cabinet = idOf(
    await post('/installations', {
      siteId: house,
      kind: 'meter_cabinet',
      designation: 'Zählerschrank Keller',
    }),
  )

  const renewal = idOf(
    await post('/jobs', {
      customerId: berg,
      siteId: house,
      installationId: cabinet,
      kind: 'project',
      status: 'active',
      designation: 'Zählerschrank erneuern',
    }),
  )
  const stairwell = idOf(
    await post('/jobs', {
      customerId: nordblick,
      siteId: estate,
      kind: 'project',
      status: 'draft',
      designation: 'Treppenhausbeleuchtung auf LED umrüsten',
    }),
  )

  for (const snippet of [
    {
      purpose: 'intro',
      title: 'Dank für die Anfrage',
      text: 'Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihre Anfrage. Gerne bieten wir Ihnen an:',
    },
    {
      purpose: 'closing',
      title: 'Gültigkeit und Gruß',
      text:
        'Dieses Angebot gilt vier Wochen ab Datum. Wir freuen uns auf Ihren Auftrag.\n\n' +
        'Mit freundlichen Grüßen',
    },
    {
      purpose: 'closing',
      title: 'Hinweis zum Kostenvoranschlag',
      text:
        'Die Beträge sind geschätzt. Zeichnet sich eine wesentliche Überschreitung ab, ' +
        'melden wir uns vorher bei Ihnen.',
    },
    {
      purpose: 'line',
      title: 'Zählerschrank setzen',
      text: 'Zählerschrank nach VDE-AR-N 4100 liefern und setzen, inklusive APZ-Feld und Beschriftung',
    },
    {
      purpose: 'line',
      title: 'Fehlersuche',
      text: 'Fehlersuche an der Elektroinstallation, Abrechnung nach Aufwand',
    },
  ]) {
    await post('/documents/text-snippets', snippet)
  }

  async function document(values: Record<string, unknown>, lines: readonly Line[]) {
    const id = idOf(await post('/documents', { documentDate: today, ...values }))
    const written: Answer[] = []

    for (const line of lines) {
      written.push(await post(`/documents/${id}/lines`, line))
    }

    return { id, lines: written }
  }

  const { id: quote } = await document(
    {
      customerId: berg,
      jobId: renewal,
      siteId: house,
      installationId: cabinet,
      kind: 'quote',
      subject: 'Erneuerung des Zählerschranks und Außenbeleuchtung',
      introText:
        'Sehr geehrte Familie Berg,\n\nvielen Dank für Ihre Anfrage. Gerne bieten wir Ihnen ' +
        'die folgenden Arbeiten an:',
      closingText:
        'Dieses Angebot gilt vier Wochen. Wir freuen uns auf Ihren Auftrag.\n\n' +
        'Mit freundlichen Grüßen\nElektro Nord GmbH',
    },
    [
      title('Zählerschrank', 'Im Keller, Zugang über die Außentreppe'),
      item(
        'Zählerschrank setzen',
        1000,
        'flat_rate',
        124000,
        'Zählerschrank nach VDE-AR-N 4100 liefern und setzen,\ninklusive APZ-Feld und Beschriftung',
      ),
      item('Überspannungsschutz Typ 1+2', 1000, 'piece', 38500),
      item('Arbeitszeit Elektromeister', 6500, 'hour', 7800),
      title('Außenbeleuchtung'),
      item('Wandleuchte montieren', 4000, 'piece', 4500),
      item('NYM-J 3x1,5 mm²', 25000, 'metre', 129),
    ],
  )

  await post(`/documents/${quote}/issue`, {})
  await post(`/documents/${quote}/successors`, { kind: 'order_confirmation' })

  // The cabinet is done and the lighting is not: a cumulative progress invoice
  // for the first part, issued, and the final invoice after it with the rest
  // added back, still a draft.
  const progress = idOf(await post(`/documents/${quote}/successors`, { kind: 'progress_invoice' }))
  const lineOf = (line: Answer) => `/documents/${progress}/lines/${String(line['id'])}`
  const outstanding = ['Außenbeleuchtung', 'Wandleuchte montieren', 'NYM-J 3x1,5 mm²']

  for (const line of (await send(
    base,
    'GET',
    `/documents/${progress}/lines`,
  )) as unknown as Answer[]) {
    if (outstanding.includes(String(line['designation']))) {
      await send(base, 'DELETE', lineOf(line))
    } else if (line['designation'] === 'Arbeitszeit Elektromeister') {
      await send(base, 'PATCH', lineOf(line), { quantityMilli: 3000 })
    }
  }

  await post(`/documents/${progress}/issue`, {})

  const final = idOf(await post(`/documents/${progress}/successors`, { kind: 'final_invoice' }))
  const started = new Date(`${today}T12:00:00Z`)

  started.setUTCDate(started.getUTCDate() - 14)
  await send(base, 'PATCH', `/documents/${final}`, {
    serviceFrom: started.toISOString().slice(0, 10),
    serviceUntil: today,
  })

  for (const line of (await send(
    base,
    'GET',
    `/documents/${final}/lines`,
  )) as unknown as Answer[]) {
    if (line['designation'] === 'Arbeitszeit Elektromeister') {
      await send(base, 'PATCH', `/documents/${final}/lines/${String(line['id'])}`, {
        quantityMilli: 6500,
      })
    }
  }

  for (const line of [
    title('Außenbeleuchtung'),
    item('Wandleuchte montieren', 4000, 'piece', 4500),
    item('NYM-J 3x1,5 mm²', 25000, 'metre', 129),
  ]) {
    await post(`/documents/${final}/lines`, line)
  }

  await document(
    {
      customerId: nordblick,
      jobId: stairwell,
      siteId: estate,
      kind: 'cost_estimate',
      subject: 'Treppenhausbeleuchtung auf LED umrüsten',
    },
    [
      title('Treppenhaus Haus A'),
      item('LED-Deckenleuchte mit Bewegungsmelder', 12000, 'piece', 8900),
      item('Montage je Leuchte', 12000, 'piece', 3500),
      title('Treppenhaus Haus B'),
      item('LED-Deckenleuchte mit Bewegungsmelder', 10000, 'piece', 8900),
      item('Montage je Leuchte', 10000, 'piece', 3500),
      item('Entsorgung der Altleuchten', 1000, 'flat_rate', 6000),
    ],
  )

  // The maintenance of the last two months, invoiced to a business, issued:
  // the invoice that goes out as an e-invoice.
  const maintained = new Date(`${today}T12:00:00Z`)

  maintained.setUTCDate(maintained.getUTCDate() - 1)

  const maintenanceStart = new Date(maintained)

  maintenanceStart.setUTCDate(maintenanceStart.getUTCDate() - 60)

  const maintenance = await document(
    {
      customerId: nordblick,
      jobId: stairwell,
      siteId: estate,
      kind: 'recurring_invoice',
      subject: 'Wartung der Notbeleuchtung',
      serviceFrom: maintenanceStart.toISOString().slice(0, 10),
      serviceUntil: maintained.toISOString().slice(0, 10),
    },
    [
      item('Notleuchte geprüft und gewartet', 24000, 'piece', 1250),
      item('Prüfprotokoll nach DIN VDE 0108', 1000, 'flat_rate', 8500),
    ],
  )

  await post(`/documents/${maintenance.id}/issue`, {})

  const workDone =
    'Alten Zählerschrank abgebaut, neuen gesetzt und angeschlossen. Anlage geprüft und ' +
    'wieder in Betrieb genommen.'
  const report = await document(
    {
      customerId: berg,
      jobId: renewal,
      siteId: house,
      installationId: cabinet,
      kind: 'time_and_material_report',
      subject: 'Zählerschrank erneuern',
      introText: workDone,
    },
    [
      item('Arbeitszeit Elektromeister', 6500, 'hour', 0),
      item('Überspannungsschutz Typ 1+2', 1000, 'piece', 0),
      item('NYM-J 5x10 mm²', 8000, 'metre', 0),
    ],
  )

  // Signed the only way a signature is ever made: on a device, through the
  // outbox, with a fingerprint of the page the customer saw. There is no
  // route for it, and there should not be one for sample data either.
  const signed = await post('/sync', {
    deviceId: 'vorschau-tablet',
    operations: [
      {
        id: newId<'operation'>(),
        entity: 'document_signatures',
        recordId: newId<'document-signature'>(),
        kind: 'create',
        baseVersion: null,
        patches: Object.entries({
          documentId: report.id,
          signerName: 'Erika Berg',
          signedAt: new Date().toISOString(),
          deviceInfo: 'Tablet der Vorschau',
          path: sampleSignature,
          contentFingerprint: signedContentFingerprint({
            introText: workDone,
            lines: report.lines.map((line) => ({
              id: String(line['id']),
              position: Number(line['position']),
              kind: line['kind'] === 'title' ? 'title' : 'item',
              designation: String(line['designation']),
              description: typeof line['description'] === 'string' ? line['description'] : null,
              quantityMilli: Number(line['quantityMilli']),
              unit: lineUnits.find((unit) => unit === line['unit']) ?? 'piece',
            })),
          }),
        }).map(([field, to]) => ({ field, from: null, to })),
        recordedAt: new Date().toISOString(),
      },
    ],
  })
  const [receipt] = (signed['receipts'] ?? []) as { outcome?: string; reason?: string | null }[]

  // A refused signature is a receipt and not an error, so it has to be looked
  // for. Unnoticed, the preview would show a draft where a signed report was
  // meant, and nobody would know why.
  if (receipt?.outcome !== 'applied') {
    throw new Error(
      `The sample signature was not taken: ${String(receipt?.outcome)} ${String(receipt?.reason)}`,
    )
  }

  // Tasks travel like everything written on site, so they come through the
  // outbox as well. The only person of the preview is the one looking, so all
  // three are theirs: one for the next days, one overdue, one done.
  const dayFromToday = (days: number): IsoDate => {
    const at = new Date(`${today}T12:00:00Z`)

    at.setUTCDate(at.getUTCDate() + days)

    return at.toISOString().slice(0, 10)
  }
  const tasks = [
    {
      title: 'Material für den Zählerschrank bestellen',
      dueOn: dayFromToday(2),
      status: 'open',
      customerId: berg,
      siteId: house,
      jobId: renewal,
    },
    {
      title: 'Bei der Hausverwaltung wegen der Treppenhausbeleuchtung nachfassen',
      dueOn: dayFromToday(-1),
      status: 'open',
      customerId: nordblick,
      siteId: estate,
      jobId: stairwell,
    },
    {
      title: 'Zählerplatz ausmessen',
      dueOn: dayFromToday(-7),
      status: 'done',
      customerId: berg,
      siteId: house,
      jobId: renewal,
    },
  ]
  const noted = await post('/sync', {
    deviceId: 'vorschau-tablet',
    operations: tasks.map((values) => ({
      id: newId<'operation'>(),
      entity: 'tasks',
      recordId: newId<'task'>(),
      kind: 'create',
      baseVersion: null,
      patches: Object.entries({ ...values, assigneeUserId: previewUser.id, notes: null }).map(
        ([field, to]) => ({ field, from: null, to }),
      ),
      recordedAt: new Date().toISOString(),
    })),
  })
  const refused = (
    (noted['receipts'] ?? []) as { outcome?: string; reason?: string | null }[]
  ).filter((taken) => taken.outcome !== 'applied')

  if (refused.length > 0) {
    throw new Error(`The sample tasks were not all taken: ${JSON.stringify(refused)}`)
  }
}
