import type { CheckPointResult, LimitVerdict } from '@opengewerk/platform-domain'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { AnswerMark, AnswerProgress } from './answer-mark.js'
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
