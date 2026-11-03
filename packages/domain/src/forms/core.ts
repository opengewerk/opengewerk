import acceptanceV1 from './data/acceptance.v1.json' with { type: 'json' }
import type { FormDefinition } from './definition.js'

/**
 * The forms of the core: what belongs to no trade. First the acceptance of a
 * job after § 640 BGB (#310), which every trade does. Built in like the forms
 * of a trade package, and put beside them wherever forms are read, so that a
 * device fills it with the definition the server reads it with.
 */
export const coreForms: readonly FormDefinition[] = [acceptanceV1 as FormDefinition]
