import { createContext, useContext } from 'react'

/**
 * Whether a field or a button stands in the gate before sign in, the boards
 * of the page "Vor der Anmeldung" in the canvas (#219). The gate is neither the
 * office nor the site: it comes before either and serves both, so it has sizes
 * of its own, fields of 42 pixels at a desk and 52 on a phone, buttons of 46
 * and 56, and a quiet button that is an underlined line of copper text.
 */
const InGate = createContext(false)

export const GateProvider = InGate.Provider

export function useInGate(): boolean {
  return useContext(InGate)
}
