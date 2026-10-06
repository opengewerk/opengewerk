import { labelAddress } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { type LabelFace, labelPrintJob, qrSvg } from './label.js'

const origin = 'https://instance.example'

const door: LabelFace = {
  code: '7K2M9QX4TBA3HW8P',
  keeper: 'Muster & Söhne',
  name: 'Tür <Ost>',
  place: 'Halle 1',
}

const bare: LabelFace = {
  code: '0000000000000001',
  keeper: 'Muster & Söhne',
  name: null,
  place: null,
}

function job(labels: readonly LabelFace[], format: 'roll' | 'sheet', start = 1) {
  return labelPrintJob({ labels, origin, format, start, title: 'Etiketten' })
}

describe('labels as they are printed', () => {
  it('gives a label printer one label to a page of the size of the label', () => {
    const printed = job([door, door, bare], 'roll')

    expect(printed.size).toEqual({ width: '62mm', height: '29mm' })
    expect(printed.html.match(/class="page"/g)).toHaveLength(3)
    expect(printed.html).toContain('@page{size:62mm 29mm;margin:0}')
  })

  it('fills a sheet field by field from the first free one and goes on on the next sheet', () => {
    const labels = Array.from({ length: 4 }, () => door)
    const printed = job(labels, 'sheet', 23)

    expect(printed.size).toBeUndefined()
    // 22 used fields left empty, two labels on the first sheet, two on the second.
    expect(printed.html.match(/class="page sheet"/g)).toHaveLength(2)
    expect(printed.html.match(/<div><\/div>/g)).toHaveLength(22)

    const [first, second] = printed.html.split('class="page sheet"').slice(1)

    expect(first?.match(/class="label"/g)).toHaveLength(2)
    expect(second?.match(/class="label"/g)).toHaveLength(2)
  })

  it('puts into the QR of each label the address of the instance with its own code, and nothing else', () => {
    const printed = job([door, bare], 'sheet')

    expect(printed.html).toContain(qrSvg(labelAddress(origin, door.code), 29))
    expect(printed.html).toContain(qrSvg(labelAddress(origin, bare.code), 29))
    expect(printed.html).toContain('7K2M-9QX4-TBA3-HW8P')
    expect(printed.html).toContain('0000-0000-0000-0001')
  })

  it('writes what a face says as text and leaves out the lines it does not have', () => {
    const printed = job([door], 'roll')

    expect(printed.html).toContain('<div class="keeper">Muster &amp; Söhne</div>')
    expect(printed.html).toContain('<div class="name">Tür &lt;Ost&gt;</div>')
    expect(printed.html).toContain('<div class="place">Halle 1</div>')

    const blank = job([bare], 'roll')

    expect(blank.html).not.toContain('class="name"')
    expect(blank.html).not.toContain('class="place"')
    expect(blank.html).toContain('<title>Etiketten</title>')
  })
})
