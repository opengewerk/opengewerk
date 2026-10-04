import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Shell } from '../components/surface.js'
import type { Entry } from '../components/surface.js'
import type { EditResult } from './client.js'
import { refusalText } from './client.js'
import { asBoolean, asTextOrNull, RecordForm, yesOrNo } from './record-form.js'
import type { FormField } from './record-form.js'

/**
 * A form over one record, in the one shape every screen uses: it starts from
 * what the record holds, hands back what was typed, and shows what a refusal
 * said while the form is still open.
 *
 * The record is a shelf, one no application has. Where the values go is the
 * caller's business and the sync client's.
 */

const fields: readonly FormField[] = [
  { name: 'name', label: 'Name', required: true, hint: 'Wie es am Regal steht.' },
  { name: 'boards', label: 'Böden', kind: 'number', numeric: true },
  {
    name: 'room',
    label: 'Raum',
    options: [
      { value: 'shop', label: 'Werkstatt' },
      { value: 'cellar', label: 'Keller' },
    ],
  },
  { name: 'locked', label: 'Abgeschlossen', options: yesOrNo },
  {
    name: 'keyHolder',
    label: 'Schlüssel bei',
    shownWhen: (values) => values['locked'] === 'true',
  },
  {
    name: 'corner',
    label: 'Ecke',
    optionsFor: (values) =>
      values['room'] === 'cellar'
        ? [
            { value: 'north', label: 'Nordwand' },
            { value: 'stairs', label: 'Unter der Treppe' },
          ]
        : [
            { value: 'window', label: 'Am Fenster' },
            { value: 'door', label: 'An der Tür' },
          ],
  },
]

const queued = (): Promise<EditResult> => Promise.resolve({ outcome: 'queued', id: 's-1' })

/** A caller that takes what it is handed, and keeps it for the test to look at. */
const taking = () => vi.fn<(values: Record<string, string>) => Promise<EditResult>>(queued)

function form(props: Partial<Parameters<typeof RecordForm>[0]> = {}, entry: Entry = 'office') {
  return render(
    <Shell entry={entry}>
      <RecordForm fields={fields} submitLabel="Speichern" onSubmit={queued} {...props} />
    </Shell>,
  )
}

