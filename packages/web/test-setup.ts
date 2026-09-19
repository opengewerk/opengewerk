import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only tears the document down by itself when vitest runs with
// globals, and this repository keeps those off. Without it the second render
// in a file lands next to the first, and a query finds two buttons where the
// test meant one. The failure reads like a bug in the component.
afterEach(cleanup)
