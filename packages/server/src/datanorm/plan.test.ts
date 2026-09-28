import type { IsoDate } from '@opengewerk/domain'
import { describe, expect, it } from 'vitest'

import {
  type HeldArticle,
  type HeldLink,
  type HeldPrice,
  type Holdings,
  ImportRefused,
  planImport,
  type PlanOptions,
} from './plan.js'
import { readDelivery } from './read.js'
import { cp850, header } from './test-files.js'

/**
 * What an import would do (#297), worked out from made-up files and made-up
 * holdings: the plan is a pure function, so every rule of the takeover is
 * held here without a database.
 */

const day = '2026-10-01' as IsoDate

function delivery(...lines: readonly string[]) {
  return readDelivery([{ name: 'DATANORM.001', bytes: cp850([header('011026'), ...lines]) }])
}

function holdings(parts: {
  readonly articles?: readonly HeldArticle[]
  readonly links?: readonly HeldLink[]
  readonly listPrices?: readonly (HeldPrice & { readonly linkId: string })[]
  readonly purchasePrices?: readonly (HeldPrice & { readonly linkId: string })[]
  readonly sellingPrices?: readonly (HeldPrice & { readonly articleId: string })[]
}): Holdings {
  return {
    articles: new Map((parts.articles ?? []).map((article) => [article.id, article])),
    links: new Map((parts.links ?? []).map((link) => [link.supplierNumber, link])),
    listPrices: new Map((parts.listPrices ?? []).map((price) => [price.linkId, price])),
    purchasePrices: new Map((parts.purchasePrices ?? []).map((price) => [price.linkId, price])),
    sellingPrices: new Map((parts.sellingPrices ?? []).map((price) => [price.articleId, price])),
  }
}

function options(overrides: Partial<PlanOptions> = {}): PlanOptions {
  let next = 0

  return {
    validFrom: day,
    listAsSelling: true,
    shortCode: 'HAN',
    newId: () => {
      next += 1

      return `new-${String(next)}`
    },
    ...overrides,
  }
}

const cableTie = 'A;N;5709912;00;Kabelbinder 200x4,8;schwarz UV;1;2;Stck;350;RG12;042;;'
const cableTieEan = 'B;N;5709912; ; ; ;;;;4006381333931; ;0420;0;0; ; ;'

const held: HeldArticle = {
  id: 'article-1',
  number: 'KB-200',
  designation: 'Kabelbinder schwarz',
  unit: 'piece',
  ean: null,
}

const heldLink: HeldLink = {
  id: 'link-1',
  articleId: 'article-1',
  supplierNumber: '5709912',
  discountGroup: 'RG12',
}

function price(id: string, cents: number, validFrom: string, priceBase: 1 | 100 = 100) {
  return { id, cents, priceBase, validFrom: validFrom as IsoDate, fromImport: false }
}

