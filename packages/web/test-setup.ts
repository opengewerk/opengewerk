import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only tears the document down by itself when vitest runs with
// globals, and this repository keeps those off. Without it the second render
// in a file lands next to the first, and a query finds two buttons where the
// test meant one. The failure reads like a bug in the component.
afterEach(cleanup)

// A request no test answers goes nowhere (#440). The tests stub `fetch` with
// `vi.stubGlobal`, and `vi.unstubAllGlobals()` hands back what was there
// before: without this the real `fetch` of happy-dom, whose page is
// http://localhost:3000. A query still running after its test had ended, the
// account or the list of businesses, then went out on the network, and every
// run wrote dozens of ECONNREFUSED into the log, where a real error was easy
// to miss. Refused here the way a network that is down refuses, with a
// TypeError, so that the application reads it as no connection.
globalThis.fetch = ((input: RequestInfo | URL) =>
  Promise.reject(
    new TypeError(`Kein Netz in Tests: ${input instanceof Request ? input.url : String(input)}`),
  )) as typeof fetch
