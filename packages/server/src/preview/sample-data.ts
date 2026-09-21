import type { IsoDate } from '@opengewerk/domain'

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

/**
 * A business with enough in it to reach every screen that exists: two
 * customers, a building with an installation, two jobs, an issued quote with
 * the order confirmation made out of it, a cost estimate in progress and the
 * snippets they are written from.
 *
 * The quote is issued and the confirmation is a draft on purpose. Together
 * they show both states of a document, the chain between them, and a document
 * that refuses to be changed next to one that can be.
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

    for (const line of lines) {
      await post(`/documents/${id}/lines`, line)
    }

    return id
  }

  const quote = await document(
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
}