describe('an article the supplier does not sell yet', () => {
  it('becomes a new article under the supplier number, with its link and prices', () => {
    const plan = planImport(delivery(cableTie), holdings({}), options())

    expect(plan.articles).toEqual([
      {
        id: 'new-1',
        number: '5709912',
        designation: 'Kabelbinder 200x4,8 schwarz UV',
        description: null,
        unit: 'piece',
        ean: null,
        groupOfGoods: '042',
      },
    ])
    expect(plan.links).toEqual([
      { id: 'new-2', articleId: 'new-1', supplierNumber: '5709912', discountGroup: 'RG12' },
    ])
    expect(plan.listPrices).toEqual([
      { ownerId: 'new-2', cents: 350, priceBase: 100, replaces: null },
    ])
    expect(plan.sellingPrices).toEqual([
      { ownerId: 'new-1', cents: 350, priceBase: 100, replaces: null },
    ])
    expect(plan.purchasePrices).toEqual([])
    expect(plan.summary).toMatchObject({ articles: 1, created: 1, renumbered: 0, fileDate: day })
    expect(plan.summary.samples).toEqual([
      {
        kind: 'created',
        supplierNumber: '5709912',
        number: '5709912',
        renumbered: false,
        designation: 'Kabelbinder 200x4,8 schwarz UV',
        unit: 'piece',
        listPrice: { cents: 350, priceBase: 100 },
        netPrice: null,
        previousListPrice: null,
      },
    ])
  })

  it('gets the short code where the business uses the number already, however written', () => {
    const plan = planImport(
      delivery(cableTie, 'A;N;a-17;00;Abzweigdose;;1;0;Stck;120;;;;'),
      holdings({
        articles: [
          { ...held, id: 'taken-1', number: '5709912' },
          { ...held, id: 'taken-2', number: '5709912-han' },
          { ...held, id: 'taken-3', number: 'A-17' },
        ],
      }),
      options(),
    )

    expect(plan.articles.map((article) => article.number)).toEqual(['5709912-HAN2', 'a-17-HAN'])
    expect(plan.links.map((link) => link.supplierNumber)).toEqual(['5709912', 'a-17'])
    expect(plan.summary).toMatchObject({ created: 2, renumbered: 2, shortCode: 'HAN' })
    expect(plan.summary.samples.every((sample) => sample.renumbered)).toBe(true)
  })

  it('is found among the articles of the business by its EAN and gets the supplier added', () => {
    const plan = planImport(
      delivery(cableTie, cableTieEan),
      holdings({ articles: [{ ...held, ean: '4006381333931' }] }),
      options(),
    )

    expect(plan.articles).toEqual([])
    expect(plan.links).toEqual([
      { id: 'new-1', articleId: 'article-1', supplierNumber: '5709912', discountGroup: 'RG12' },
    ])
    expect(plan.listPrices).toEqual([
      { ownerId: 'new-1', cents: 350, priceBase: 100, replaces: null },
    ])
    expect(plan.sellingPrices).toEqual([
      { ownerId: 'article-1', cents: 350, priceBase: 100, replaces: null },
    ])
    expect(plan.summary).toMatchObject({ linked: 1, created: 0 })
    expect(plan.summary.samples[0]).toMatchObject({ kind: 'linked', number: 'KB-200' })
  })

  it('gets the supplier but keeps its prices when the business counts it in another unit', () => {
    const plan = planImport(
      delivery(cableTie, cableTieEan),
      holdings({ articles: [{ ...held, unit: 'package', ean: '4006381333931' }] }),
      options(),
    )

    expect(plan.links).toHaveLength(1)
    expect(plan.listPrices).toEqual([])
    expect(plan.sellingPrices).toEqual([])
    expect(plan.summary.problemLines).toEqual([
      {
        file: 'DATANORM.001',
        line: 2,
        reason:
          'KB-200 hat bei Ihnen die Einheit Pakete, der Katalog verkauft den Artikel in Stück. ' +
          'Seine Preise bleiben, wie sie sind.',
      },
    ])
  })

  it('is a new article when its EAN finds one the supplier sells under another number', () => {
    const plan = planImport(
      delivery(cableTie, cableTieEan),
      holdings({
        articles: [{ ...held, ean: '4006381333931' }],
        links: [{ ...heldLink, supplierNumber: '5709900' }],
      }),
      options(),
    )

    expect(plan.summary).toMatchObject({ created: 1, linked: 0 })
    expect(plan.links).toEqual([expect.objectContaining({ articleId: 'new-1' })])
  })
})

