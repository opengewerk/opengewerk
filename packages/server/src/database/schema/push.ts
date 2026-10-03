import { pushEntries, pushOccasions } from '@opengewerk/domain'
import { pushSchema } from '@opengewerk/platform-server'

/**
 * Push to the devices of the people in a business (#284). The devices, the
 * occasions somebody switched off and the outbox are the foundation's
 * (`pushSchema`, ADR 0010); the entries and occasions are this application's:
 * a device works in the office or on site, and the occasions are the task due
 * this morning and the deadline that reminds (`pushOccasions` in `domain`).
 * The foundation adds its test message from "Konto" at the end.
 */
export const push = pushSchema({ entries: pushEntries, occasions: pushOccasions })

export const { pushEntry, pushKind, pushStatus, pushSubscriptions, pushOptOuts, pushOutbox } = push
