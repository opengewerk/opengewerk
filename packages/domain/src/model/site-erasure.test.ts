import type { IsoDate } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { shippedRules } from '../rules/shipped.js'
import { siteErasureLabel } from './erasure.js'
import { retentionOf } from './retention.js'
import { siteErasureAnchor, siteErasureDueOn, siteHoldSentence } from './site-erasure.js'

const today = '2026-11-05' as IsoDate

describe('when the site of a deleted customer falls due (#848)', () => {
  it('counts from the youngest signed protocol, else from the last job closed, else from nothing', () => {
    expect(
      siteErasureAnchor({
        lastProtocolOn: '2016-03-14' as IsoDate,
        lastJobClosedOn: '2018-05-02' as IsoDate,
      }),
    ).toEqual({ kind: 'protocol', on: '2016-03-14' })
    expect(
      siteErasureAnchor({ lastProtocolOn: null, lastJobClosedOn: '2015-09-30' as IsoDate }),
    ).toEqual({ kind: 'job', on: '2015-09-30' })
    expect(siteErasureAnchor({ lastProtocolOn: null, lastJobClosedOn: null })).toBeNull()
  })

  it('lets a site go ten years after the day it counts from, and not a day before', () => {
    const anchor = { kind: 'protocol', on: '2016-03-14' } as const

    expect(siteErasureDueOn(anchor, '2024-01-10' as IsoDate, today, shippedRules)).toBe(
      '2026-03-14',
    )
    // The day after the 28th of February of a year without a 29th.
    expect(
      siteErasureDueOn(
        { kind: 'job', on: '2016-02-29' },
        '2024-01-10' as IsoDate,
        today,
        shippedRules,
      ),
    ).toBe('2026-03-01')
  })

  it('never lets a site go before its customer went', () => {
    const anchor = { kind: 'protocol', on: '2012-06-01' } as const

    expect(siteErasureDueOn(anchor, '2026-10-20' as IsoDate, today, shippedRules)).toBe(
      '2026-10-20',
    )
  })

  it('lets a site with neither protocol nor job go with its customer', () => {
    expect(siteErasureDueOn(null, '2026-10-20' as IsoDate, today, shippedRules)).toBe('2026-10-20')
  })

  it('names the source of the period', () => {
    expect(retentionOf('site_records', '2016-03-14' as IsoDate, today, shippedRules)).toMatchObject(
      {
        years: 10,
        source: '§ 199 Abs. 3 Satz 1 Nr. 1 BGB',
      },
    )
  })

  it('says why a site is kept', () => {
    expect(siteHoldSentence('running_contract')).toBe(
      'Ein Wartungsvertrag am Objekt ist nicht beendet.',
    )
  })
})

describe('the site as the deletion names it', () => {
  it('says the day it counts from, and nothing of the address', () => {
    expect(siteErasureLabel({ kind: 'protocol', on: '2016-03-14' as IsoDate })).toBe(
      'Objekt, letztes Protokoll 14.03.2016',
    )
    expect(siteErasureLabel({ kind: 'job', on: '2015-09-30' as IsoDate })).toBe(
      'Objekt ohne Protokoll, letzter Auftrag 30.09.2015',
    )
    expect(siteErasureLabel(null)).toBe('Objekt ohne Protokoll und Auftrag')
  })
})
