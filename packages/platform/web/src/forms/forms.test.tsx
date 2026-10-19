import type { CheckPointResult, LimitVerdict } from '@opengewerk/platform-domain'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { AnswerMark, AnswerProgress } from './answer-mark.js'
import { newBlockKey } from './block-key.js'
import { CheckPointAnswer } from './check-point.js'
import { FigureBlock } from './figure-block.js'
import { limitMark, MeasurementBlock } from './measurement.js'
import { PhotoTaker } from './photo.js'
import { RemarkField, remarkForCheckPoint, remarkForMeasurement } from './remark.js'

/**
 * The blocks a point of a form is drawn with on site: what each hands on,
 * what it asks for, and that a thumb, a keyboard and a screen reader all
 * find their way through it.
 */

function AnswerHeld({ layout }: { readonly layout: 'grid' | 'row' }) {
  const [value, setValue] = useState<CheckPointResult | undefined>(undefined)

  return (
    <CheckPointAnswer
      label="Tür schließt selbsttätig"
      value={value}
      layout={layout}
      onChange={setValue}
    />
  )
}

describe('the answer to a check point', () => {
  it('is a group named by its point, of four buttons that say whether they are pressed', () => {
    render(<AnswerHeld layout="grid" />)

    const group = screen.getByRole('group', { name: 'Tür schließt selbsttätig' })
    const buttons = within(group).getAllByRole('button')

    expect(buttons.map((button) => button.textContent)).toEqual([
      'In Ordnung',
      'Nicht in Ordnung',
      'Entfällt',
      'Nicht möglich',
    ])
    expect(buttons.every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true)

    fireEvent.click(within(group).getByRole('button', { name: 'Nicht in Ordnung' }))

    expect(
      within(group).getByRole('button', { name: 'Nicht in Ordnung' }).getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      within(group).getByRole('button', { name: 'In Ordnung' }).getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('hands on the answer picked', () => {
    const picked = vi.fn()

    render(<CheckPointAnswer label="Zähler dicht" value={undefined} onChange={picked} />)
    fireEvent.click(screen.getByRole('button', { name: 'Nicht möglich' }))

    expect(picked).toHaveBeenCalledWith('not_possible')
  })

  it('is answered with the keyboard alone', async () => {
    const user = userEvent.setup()

    render(<AnswerHeld layout="grid" />)
    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')

    expect(
      screen.getByRole('button', { name: 'Nicht in Ordnung' }).getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('reads its short answers out in full where four stand in a row', () => {
    render(<AnswerHeld layout="row" />)

    const ok = screen.getByRole('button', { name: 'In Ordnung' })

    expect(ok.textContent).toBe('i. O.')
    expect(screen.getByRole('button', { name: 'Nicht möglich' }).textContent).toBe('n. m.')
  })
})

describe('what an answer asks of its remark', () => {
  it('asks the finding of "not in order" and a reason of "not applicable" and "not possible"', () => {
    expect(remarkForCheckPoint(undefined).required).toBe(false)
    expect(remarkForCheckPoint('ok').required).toBe(false)
    expect(remarkForCheckPoint('not_ok')).toMatchObject({ label: 'Bemerkung', required: true })
    expect(remarkForCheckPoint('not_applicable')).toMatchObject({ label: 'Grund', required: true })
    expect(remarkForCheckPoint('not_possible')).toMatchObject({ label: 'Grund', required: true })
  })

  it('asks a remark of a measured value outside its limit only', () => {
    expect(remarkForMeasurement(null).required).toBe(false)
    expect(remarkForMeasurement(true).required).toBe(false)
    expect(remarkForMeasurement(false).required).toBe(true)
  })

  it('says it is asked for, and what is missing while it is empty', () => {
    const { rerender } = render(
      <RemarkField asked={remarkForCheckPoint('not_possible')} value="" onChange={vi.fn()} />,
    )

    const box = screen.getByRole('textbox', { name: 'Grund, verlangt' })

    expect(box.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('„Nicht möglich“ verlangt einen Grund.')).toBeDefined()

    rerender(
      <RemarkField
        asked={remarkForCheckPoint('not_possible')}
        value="Prüftaste unter Verschluss."
        onChange={vi.fn()}
      />,
    )

    expect(screen.queryByText('„Nicht möglich“ verlangt einen Grund.')).toBeNull()
  })

  it('asks for nothing under "in order"', () => {
    render(<RemarkField asked={remarkForCheckPoint('ok')} value="" onChange={vi.fn()} />)

    expect(
      screen.getByRole('textbox', { name: 'Bemerkung' }).getAttribute('aria-invalid'),
    ).toBeNull()
  })
})

const outside: LimitVerdict = {
  within: false,
  limitMilli: 60_000,
  text: 'Unter dem Grenzwert, mindestens 60,0 °C.',
  source: 'DVGW-Arbeitsblatt W 551',
}

describe('a measured value', () => {
  it('shows the ring of the keyboard on its frame, as the field itself has none', () => {
    render(
      <MeasurementBlock
        label="Temperatur"
        unit="°C"
        value={undefined}
        verdict={null}
        onChange={vi.fn()}
      />,
    )

    const box = screen.getByRole('textbox', { name: 'Temperatur in °C' })

    expect(box.className).toContain('outline-none')
    expect(box.parentElement?.className).toContain('has-[:focus-visible]:outline-copper-text')
  })

  it('hands on what is typed in thousandths, once it reads as a number', () => {
    const typed = vi.fn()

    render(
      <MeasurementBlock
        label="Temperatur"
        unit="°C"
        value={undefined}
        verdict={null}
        onChange={typed}
      />,
    )

    const box = screen.getByRole('textbox', { name: 'Temperatur in °C' })

    fireEvent.change(box, { target: { value: '55,5' } })
    expect(typed).toHaveBeenLastCalledWith(55_500)

    fireEvent.change(box, { target: { value: '55,5 Grad' } })
    expect(typed).toHaveBeenCalledTimes(1)
    expect(box.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Eine Zahl, etwa 0,85.')).toBeDefined()

    fireEvent.change(box, { target: { value: '' } })
    expect(typed).toHaveBeenLastCalledWith(undefined)
  })

  it('says how it stands against its limit and where the limit comes from', () => {
    render(
      <MeasurementBlock
        label="Temperatur"
        unit="°C"
        value={55_500}
        verdict={outside}
        mark={limitMark('at_least', '60,0 °C')}
        onChange={vi.fn()}
      />,
    )

    const box = screen.getByRole('textbox', { name: 'Temperatur in °C' })
    const said = 'Unter dem Grenzwert, mindestens 60,0 °C. Quelle: DVGW-Arbeitsblatt W 551.'

    expect((box as HTMLInputElement).value).toBe('55,5')
    expect(screen.getByText('≥ 60,0 °C')).toBeDefined()
    expect(screen.getByText(said).id).toBe(box.getAttribute('aria-describedby'))
  })

  it('marks a limit by how a value stands to it', () => {
    expect(limitMark('at_most', '0,40 Ω')).toBe('≤ 0,40 Ω')
    expect(limitMark('below', '100 je 100 ml')).toBe('< 100 je 100 ml')
  })
})

describe('a value whose question the screen asks above it', () => {
  it('keeps its name for a reader, and the limit in short in sight', () => {
    render(
      <MeasurementBlock
        label="Temperatur am Speicheraustritt"
        unit="°C"
        value={undefined}
        verdict={null}
        mark="≥ 60,0 °C"
        labelHidden
        onChange={vi.fn()}
      />,
    )

    const label = screen.getByText('Temperatur am Speicheraustritt')

    expect(
      screen.getByRole('textbox', { name: 'Temperatur am Speicheraustritt in °C' }),
    ).toBeDefined()
    expect(label.className).toContain('sr-only')
    expect(screen.getByText('≥ 60,0 °C')).toBeDefined()
  })

  it('keeps the name of a figure for a reader as well', () => {
    render(
      <FigureBlock
        label="Zählerstand"
        unit="m³"
        value={undefined}
        labelHidden
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('textbox', { name: 'Zählerstand in m³' })).toBeDefined()
    expect(screen.getByText('Zählerstand').className).toContain('sr-only')
  })
})

describe('the key of a block', () => {
  it('stands after the keys drawn before it, so that blocks stand in the order they were opened', async () => {
    const drawn: string[] = []

    for (let count = 0; count < 5; count += 1) {
      drawn.push(newBlockKey())
      await new Promise((resolve) => setTimeout(resolve, 2))
    }

    expect([...drawn].sort()).toEqual(drawn)
    expect(new Set(drawn).size).toBe(5)
    expect(drawn.every((key) => /^[0-9a-f-]{36}$/.test(key))).toBe(true)
  })
})

describe('a figure and the reading of a meter', () => {
  it('asks about a figure in doubt and lets it be kept', async () => {
    const user = userEvent.setup()
    const kept = vi.fn()

    render(
      <FigureBlock
        label="Zählerstand"
        unit="m³"
        value={12_843_600}
        doubt={{ text: 'Etwa zehnmal so viel wie zuletzt. Stimmt das Komma?', onKeep: kept }}
        onChange={vi.fn()}
      />,
    )

    const box = screen.getByRole('textbox', { name: 'Zählerstand in m³' })

    expect(screen.getByText('Etwa zehnmal so viel wie zuletzt. Stimmt das Komma?').id).toBe(
      box.getAttribute('aria-describedby'),
    )

    await user.click(screen.getByRole('button', { name: 'Wert prüfen' }))
    expect(document.activeElement).toBe(box)

    await user.click(screen.getByRole('button', { name: 'So übernehmen' }))
    expect(kept).toHaveBeenCalledOnce()
  })
})

describe('the photo of a point', () => {
  it('takes one through a labelled file input and says when it replaces one', () => {
    const taken = vi.fn()
    const { rerender } = render(<PhotoTaker label="Foto zu Zähler dicht" onTake={taken} />)

    expect(screen.getByRole('button', { name: 'Foto aufnehmen' })).toBeDefined()

    const file = new File(['bild'], 'zaehler.jpg', { type: 'image/jpeg' })

    fireEvent.change(screen.getByLabelText('Foto zu Zähler dicht'), { target: { files: [file] } })
    expect(taken).toHaveBeenCalledWith(file)

    rerender(<PhotoTaker label="Foto zu Zähler dicht" photo={<span>Bild</span>} onTake={taken} />)
    expect(screen.getByRole('button', { name: 'Anderes Foto' })).toBeDefined()
  })

  it('opens the camera straight away, and the gallery without it', () => {
    render(<PhotoTaker label="Foto zu Zähler dicht" onTake={vi.fn()} />)

    const camera = screen.getByLabelText('Foto zu Zähler dicht')
    const gallery = screen.getByLabelText('Foto zu Zähler dicht, aus der Galerie')

    expect(camera.getAttribute('capture')).toBe('environment')
    expect(gallery.hasAttribute('capture')).toBe(false)
    expect(gallery.getAttribute('accept')).toBe('image/*')
  })

  it('takes a photo chosen from the gallery like one taken, and each button opens its own input', () => {
    const taken = vi.fn()

    render(<PhotoTaker label="Foto zu Zähler dicht" onTake={taken} />)

    const camera = screen.getByLabelText<HTMLInputElement>('Foto zu Zähler dicht')
    const gallery = screen.getByLabelText<HTMLInputElement>('Foto zu Zähler dicht, aus der Galerie')
    const openedCamera = vi.spyOn(camera, 'click').mockImplementation(() => undefined)
    const openedGallery = vi.spyOn(gallery, 'click').mockImplementation(() => undefined)

    fireEvent.click(screen.getByRole('button', { name: 'Aus der Galerie' }))
    expect(openedGallery).toHaveBeenCalledTimes(1)
    expect(openedCamera).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Foto aufnehmen' }))
    expect(openedCamera).toHaveBeenCalledTimes(1)

    const file = new File(['bild'], 'aelter.jpg', { type: 'image/jpeg' })

    fireEvent.change(gallery, { target: { files: [file] } })
    expect(taken).toHaveBeenCalledWith(file)
  })

  it('replaces one photo with one, and takes several in the order chosen where a point holds several', () => {
    const taken = vi.fn()
    const first = new File(['eins'], 'eins.jpg', { type: 'image/jpeg' })
    const second = new File(['zwei'], 'zwei.jpg', { type: 'image/jpeg' })
    const { rerender } = render(<PhotoTaker label="Foto zu Tür" onTake={taken} />)

    expect(screen.getByLabelText<HTMLInputElement>('Foto zu Tür, aus der Galerie').multiple).toBe(
      false,
    )
    fireEvent.change(screen.getByLabelText('Foto zu Tür, aus der Galerie'), {
      target: { files: [first, second] },
    })
    expect(taken.mock.calls).toEqual([[first]])

    taken.mockClear()
    rerender(<PhotoTaker label="Foto zu Tür" multiple photo={<span>Bild</span>} onTake={taken} />)

    expect(screen.getByLabelText<HTMLInputElement>('Foto zu Tür, aus der Galerie').multiple).toBe(
      true,
    )
    expect(screen.getByRole('button', { name: 'Weiteres Foto' })).toBeDefined()
    fireEvent.change(screen.getByLabelText('Foto zu Tür, aus der Galerie'), {
      target: { files: [first, second] },
    })
    expect(taken.mock.calls).toEqual([[first], [second]])
  })

  it('is small in a list, and takes from the camera and the gallery all the same', () => {
    const taken = vi.fn()
    const photo = new File(['eins'], 'eins.jpg', { type: 'image/jpeg' })
    const { rerender } = render(<PhotoTaker label="Foto zu Tür" multiple compact onTake={taken} />)

    expect(screen.getByRole('button', { name: 'Foto' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Galerie' })).toBeDefined()
    expect(screen.getByLabelText('Foto zu Tür').getAttribute('capture')).toBe('environment')
    fireEvent.change(screen.getByLabelText('Foto zu Tür'), { target: { files: [photo] } })
    expect(taken.mock.calls).toEqual([[photo]])

    rerender(
      <PhotoTaker label="Foto zu Tür" multiple compact photo={<span>Bild</span>} onTake={taken} />,
    )

    expect(screen.getByRole('button', { name: 'Weiteres Foto' })).toBeDefined()
    expect(screen.getByLabelText<HTMLInputElement>('Foto zu Tür, aus der Galerie').multiple).toBe(
      true,
    )
  })
})

describe('a point in a list', () => {
  it('says its answer, a value with its unit, or that it is open', () => {
    const { rerender } = render(<AnswerMark state={{ kind: 'open' }} />)

    expect(screen.getByText('offen')).toBeDefined()

    rerender(<AnswerMark state={{ kind: 'result', result: 'not_ok' }} />)
    expect(screen.getByText('Nicht in Ordnung')).toBeDefined()

    rerender(<AnswerMark state={{ kind: 'value', text: '61,0 °C' }} />)
    expect(screen.getByText('61,0 °C')).toBeDefined()
  })

  it('counts how far the form is in words and per cent', () => {
    render(<AnswerProgress done={5} total={6} text="5 von 6 Pflichtpunkten beantwortet" />)

    expect(screen.getByText('5 von 6 Pflichtpunkten beantwortet')).toBeDefined()
    expect(screen.getByText('83 %')).toBeDefined()
  })
})