describe('a form over a record', () => {
  /**
   * Through `String` and not through a reader of texts: a record carries
   * booleans and numbers as well, and a form that read only strings would
   * show "Abgeschlossen: ja" as the first choice in the list, which is no.
   * Saving would then quietly turn it off.
   */
  it('starts with what the record holds, a yes as a yes and a number as its figures', () => {
    form({
      record: { id: 's-1', name: 'Regal am Fenster', boards: 5, room: 'cellar', locked: true },
    })

    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Regal am Fenster')
    expect(screen.getByLabelText('Böden')).toHaveProperty('value', '5')
    expect(screen.getByLabelText('Raum')).toHaveProperty('value', 'cellar')
    expect(screen.getByLabelText('Abgeschlossen')).toHaveProperty('value', 'true')
  })

  it('starts a field the record does not hold empty, and a choice with its first', () => {
    form({ record: { id: 's-1', name: null } })

    expect(screen.getByLabelText('Name')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Raum')).toHaveProperty('value', 'shop')
    expect(screen.getByLabelText('Abgeschlossen')).toHaveProperty('value', 'false')
  })

  it('hands back what was typed and chosen, and says nothing when it was taken', async () => {
    const submitted = taking()

    form({ onSubmit: submitted })

    await userEvent.type(screen.getByLabelText('Name'), 'Regal an der Tür')
    await userEvent.type(screen.getByLabelText('Böden'), '4')
    await userEvent.selectOptions(screen.getByLabelText('Ecke'), 'door')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(submitted).toHaveBeenCalledWith({
      name: 'Regal an der Tür',
      boards: '4',
      room: 'shop',
      locked: 'false',
      keyHolder: '',
      corner: 'door',
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says what a hint says under its field, to a reader as well', () => {
    form()

    expect(screen.getByLabelText('Name').getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.getByText('Wie es am Regal steht.')).toBeTruthy()
  })
})

describe('a field that depends on what is filled in', () => {
  it('stands only while its condition holds, and is handed back empty when it does not', async () => {
    const submitted = taking()

    form({
      onSubmit: submitted,
      record: { id: 's-1', name: 'Regal', locked: true, keyHolder: 'Mia' },
    })

    expect(screen.getByLabelText('Schlüssel bei')).toHaveProperty('value', 'Mia')

    await userEvent.selectOptions(screen.getByLabelText('Abgeschlossen'), 'false')

    expect(screen.queryByLabelText('Schlüssel bei')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    // A shelf that is no longer locked does not keep who holds its key.
    expect(submitted.mock.calls[0]?.[0]).toMatchObject({ locked: 'false', keyHolder: '' })
  })

  it('offers the choices for what is filled in, and hands back the first where the one chosen is gone', async () => {
    const submitted = taking()

    form({
      onSubmit: submitted,
      record: { id: 's-1', name: 'Regal', room: 'shop', corner: 'door' },
    })

    expect(
      within(screen.getByLabelText('Ecke'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Am Fenster', 'An der Tür'])

    await userEvent.selectOptions(screen.getByLabelText('Raum'), 'cellar')

    expect(
      within(screen.getByLabelText('Ecke'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Nordwand', 'Unter der Treppe'])

    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    // The door of the workshop is no corner of the cellar.
    expect(submitted.mock.calls[0]?.[0]).toMatchObject({ room: 'cellar', corner: 'north' })
  })

  /**
   * Only for a list that depends on the values. A fixed list keeps a value
   * it does not offer: a record written somewhere else goes back as it came,
   * instead of quietly becoming the first choice.
   */
  it('keeps a value a fixed list does not offer', async () => {
    const submitted = taking()

    form({ onSubmit: submitted, record: { id: 's-1', name: 'Regal', room: 'attic' } })
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(submitted.mock.calls[0]?.[0]).toMatchObject({ room: 'attic' })
  })
})

describe('what stands in the way of a form', () => {
  it('shows what a rule says before anything is sent, and sends once it passes', async () => {
    const submitted = taking()

    form({
      onSubmit: submitted,
      check: (values) =>
        (values['name'] ?? '').length < 3 ? 'Ein Name hat wenigstens drei Buchstaben.' : null,
    })

    await userEvent.type(screen.getByLabelText('Name'), 'ab')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(screen.getByRole('alert').textContent).toBe('Ein Name hat wenigstens drei Buchstaben.')
    expect(submitted).not.toHaveBeenCalled()

    await userEvent.type(screen.getByLabelText('Name'), 'c')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(submitted).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows what a refusal said while the form is still open, at the field that is the reason', async () => {
    form({
      onSubmit: () =>
        Promise.resolve({ outcome: 'refused', reason: 'record_is_fixed', fields: ['name'] }),
    })

    await userEvent.type(screen.getByLabelText('Name'), 'Regal')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    expect((await screen.findByRole('alert')).textContent).toBe(refusalText.record_is_fixed)
    expect(screen.getByText('Dieses Feld ist der Grund.')).toBeTruthy()
    expect(screen.getByLabelText('Name').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByLabelText('Böden').getAttribute('aria-invalid')).not.toBe('true')
    // The form stays as it was typed, for the next try.
    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Regal')
    expect(screen.getByRole('button', { name: 'Speichern' })).toHaveProperty('disabled', false)
  })

  it('passes on the sentence of the server where it gave one', async () => {
    form({
      onSubmit: () =>
        Promise.resolve({
          outcome: 'refused',
          reason: 'online_only',
          fields: [],
          message: 'Dafür fehlt das Recht.',
        }),
    })

    await userEvent.type(screen.getByLabelText('Name'), 'Regal')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Dafür fehlt das Recht.')
  })

  /**
   * The device could not keep what was filled in, a full store above all
   * (opengewerk-haustechnik#31). The form says so and keeps the entries, where
   * it stood there before as if it had been saved.
   */
  it('says so when the device could not keep it, and keeps what was typed', async () => {
    form({ onSubmit: () => Promise.reject(new Error('QuotaExceededError')) })

    await userEvent.type(screen.getByLabelText('Name'), 'Regal')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Auf diesem Gerät ließ sich das nicht speichern. Die Eingaben stehen noch da.',
    )
    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Regal')
    expect(screen.getByRole('button', { name: 'Speichern' })).toHaveProperty('disabled', false)
  })

  it('says why nothing can be written right now, and offers nothing to press', () => {
    form({ disabled: true, disabledReason: 'Das Regal ist abgebaut.' })

    expect(screen.getByRole('status').textContent).toBe('Das Regal ist abgebaut.')
    expect(screen.getByRole('button', { name: 'Speichern' })).toHaveProperty('disabled', true)
  })

  it('cannot be sent twice while the first is on its way', async () => {
    let finish: (result: EditResult) => void = () => {}
    const submitted = vi.fn(
      () =>
        new Promise<EditResult>((resolve) => {
          finish = resolve
        }),
    )

    form({ onSubmit: submitted })

    await userEvent.type(screen.getByLabelText('Name'), 'Regal')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    const waiting = screen.getByRole('button', { name: 'Wird gespeichert' })

    expect(waiting).toHaveProperty('disabled', true)

    await userEvent.click(waiting)
    finish({ outcome: 'queued', id: 's-1' })

    expect(await screen.findByRole('button', { name: 'Speichern' })).toHaveProperty(
      'disabled',
      false,
    )
    expect(submitted).toHaveBeenCalledOnce()
  })
})

describe('the buttons of a form', () => {
  it('stand at the right in the office, the one that saves last, with the way out before it', async () => {
    const cancelled = vi.fn()

    form({
      onCancel: cancelled,
      extraAction: <button type="button">Entfernen</button>,
    })

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Entfernen',
      'Abbrechen',
      'Speichern',
    ])

    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))

    expect(cancelled).toHaveBeenCalledOnce()
  })

  it('stand one over the other on site, the one that saves first, where the thumb is', () => {
    form(
      {
        onCancel: () => {},
        extraAction: <button type="button">Entfernen</button>,
      },
      'site',
    )

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Speichern',
      'Abbrechen',
      'Entfernen',
    ])
  })

  it('have no way out where the caller gives none, and show what the caller puts after the fields', () => {
    form({ after: <p>Danach</p> })

    expect(screen.queryByRole('button', { name: 'Abbrechen' })).toBeNull()
    expect(screen.getByText('Danach')).toBeTruthy()
  })
})

describe('a form drawn as a board draws it', () => {
  const noted: readonly FormField[] = [
    { name: 'name', label: 'Name', required: true, place: 'lg:col-span-3' },
    { name: 'boards', label: 'Böden', placeholder: '5' },
    {
      name: 'room',
      label: 'Raum',
      required: true,
      options: [{ value: 'shop', label: 'Werkstatt' }],
    },
    {
      name: 'note',
      label: 'Notiz',
      kind: 'textarea',
      placeholder: 'Was an diesem Regal zu beachten ist',
    },
  ]

  it('takes more than a line in a box, and hands the lines back as they were typed', async () => {
    const submitted = taking()

    form({ fields: noted, onSubmit: submitted })

    const note = screen.getByLabelText('Notiz')

    expect(note.tagName).toBe('TEXTAREA')

    await userEvent.type(screen.getByLabelText('Name'), 'Regal')
    // A line break in the box is a line break, not the end of the form.
    await userEvent.type(note, 'Oben nur Leichtes.{enter}Schlüssel im Büro.')

    expect(submitted).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(submitted).toHaveBeenCalledWith({
      name: 'Regal',
      boards: '',
      room: 'shop',
      note: 'Oben nur Leichtes.\nSchlüssel im Büro.',
    })
  })

  it('starts the box with what the record holds, and marks it as the reason of a refusal', async () => {
    form({
      fields: noted,
      record: { id: 's-1', name: 'Regal', note: 'Wackelt.' },
      onSubmit: () =>
        Promise.resolve({ outcome: 'refused', reason: 'record_is_fixed', fields: ['note'] }),
    })

    const note = screen.getByLabelText('Notiz')

    expect(note).toHaveProperty('value', 'Wackelt.')

    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await screen.findByRole('alert')

    expect(note.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByLabelText('Name').getAttribute('aria-invalid')).not.toBe('true')
  })

  it('shows an example in an empty field where one is given, and none where not', () => {
    form({ fields: noted })

    expect(screen.getByLabelText('Böden').getAttribute('placeholder')).toBe('5')
    expect(screen.getByLabelText('Notiz').getAttribute('placeholder')).toBe(
      'Was an diesem Regal zu beachten ist',
    )
    expect(screen.getByLabelText('Name').hasAttribute('placeholder')).toBe(false)
  })

  /** The cell of the grid a control stands in: the child of the grid above it. */
  function cellOf(control: HTMLElement): Element | null {
    let cell: Element | null = control

    while (cell?.parentElement && !cell.parentElement.className.includes('grid')) {
      cell = cell.parentElement
    }

    return cell
  }

  it('stands where it says in the grid, a box across the whole of it, and anything else in one cell', () => {
    form({ fields: noted, columns: 'lg:grid-cols-6' })

    expect(cellOf(screen.getByLabelText('Name'))?.className).toContain('lg:col-span-3')
    expect(cellOf(screen.getByLabelText('Notiz'))?.className).toContain('col-span-full')
    // A field that says nothing takes one cell, as it always did.
    expect(cellOf(screen.getByLabelText('Böden'))?.className).not.toContain('col-span')
    expect(cellOf(screen.getByLabelText('Raum'))?.className).not.toContain('col-span')
    expect(cellOf(screen.getByLabelText('Name'))?.parentElement?.className).toContain(
      'lg:grid-cols-6',
    )
  })

  it('lets a box stand in less than the whole row where it says so', () => {
    form({
      fields: [{ name: 'note', label: 'Notiz', kind: 'textarea', place: 'sm:col-span-1' }],
    })

    const cell = cellOf(screen.getByLabelText('Notiz'))

    expect(cell?.className).toContain('sm:col-span-1')
    expect(cell?.className).not.toContain('col-span-full')
  })

  /** The labels a star stands beside. */
  function starred(): (string | null)[] {
    return [...document.querySelectorAll('label')]
      .filter((label) => label.nextElementSibling?.textContent === '*')
      .map((label) => label.textContent)
  }

  it('draws a star beside what has to be filled in where the form is asked to, and none otherwise', () => {
    const { unmount } = form({ fields: noted })

    expect(starred()).toEqual([])

    unmount()
    form({ fields: noted, starred: true })

    // The typed field and the choice, not what may stay empty.
    expect(starred()).toEqual(['Name', 'Raum'])
    expect(screen.getByLabelText('Name')).toHaveProperty('required', true)
  })
})

describe('what a choice hands back, as a record wants it', () => {
  it('is a yes only for the yes of the two choices', () => {
    expect(yesOrNo.map((choice) => [choice.label, asBoolean(choice.value)])).toEqual([
      ['Nein', false],
      ['Ja', true],
    ])
    expect(asBoolean(undefined)).toBe(false)
  })

  it('is nothing for an empty text, and the text without its edges otherwise', () => {
    expect(asTextOrNull('  ')).toBeNull()
    expect(asTextOrNull(undefined)).toBeNull()
    expect(asTextOrNull(' Regal ')).toBe('Regal')
  })
})
