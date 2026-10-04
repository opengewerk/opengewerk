import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'

import type { Crumb } from '../components/crumb.js'

/**
 * Where a screen on site sits: what it stands under, each step a link, as the
 * path of the office says it and in the type of the site. It stands in the
 * content under the header of the screen, wraps where a phone is too narrow
 * for it and stays whole. The screen itself is the title in the header and
 * no step of the path.
 */
export function SiteCrumbs({ items }: { readonly items: readonly Crumb[] }) {
  return (
    <nav
      aria-label="Pfad"
      className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[15px] leading-[1.4]"
    >
      {items.map((item, index) => (
        <span key={item.to} className="inline-flex items-center gap-1.5">
          {index > 0 ? (
            <ChevronRight
              size={15}
              strokeWidth={2.2}
              aria-hidden="true"
              className="text-disabled"
            />
          ) : null}
          <Link to={item.to} className="text-ink-muted underline underline-offset-2">
            {item.label}
          </Link>
        </span>
      ))}
    </nav>
  )
}
