import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import type { Crumb } from '../components/crumb.js'
import { InRouter } from '../in-router.js'
import { Crumbs } from '../office/kit.js'
import { SiteCrumbs } from './crumbs.js'

/**
 * The path over a screen on site: what the screen stands under, as the office
 * says it. An application says the steps of a screen once, and each entry
 * draws them in its own type.
 */

const steps: readonly Crumb[] = [
  { to: '/lager/nord', label: 'Lager Nord' },
  { to: '/lager/nord/gang-3', label: 'Gang 3' },
  { to: '/regale/r-7', label: 'Regal 7' },
]

async function shown(node: ReactNode) {
  const result = render(
    <InRouter>
      <div data-testid="shown">{node}</div>
    </InRouter>,
  )

  await screen.findByTestId('shown')

  return result
}

function path(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Pfad' })
}

/** The steps of a path as a reader meets them: what each is called and where it leads. */
function stepsOf(nav: HTMLElement): (string | null)[][] {
  return within(nav)
    .getAllByRole('link')
    .map((link) => [link.textContent, link.getAttribute('href')])
}

describe('the path over a screen on site', () => {
  it('names what the screen stands under, every step a link, in their order', async () => {
    await shown(<SiteCrumbs items={steps} />)

    expect(stepsOf(path())).toEqual([
      ['Lager Nord', '/lager/nord'],
      ['Gang 3', '/lager/nord/gang-3'],
      ['Regal 7', '/regale/r-7'],
    ])
  })

  it('draws an arrow between two steps and says none of them to a reader', async () => {
    await shown(<SiteCrumbs items={steps} />)

    const arrows = [...path().querySelectorAll('svg')]

    expect(arrows).toHaveLength(2)
    expect(arrows.every((arrow) => arrow.getAttribute('aria-hidden') === 'true')).toBe(true)
    // Before the first step stands nothing.
    expect(path().firstElementChild?.firstElementChild?.tagName).toBe('A')
    expect(path().textContent).toBe('Lager NordGang 3Regal 7')
  })

  it('says the same steps in the same words as the path of the office', async () => {
    const site = await shown(<SiteCrumbs items={steps} />)
    const onSite = stepsOf(path())

    site.unmount()
    await shown(<Crumbs items={steps} />)

    expect(onSite).toHaveLength(3)
    expect(stepsOf(path())).toEqual(onSite)
  })

  it('wraps where a phone is too narrow for it, in the type of the site', async () => {
    await shown(<SiteCrumbs items={steps} />)

    const classes = path().className.split(' ')

    expect(classes).toContain('flex-wrap')
    // 15 pixels, between the 17 of the text on site and the 13 of the office.
    expect(classes).toContain('text-[15px]')
  })

  it('stands as an empty path where a screen stands under nothing', async () => {
    await shown(<SiteCrumbs items={[]} />)

    expect(within(path()).queryAllByRole('link')).toEqual([])
  })
})
