// The offline data layer of ADR 0005, as an entry of its own:
// `@opengewerk/platform-web/sync`.
//
// What a device knows while it has no network, what it still wants to tell
// the server, and what nobody could reconcile. Which records that is and under
// which rules they travel, the application says when it starts the client
// (ADR 0010): the rules it made from its policies, the kinds of record it has
// a screen for, and what the device keeps for itself.

// The client, and what a screen learns from it about an edit and the state of
// the exchange.
export {
  inTransmissions,
  largestTransmission,
  refusalFor,
  refusalText,
  SyncClient,
} from './client.js'
export type {
  DirectWriter,
  Draft,
  EditResult,
  RefusedOperation,
  SyncSnapshot,
  SyncStart,
  SyncState,
} from './client.js'

// How a screen reads: the client from the context, and records as they stand
// with the outbox laid over them.
export {
  SyncProvider,
  useHoldsAll,
  useRecord,
  useRecords,
  useRelated,
  useSync,
  useSyncStatus,
} from './provider.js'
export { count, flag, maybeText, oneOf, same, text } from './fields.js'

// A form over one record, in the one shape every screen uses: it hands back
// what was typed, and shows what a refusal of the outbox said.
export { asBoolean, asTextOrNull, RecordForm, yesOrNo } from './record-form.js'
export type { FormField } from './record-form.js'

// Where a device keeps it all.
export { deleteLocalStore, openLocalStore, storesOnDevice, waitingIn } from './store.js'
export type { LocalStore, StoredFile, StoredRecord } from './store.js'

// The way to the server: the four calls of an exchange, a change at the route
// that owns a record, and every other request of a page, which names the
// tenant it works in.
export {
  directWrite,
  httpTransport,
  isForbidden,
  isUnauthenticated,
  request,
  RequestRefused,
  workIn,
  workingInHeaders,
} from './transport.js'
export type { ChangedRows, PullResult, SyncTransport } from './transport.js'

// The strip over every screen while something waits or has to be decided.
export { SyncStatusBar } from './bar.js'
