import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { workingInHeader } from '@opengewerk/platform-domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { workIn } from '../sync/transport.js'
import { tableExportWords, useTableExport } from './table-export.js'

/**
 * "Als Tabelle" at a list that belongs to nobody: the shelves of a store. The
 * route and what the list is narrowed by are the application's; the button,
 * the menu and the file are the foundation's.
 */

function Head({ address }: { readonly address: string }) {
  const { button, trouble } = useTableExport(address)

  return (
    <div>
      {button}
      {trouble}
    </div>
  )
}

/** The window as wide as a band of the boards. */
function width(pixels: number): void {
  const minimum = (query: string) => Number(/min-width: ([\d.]+)rem/.exec(query)?.[1] ?? '0') * 16

  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: pixels >= minimum(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

/** What the server answers, and what was asked of it. */
function server(answer: () => Promise<Response>) {
  const asked: { url: string; init: RequestInit | undefined }[] = []

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      asked.push({ url, init })

      return answer()
    }),
  )

  return asked
}

/** The files the page handed to the browser to save, by name. */
function saved(): string[] {
  const names: string[] = []

  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download)
  })
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:tabelle', revokeObjectURL: () => {} }),
  )

  return names
}

const workbook = () =>
  Promise.resolve(
    new Response(new Uint8Array([0x50, 0x4b, 3, 4]), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Regale 2026-10-11.xlsx"; filename*=UTF-8''Regale%20%C3%BCberall%202026-10-11.xlsx`,
      },
    }),
  )

beforeEach(() => {
  width(1280)
  workIn('tenant-1')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the table of a list', () => {
  it('is offered as Excel and as CSV in a menu under the button', async () => {
    const user = userEvent.setup()

    render(<Head address="/shelves/table" />)
    await user.click(screen.getByRole('button', { name: tableExportWords.button }))

    const menu = screen.getByRole('menu', { name: tableExportWords.menu })

    expect([...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual(
      ['Excel (.xlsx)', 'CSV (.csv)'],
    )
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Excel (.xlsx)' }))
  })

  it('is fetched with the format beside what the list is narrowed by, for the tenant of the page', async () => {
    const user = userEvent.setup()
    const asked = server(workbook)
    const names = saved()

    render(<Head address="/shelves/table?aisle=3" />)
    await user.click(screen.getByRole('button', { name: tableExportWords.button }))
    await user.click(screen.getByRole('menuitem', { name: 'CSV (.csv)' }))

    await waitFor(() => {
      expect(names).toEqual(['Regale überall 2026-10-11.xlsx'])
    })
    expect(asked.map(({ url }) => url)).toEqual(['/shelves/table?aisle=3&format=csv'])
    expect(asked[0]?.init?.credentials).toBe('include')
    expect(asked[0]?.init?.headers).toMatchObject({ [workingInHeader]: 'tenant-1' })
  })

  it('is saved under the name the server gave it, and asked for with a question mark where the address has none', async () => {
    const user = userEvent.setup()
    const asked = server(workbook)
    const names = saved()

    render(<Head address="/shelves/table" />)
    await user.click(screen.getByRole('button', { name: tableExportWords.button }))
    await user.click(screen.getByRole('menuitem', { name: 'Excel (.xlsx)' }))

    await waitFor(() => {
      expect(names).toEqual(['Regale überall 2026-10-11.xlsx'])
    })
    expect(asked.map(({ url }) => url)).toEqual(['/shelves/table?format=xlsx'])
  })

  it('says what the server refused it with', async () => {
    const user = userEvent.setup()

    server(() =>
      Promise.resolve(Response.json({ message: 'Dafür fehlt das Recht.' }, { status: 403 })),
    )
    saved()

    render(<Head address="/shelves/table" />)
    await user.click(screen.getByRole('button', { name: tableExportWords.button }))
    await user.click(screen.getByRole('menuitem', { name: 'Excel (.xlsx)' }))

    expect(await screen.findByText('Dafür fehlt das Recht.')).toBeTruthy()
  })

  it('says that it needs a connection, where there is none', async () => {
    const user = userEvent.setup()

    server(() => Promise.reject(new TypeError('Failed to fetch')))
    saved()

    render(<Head address="/shelves/table" />)
    await user.click(screen.getByRole('button', { name: tableExportWords.button }))
    await user.click(screen.getByRole('menuitem', { name: 'Excel (.xlsx)' }))

    expect(await screen.findByText(tableExportWords.offline)).toBeTruthy()
  })

  it('closes its menu with Escape and gives the focus back to the button', async () => {
    const user = userEvent.setup()

    render(<Head address="/shelves/table" />)
    await user.click(screen.getByRole('button', { name: tableExportWords.button }))
    await user.keyboard('{ArrowDown}')

    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'CSV (.csv)' }))

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: tableExportWords.button }),
    )
  })

  it('is not offered on a phone, where the list is a card per row', () => {
    width(390)
    render(<Head address="/shelves/table" />)

    expect(screen.queryByRole('button', { name: tableExportWords.button })).toBeNull()
  })

  it('is offered from a tablet on, where the list is a table', () => {
    width(768)
    render(<Head address="/shelves/table" />)

    expect(screen.getByRole('button', { name: tableExportWords.button })).toBeTruthy()
  })
})
