import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { RequestRefused } from '../sync/transport.js'
import { LabelCard } from './label-card.js'
import type { CardLabel, LabelCardProps, LabelCardWords } from './label-card.js'

/**
 * The card of a label in an application that belongs to nobody: a label on a
 * shelf. What a label hangs on, who may make and block one, the routes and
 * the sentences are handed in; the card is the foundation's.
 */

const words: LabelCardWords = {
  title: 'Etikett des Regals',
  none: 'Noch kein Etikett an diesem Regal.',
  blocking: (code) => `Das Etikett ${code} des Regals öffnet danach nichts mehr.`,
}

const label: CardLabel = {
  id: 'l-1',
  code: '7K2M9QX4TBA3HW8P',
  createdAt: '2026-09-28T09:00:00.000Z',
}

function mount(props: Partial<LabelCardProps> = {}) {
  const handed = {
    onMake: vi.fn(() => Promise.resolve()),
    onBlock: vi.fn((_: CardLabel) => Promise.resolve()),
  }

  render(
    <LabelCard
      words={words}
      valid={null}
      lastBlocked={null}
      online
      mayMake
      mayBlock
      pdfAddress={(printed, format, count, start) =>
        `/shelves/labels/${printed.id}/pdf?format=${format}&count=${String(count)}&start=${String(start)}`
      }
      {...handed}
      {...props}
    />,
  )

  return handed
}

function card() {
  return screen.getByRole('region', { name: 'Etikett des Regals' })
}

describe('the card of a label', () => {
  it('says in the words of the application what a label is for, and makes one', async () => {
    const user = userEvent.setup()
    const { onMake } = mount()

    expect(within(card()).getByText('Noch kein Etikett an diesem Regal.')).toBeTruthy()

    await user.click(within(card()).getByRole('button', { name: 'Etikett anlegen' }))

    expect(onMake).toHaveBeenCalledOnce()
  })

  it('offers nothing to make to somebody who may not', () => {
    mount({ mayMake: false })

    expect(within(card()).queryByRole('button', { name: 'Etikett anlegen' })).toBeNull()
  })

  it('names the label blocked last as long as there is no valid one', () => {
    mount({ lastBlocked: { code: '0000000000000001', blockedAt: '2026-10-01T10:00:00.000Z' } })

    expect(
      within(card()).getByText(
        'Kein gültiges Etikett. Das letzte ist gesperrt und öffnet nichts mehr.',
      ),
    ).toBeTruthy()
    expect(within(card()).getByText('0000-0000-0000-0001')).toBeTruthy()
    expect(within(card()).getByRole('button', { name: 'Neues Etikett anlegen' })).toBeTruthy()
  })

  it('prints the valid label for a label printer, and on a sheet from a free field', async () => {
    const user = userEvent.setup()

    mount({ valid: label })

    expect(within(card()).getByText('7K2M-9QX4-TBA3-HW8P')).toBeTruthy()
    expect(within(card()).getByRole('link', { name: 'PDF öffnen' }).getAttribute('href')).toBe(
      '/shelves/labels/l-1/pdf?format=roll&count=1&start=1',
    )

    await user.selectOptions(within(card()).getByLabelText('Format'), 'sheet')
    await user.clear(within(card()).getByLabelText('Anzahl'))
    await user.type(within(card()).getByLabelText('Anzahl'), '3')
    await user.clear(within(card()).getByLabelText('Beginnen bei'))
    await user.type(within(card()).getByLabelText('Beginnen bei'), '5')

    expect(within(card()).getByRole('link', { name: 'PDF öffnen' }).getAttribute('href')).toBe(
      '/shelves/labels/l-1/pdf?format=sheet&count=3&start=5',
    )
  })

  it('names a print it cannot make and offers no link for it', async () => {
    const user = userEvent.setup()

    mount({ valid: label })

    await user.clear(within(card()).getByLabelText('Anzahl'))
    await user.type(within(card()).getByLabelText('Anzahl'), '25')

    expect(within(card()).getByRole('alert').textContent).toBe(
      'Gedruckt werden 1 bis 24 Etiketten auf einmal.',
    )
    expect(within(card()).queryByRole('link', { name: 'PDF öffnen' })).toBeNull()
  })

  it('blocks only after asking, in the words of the application', async () => {
    const user = userEvent.setup()
    const { onBlock } = mount({ valid: label })

    await user.click(within(card()).getByRole('button', { name: 'Sperren' }))

    expect(onBlock).not.toHaveBeenCalled()

    const question = screen.getByRole('alertdialog')

    expect(
      within(question).getByText(
        'Das Etikett 7K2M-9QX4-TBA3-HW8P des Regals öffnet danach nichts mehr.',
      ),
    ).toBeTruthy()

    await user.click(within(question).getByRole('button', { name: 'Sperren' }))

    expect(onBlock).toHaveBeenCalledWith(label)
  })

  it('offers no blocking to somebody who may not', () => {
    mount({ valid: label, mayBlock: false })

    expect(within(card()).queryByRole('button', { name: 'Sperren' })).toBeNull()
    expect(within(card()).getByRole('link', { name: 'PDF öffnen' })).toBeTruthy()
  })

  it('says what the server said when it refused', async () => {
    const user = userEvent.setup()

    mount({
      onMake: () => Promise.reject(new RequestRefused(409, 'Dieses Regal hat schon ein Etikett.')),
    })

    await user.click(within(card()).getByRole('button', { name: 'Etikett anlegen' }))

    expect((await within(card()).findByRole('alert')).textContent).toBe(
      'Dieses Regal hat schon ein Etikett.',
    )
  })

  it('says without a connection that printing and blocking need one', () => {
    mount({ valid: label, online: false })

    expect(
      within(card()).getByText(
        'Drucken und Sperren gehen über den Server, dafür braucht es Verbindung.',
      ),
    ).toBeTruthy()
    expect(within(card()).queryByRole('link', { name: 'PDF öffnen' })).toBeNull()
    expect(
      (within(card()).getByRole('button', { name: 'Sperren' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