describe('an article the supplier sells already', () => {
  it('gets new prices and its discount group, and keeps its own texts', () => {
    const plan = planImport(
      delivery(cableTie.replace('RG12', 'RG14')),
      holdings({
        articles: [held],
        links: [heldLink],
        listPrices: [{ ...price('list-1', 300, '2026-01-01'), linkId: 'link-1' }],
        sellingPrices: [{ ...price('sell-1', 300, '2026-01-01'), articleId: 'article-1' }],
      }),
      options(),
    )

    expect(plan.articles).toEqual([])
    expect(plan.links).toEqual([])
    expect(plan.discountGroups).toEqual([{ linkId: 'link-1', discountGroup: 'RG14' }])
    expect(plan.listPrices).toEqual([
      { ownerId: 'link-1', cents: 350, priceBase: 100, replaces: null },
    ])
    expect(plan.sellingPrices).toEqual([
      { ownerId: 'article-1', cents: 350, priceBase: 100, replaces: null },
    ])
    expect(plan.summary).toMatchObject({ updated: 1, unchanged: 0 })
    expect(plan.summary.samples).toEqual([
      {
        kind: 'updated',
        supplierNumber: '5709912',
        number: 'KB-200',
        renumbered: false,
        designation: 'Kabelbinder schwarz',
        unit: 'piece',
        listPrice: { cents: 350, priceBase: 100 },
        netPrice: null,
        previousListPrice: { cents: 300, priceBase: 100 },
      },
    ])
  })

  it('writes nothing where the files say what the business holds', () => {
    const plan = planImport(
      delivery(cableTie),
      holdings({
        articles: [held],
        links: [heldLink],
        listPrices: [{ ...price('list-1', 350, '2026-01-01'), linkId: 'link-1' }],
        sellingPrices: [{ ...price('sell-1', 350, '2026-01-01'), articleId: 'article-1' }],
      }),
      options(),
    )

    expect([
      plan.articles,
      plan.links,
      plan.discountGroups,
      plan.listPrices,
      plan.sellingPrices,
      plan.purchasePrices,
    ]).toEqual([[], [], [], [], [], []])
    expect(plan.summary).toMatchObject({ articles: 1, updated: 0, unchanged: 1, samples: [] })
  })

  it('replaces a price of the same day, and a selling price only when an import wrote it', () => {
    const sameDay = holdings({
      articles: [held],
      links: [heldLink],
      listPrices: [{ ...price('list-1', 300, day), linkId: 'link-1' }],
      sellingPrices: [{ ...price('sell-1', 300, day), articleId: 'article-1' }],
    })

    const own = planImport(delivery(cableTie), sameDay, options())

    expect(own.listPrices).toEqual([
      { ownerId: 'link-1', cents: 350, priceBase: 100, replaces: 'list-1' },
    ])
    expect(own.sellingPrices).toEqual([])
    expect(own.summary.problemLines.map((problem) => problem.reason)).toEqual([
      'Für KB-200 gilt ab dem 01.10.2026 schon ein eigener Verkaufspreis. Er bleibt.',
    ])

    const imported = planImport(
      delivery(cableTie),
      {
        ...sameDay,
        sellingPrices: new Map([['article-1', { ...price('sell-1', 300, day), fromImport: true }]]),
      },
      options(),
    )

    expect(imported.sellingPrices).toEqual([
      { ownerId: 'article-1', cents: 350, priceBase: 100, replaces: 'sell-1' },
    ])
    expect(imported.summary.problems).toBe(0)
  })

  it('takes a net price as the purchase price and leaves the selling price alone', () => {
    const plan = planImport(
      delivery('A;N;5709912;00;Kabelbinder 200x4,8;schwarz UV;2;2;Stck;210;RG12;042;;'),
      holdings({ articles: [held], links: [heldLink] }),
      options(),
    )

    expect(plan.purchasePrices).toEqual([
      { ownerId: 'link-1', cents: 210, priceBase: 100, replaces: null },
    ])
    expect(plan.listPrices).toEqual([])
    expect(plan.sellingPrices).toEqual([])
    expect(plan.summary.samples[0]).toMatchObject({ netPrice: { cents: 210, priceBase: 100 } })
  })

  it("keeps a list price the supplier's where the office does not want it as selling price", () => {
    const plan = planImport(
      delivery(cableTie),
      holdings({ articles: [held], links: [heldLink] }),
      options({ listAsSelling: false }),
    )

    expect(plan.listPrices).toHaveLength(1)
    expect(plan.sellingPrices).toEqual([])
  })

  it('takes the price of a price file with the price base of the price before it', () => {
    const plan = planImport(
      readDelivery([
        {
          name: 'DATPREIS.001',
          bytes: cp850([header('011026'), 'P;A;5709912;1;390;0;RG12;;;;;']),
        },
      ]),
      holdings({
        articles: [held],
        links: [heldLink],
        listPrices: [{ ...price('list-1', 350, '2026-01-01'), linkId: 'link-1' }],
      }),
      options(),
    )

    expect(plan.listPrices).toEqual([
      { ownerId: 'link-1', cents: 390, priceBase: 100, replaces: null },
    ])
    expect(plan.summary).toMatchObject({ articles: 1, updated: 1 })
  })

  it('takes a price file beside the article of another kind, both prices', () => {
    const plan = planImport(
      readDelivery([
        { name: 'DATANORM.001', bytes: cp850([header('011026'), cableTie]) },
        { name: 'DATPREIS.001', bytes: cp850([header('011026'), 'P;A;5709912;2;205;0;;;;;;']) },
      ]),
      holdings({}),
      options(),
    )

    expect(plan.listPrices).toEqual([expect.objectContaining({ cents: 350, priceBase: 100 })])
    expect(plan.purchasePrices).toEqual([expect.objectContaining({ cents: 205, priceBase: 100 })])
  })

  it('loses the supplier, not its existence, when the files delete it', () => {
    const plan = planImport(
      delivery('A;L;5709912;00;Kabelbinder 200x4,8;schwarz UV;1;2;Stck;350;RG12;042;;'),
      holdings({ articles: [held], links: [heldLink] }),
      options(),
    )

    expect(plan.removedLinks).toEqual(['link-1'])
    expect(plan.articles).toEqual([])
    expect(plan.summary).toMatchObject({ removed: 1, articles: 0 })
    expect(plan.summary.samples).toEqual([
      expect.objectContaining({ kind: 'removed', number: 'KB-200', supplierNumber: '5709912' }),
    ])
  })
})

