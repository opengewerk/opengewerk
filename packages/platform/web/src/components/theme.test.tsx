import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Each test loads the module afresh: it keeps the current choice in module
 * state, and a choice left over from the test before would decide the next.
 */
async function freshTheme() {
  vi.resetModules()

  return import('./theme.js')
}

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the ground of a device', () => {
  it('is light on a device that never chose, whatever the system prefers', async () => {
    // The operating system may well be set to dark; it is not asked (#216).
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: query.includes('dark'),
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    )
    const { startTheme } = await freshTheme()

    startTheme()

    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('is what the device chose last time', async () => {
    localStorage.setItem('opengewerk.theme', 'dark')
    const { startTheme } = await freshTheme()

    startTheme()

    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('falls back to light for a value it does not know or a storage that refuses', async () => {
    const { storedTheme } = await freshTheme()

    expect(storedTheme({ getItem: () => 'purple' })).toBe('light')
    expect(
      storedTheme({
        getItem: () => {
          throw new Error('site data blocked')
        },
      }),
    ).toBe('light')
  })

  it('remembers a choice and applies it at once', async () => {
    const { chooseTheme } = await freshTheme()

    chooseTheme('dark')
    expect(localStorage.getItem('opengewerk.theme')).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    chooseTheme('light')
    expect(localStorage.getItem('opengewerk.theme')).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('still switches the page when the storage refuses to write', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    const { chooseTheme } = await freshTheme()

    chooseTheme('dark')

    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('follows another tab of the same installation', async () => {
    const { startTheme } = await freshTheme()
    startTheme()

    localStorage.setItem('opengewerk.theme', 'dark')
    globalThis.dispatchEvent(new StorageEvent('storage', { key: 'opengewerk.theme' }))

    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('gives a screen the choice and a way to change it', async () => {
    const { useTheme } = await freshTheme()

    function Probe() {
      const [theme, choose] = useTheme()

      return (
        <button
          type="button"
          onClick={() => {
            choose(theme === 'light' ? 'dark' : 'light')
          }}
        >
          {theme}
        </button>
      )
    }

    render(<Probe />)
    expect(screen.getByRole('button').textContent).toBe('light')

    act(() => {
      screen.getByRole('button').click()
    })

    expect(screen.getByRole('button').textContent).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
