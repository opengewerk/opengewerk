import { useRouterState } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

import { addressChanged, holdUpdates } from './updates.js'

/**
 * A new version that waits is taken when the address changes, in each of the
 * frames. The address that is drawn, not the one a navigation has set out
 * for: by then the screen that went has let go of whatever it held. The
 * address a page opens at is no change.
 */
export function useUpdateOnNavigation(): void {
  const path = useRouterState({
    select: (state) => (state.resolvedLocation ?? state.location).pathname,
  })
  const seen = useRef(path)

  useEffect(() => {
    if (seen.current !== path) {
      seen.current = path
      addressChanged()
    }
  }, [path])
}

/**
 * Holds a new version back while `holding` is true and the component stands:
 * a form while it holds what has not been saved, a pad while a signature is
 * on it.
 */
export function useHoldUpdates(holding: boolean): void {
  useEffect(() => (holding ? holdUpdates() : undefined), [holding])
}