describe('what the plan cannot take', () => {
  it('names a price for an article the supplier does not sell as a problem of its line', () => {
    const plan = planImport(
      readDelivery([
        { name: 'DATPREIS.001', bytes: cp850([header('011026'), 'P;A;4711;1;390;0;;;;;;']) },
      ]),
      holdings({}),
      options(),
    )

    expect(plan.summary.problemLines).toEqual([
      {
        file: 'DATPREIS.001',
        line: 2,
        reason:
          'Für 4711 kommt ein Preis, aber den Artikel führt der Lieferant bei Ihnen noch nicht.',
      },
    ])
    expect(plan.listPrices).toEqual([])
  })

  it('counts a unit it does not know and takes the article in pieces', () => {
    const plan = planImport(
      delivery(
        'A;N;88;00;Sonderteil;;1;0;Gebinde;990;;;;',
        'A;N;89;00;Sonderteil;;1;0;Gebinde;990;;;;',
      ),
      holdings({}),
      options(),
    )

    expect(plan.articles.map((article) => article.unit)).toEqual(['piece', 'piece'])
    expect(plan.summary.unknownUnits).toEqual([{ text: 'Gebinde', articles: 2 }])
  })

  it('refuses a delivery without a DATANORM file, and prices in another currency', () => {
    expect(() =>
      planImport(
        readDelivery([{ name: 'liesmich.txt', bytes: cp850(['Viel Erfolg!']) }]),
        holdings({}),
        options(),
      ),
    ).toThrow(ImportRefused)

    const marks = header('011026').replace(/EUR$/, 'DEM')

    expect(() =>
      planImport(
        readDelivery([{ name: 'DATANORM.001', bytes: cp850([marks, cableTie]) }]),
        holdings({}),
        options(),
      ),
    ).toThrow('Die Preise der Dateien sind in DEM angegeben. OpenGewerk rechnet in Euro.')
  })
})
