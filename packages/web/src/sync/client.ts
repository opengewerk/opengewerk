import {
  type ConflictReason,
  decideMerge,
  type FieldPatch,
  inOutboxOrder,
  isSetByServer,
  type Operation,
  type OperationId,
  type OperationKind,
  type OperationReceipt,
  policyFor,
  type RecordState,
  type SyncConflict,
  type SyncValue,
  sameValue,
  toSyncValue,
} from '@opengewerk/domain'
import { uuidv7 } from 'uuidv7'

import { byRecord, project, recordKey } from './projection.js'
import type { LocalStore, StoredFile } from './store.js'
import { isUnauthenticated, RequestRefused, type SyncTransport } from './transport.js'

/**
 * The way a change that needs a connection reaches the server: at the route
 * that owns the record, not through the outbox.
 */
export interface DirectWriter {
  patch(entity: string, id: string, values: Readonly<Record<string, unknown>>): Promise<unknown>
  remove(entity: string, id: string): Promise<unknown>
}

/** What the bar at the top of every screen says. */
export type SyncState = 'synced' | 'offline' | 'conflict' | 'refused'

/**
 * An operation the server refused outright, with the sentence it gave.
 *
 * Not a conflict: nobody else changed anything. The operation is wrong in
 * itself, which only a faulty client sends (ADR 0005), or it needs a right the
 * person no longer has. The server refuses the whole transmission over it and
 * names it, and until a person lets it go, nothing queued behind it gets out
 * (#120).
 */
export interface RefusedOperation {
  readonly operation: Operation
  readonly message: string
}

export interface SyncSnapshot {
  readonly state: SyncState
  /** Operations still waiting in the outbox. */
  readonly pending: number
  readonly conflicts: readonly SyncConflict[]
  /** When the last exchange with the server finished. Null until one has. */
  readonly lastSyncedAt: Date | null
  readonly exchanging: boolean
  /**
   * What the browser claims about the network. A hint and not a measurement:
   * it says online on a hotel network that answers nothing. Used to grey out
   * the one kind of change that cannot be queued, never to decide whether
   * something arrived.
   */
  readonly online: boolean
  /** The last thing that went wrong, for the bar to say out loud. */
  readonly trouble: string | null
  /** The operation the outbox is stuck on, until somebody lets it go. */
  readonly refused: RefusedOperation | null
}

export type EditResult =
  | { readonly outcome: 'queued'; readonly id: string }
  | {
      readonly outcome: 'refused'
      readonly reason: ConflictReason
      readonly fields: readonly string[]
    }

/** Values on their way in, before anything decides they are patchable. */
export type Draft = Readonly<Record<string, unknown>>

const cursorKey = 'cursor'

/**
 * The kinds of record the build knew that last moved the cursor, as a sorted
 * list with commas.
 */
const entitiesKey = 'entities'

/**
 * Whether the cursor in the store can be trusted by this build.
 *
 * A build skips the rows of a kind it does not know and moves the cursor past
 * them all the same, which is right while it has no screen for them. The next
 * build does, and asking from that cursor it would never see those rows: they
 * sit behind it. It happened with the first new kind after the offline layer
 * shipped. A device still running the old build from its service worker
 * pulled the signatures, dropped them, and after "Jetzt übernehmen" the new
 * build showed signed reports without a signature.
 *
 * So the cursor only stands when the build that wrote it knew at least what
 * this one knows. A store without the list was written before the list
 * existed, and its cursor does not stand either. Starting again from the
 * beginning costs one full pull and nothing else: a pull only overwrites rows
 * by their id, and the outbox is laid over whatever arrives.
 */
function cursorStands(known: string | number | null, entities: readonly string[]): boolean {
  if (typeof known !== 'string') {
    return false
  }

  const knew = new Set(known.split(','))

  return entities.every((entity) => knew.has(entity))
}

/**
 * The reason a refusal reads the way it does, in words a person can act on.
 *
 * Deliberately not a mapping from the reason to a technical phrase. Each of
 * these ends in what to do next, because the alternative is a person looking
 * at "record_is_fixed" on a phone in a cellar.
 */
export const refusalText: Readonly<Record<ConflictReason, string>> = {
  changed_elsewhere: 'Jemand anderes hat das inzwischen geändert. Bitte neu ansehen.',
  record_is_fixed: 'Das ist festgeschrieben und lässt sich nicht mehr ändern.',
  online_only: 'Das geht nur mit Verbindung. Der Eintrag bleibt, bis wieder Netz da ist.',
  record_missing: 'Den Datensatz gibt es nicht mehr.',
  unknown_entity: 'Diese Art von Datensatz kennt die Instanz nicht.',
  set_by_server: 'Dieses Feld vergibt der Server, nicht das Gerät.',
}

/**
 * The offline data layer of ADR 0005, as the interface uses it.
 *
 * Three things live in here and are deliberately not mixed. What the server
 * last said, kept in memory and mirrored into IndexedDB. What this device
 * still wants, in the outbox. And what nobody could reconcile, the conflicts.
 * Every screen reads the first two laid over each other and shows the third
 * in a bar it cannot dismiss.
 *
 * Reads are synchronous. A list of customers must not wait on a promise while
 * somebody types into a filter, and it need not: the whole of a small
 * business fits in memory many times over, and the disk copy only has to be
 * read once at start.
 */
export class SyncClient {
  private readonly records = new Map<string, Map<string, RecordState>>()
  private outbox: readonly Operation[] = []
  /** The outbox by record, which is what "not sent yet" asks. */
  private pending: ReadonlyMap<string, Operation[]> = new Map()
  /**
   * Operations the server applied that no pull has brought back yet (#181).
   *
   * The outbox lets go of an operation as soon as the server answers, and the
   * row it made arrives only with the pull after that. Laid over nothing in
   * between, a customer just entered vanished from its list for a round trip
   * and came back as a new element, and a changed value showed its old one.
   * These stay laid over the server's rows until the next pull has finished;
   * they no longer count as waiting, which they are not.
   */
  private settling: readonly Operation[] = []
  /** What is laid over the server's rows: what settles, then what waits. */
  private laid: ReadonlyMap<string, Operation[]> = new Map()
  private readonly listeners = new Set<() => void>()
  private readonly lists = new Map<string, readonly RecordState[]>()
  private readonly projected = new Map<string, RecordState | null>()

  private cursor = 0
  /**
   * How many files made here wait for their upload. Counted and not asked of
   * the store on every exchange: without a file waiting, an exchange goes
   * straight to the outbox, as it did before there were files (#77).
   */
  private filesWaiting = 0
  private snapshot: SyncSnapshot = {
    state: 'offline',
    pending: 0,
    conflicts: [],
    lastSyncedAt: null,
    exchanging: false,
    online: true,
    trouble: null,
    refused: null,
  }

  /** Bumped on every change, so React has one number to watch. */
  private generation = 0
  private running: Promise<void> | null = null
  private wanted = false
  private stopListening: (() => void) | null = null

  private constructor(
    private readonly store: LocalStore,
    private readonly transport: SyncTransport,
    private readonly writer: DirectWriter,
    readonly deviceId: string,
    /** Called when the session has expired, so the app can ask again. */
    private readonly onSignedOut: () => void,
  ) {}

  /**
   * Opens the local store, reads everything back into memory and starts
   * listening for the network coming and going.
   *
   * Everything a screen needs is in memory when this resolves, which is why it
   * is the one asynchronous step. A device that has been offline for a week
   * shows its data before it has said a word to the server.
   */
  static async start(options: {
    store: LocalStore
    transport: SyncTransport
    writer: DirectWriter
    /**
     * This device, as the sign in already told the server. Handed in rather
     * than minted here: it is settled before a business is chosen, and the
     * store only exists once one has been.
     */
    deviceId: string
    entities: readonly string[]
    onSignedOut: () => void
  }): Promise<SyncClient> {
    const { store, transport, writer, deviceId, entities, onSignedOut } = options

    const client = new SyncClient(store, transport, writer, deviceId, onSignedOut)

    const cursor = await store.readMeta(cursorKey)
    const known = await store.readMeta(entitiesKey)
    const list = [...entities].sort().join(',')
    const stands = cursorStands(known, entities)

    client.cursor = typeof cursor === 'number' && stands ? cursor : 0

    // The cursor first. The other way round, a device closed in between would
    // keep a list that vouches for a cursor nobody checked. And the list on
    // every change, a shorter one included: a build that knows less moves the
    // cursor past the rows it drops, and the next longer list must not find a
    // record that says otherwise.
    if (!stands) {
      await store.writeMeta(cursorKey, client.cursor)
    }

    if (known !== list) {
      await store.writeMeta(entitiesKey, list)
    }

    for (const entity of entities) {
      const rows = await store.readAll(entity)
      const byId = new Map<string, RecordState>()

      for (const row of rows) {
        byId.set(String(row['id']), row)
      }

      client.records.set(entity, byId)
    }

    client.outbox = await store.readOutbox()
    client.filesWaiting = await store.countWaitingFiles()
    client.regroup()
    client.snapshot = {
      ...client.snapshot,
      pending: client.outbox.length,
      conflicts: await store.readConflicts(),
    }
    client.snapshot = {
      ...client.snapshot,
      online: globalThis.navigator?.onLine !== false,
      state: client.decideState(),
    }
    client.watchTheNetwork()

    return client
  }

  private watchTheNetwork(): void {
    const online = () => {
      this.publish({ online: true })
      void this.synchronise()
    }
    const offline = () => {
      // The state itself is worked out from the outbox and nowhere else. The
      // browser's flag is a hint and a famously unreliable one: it says online
      // on a hotel network that answers nothing.
      this.publish({ online: false, trouble: 'Keine Verbindung.' })
    }

    globalThis.addEventListener('online', online)
    globalThis.addEventListener('offline', offline)

    this.stopListening = () => {
      globalThis.removeEventListener('online', online)
      globalThis.removeEventListener('offline', offline)
    }
  }

  stop(): void {
    this.stopListening?.()
    this.stopListening = null
    this.store.close()
  }

  // Reading

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  /** One number that changes whenever anything a screen shows has changed. */
  version = (): number => this.generation

  status = (): SyncSnapshot => this.snapshot

  /**
   * Everything of one kind that still exists, outbox laid over it.
   *
   * The result is cached per kind and thrown away on the next change, because
   * a hook that memoises on the version number needs the same array back when
   * nothing has happened.
   */
  list(entity: string): readonly RecordState[] {
    const cached = this.lists.get(entity)

    if (cached) {
      return cached
    }

    const seen = new Set<string>()
    const rows: RecordState[] = []

    for (const [id] of this.records.get(entity) ?? []) {
      seen.add(id)

      const row = this.get(entity, id)

      if (row) {
        rows.push(row)
      }
    }

    // Records this device made and has not sent yet exist only in the outbox.
    // Leaving them out would mean a customer entered in a cellar disappears
    // from the list the moment the form closes. The same for one the server
    // has taken and no pull has brought back yet.
    for (const operation of [...this.settling, ...this.outbox]) {
      if (operation.entity !== entity || seen.has(operation.recordId)) {
        continue
      }

      seen.add(operation.recordId)

      const row = this.get(entity, operation.recordId)

      if (row) {
        rows.push(row)
      }
    }

    this.lists.set(entity, rows)

    return rows
  }

  /**
   * One record as the screen should show it, or null when it is gone.
   *
   * Cached until the next change, like the lists and for the same reason: a
   * hook that subscribes to this has to get the same object back while nothing
   * has happened, or React sees a new value on every render and never stops.
   */
  get(entity: string, id: string): RecordState | null {
    const key = recordKey(entity, id)
    const cached = this.projected.get(key)

    if (cached !== undefined) {
      return cached
    }

    const server = this.records.get(entity)?.get(id) ?? null
    const laid = project(server, this.laid.get(key) ?? [], id)

    // A row marked deleted is kept in the store, because a repeated create has
    // to find it. It is not a row any screen shows.
    const shown = laid && sameValue(laid['deletedAt'], null) ? laid : null

    this.projected.set(key, shown)

    return shown
  }

  /** True while this record has not reached the server yet. */
  isPending(entity: string, id: string): boolean {
    return this.pending.has(recordKey(entity, id))
  }

  // Writing

  create(entity: string, values: Draft): Promise<EditResult> {
    return this.edit(entity, uuidv7(), 'create', values)
  }

  /**
   * Changes a record, by whichever of the two ways its policy allows.
   *
   * `change: 'never'` in the policy does not mean a record is read only. It
   * means a change to it needs a connection, so it goes straight at the route
   * that owns it instead of into the outbox. Reading it as "never" would leave
   * the office unable to correct a customer's address at all, which was the
   * first thing that broke when these screens were built.
   */
  update(entity: string, id: string, values: Draft): Promise<EditResult> {
    return this.needsConnection(entity)
      ? this.writeDirectly(entity, id, values)
      : this.edit(entity, id, 'update', values)
  }

  remove(entity: string, id: string): Promise<EditResult> {
    return this.needsConnection(entity)
      ? this.writeDirectly(entity, id, null)
      : this.edit(entity, id, 'delete', {})
  }

  /** True when a change to this kind of record cannot wait in an outbox. */
  needsConnection(entity: string): boolean {
    return policyFor(entity)?.change === 'never'
  }

  /**
   * A change that has to happen now, at the route that owns the record.
   *
   * Everything about it is the same afterwards: the change is in the audit
   * log, the trigger has bumped the version, and the pull that follows brings
   * the new row down so the screen shows what the server holds rather than
   * what this device hoped for.
   */
  private async writeDirectly(
    entity: string,
    id: string,
    values: Draft | null,
  ): Promise<EditResult> {
    try {
      if (values === null) {
        await this.writer.remove(entity, id)
      } else {
        const sendable = Object.fromEntries(
          Object.entries(values).filter(([field]) => !isSetByServer(entity, field)),
        )

        await this.writer.patch(entity, id, sendable)
      }

      await this.synchronise()

      return { outcome: 'queued', id }
    } catch (error) {
      if (isUnauthenticated(error)) {
        this.onSignedOut()
      }

      // Without a connection this is the one refusal the interface can act on:
      // it is the same answer the merge would have given, and it says the
      // change has to wait for a network rather than that it was lost.
      this.publish({
        trouble: error instanceof RequestRefused ? error.message : 'Keine Verbindung.',
      })

      return { outcome: 'refused', reason: 'online_only', fields: [] }
    }
  }

  /**
   * Puts one write into the outbox, after asking the same question the server
   * will ask.
   *
   * The local check is the reason `decideMerge` lives in `domain`. A device
   * that only found out after sending could show nothing but "it did not
   * work, some time ago"; this way a document that has been issued refuses the
   * edit while the form is still open and the person still knows what they
   * meant.
   *
   * It is not a guarantee, and it is not meant to be. The device judges by
   * what it last heard, so a record somebody else changed a minute ago passes
   * here and collides at the server. That collision becomes a conflict, which
   * is the one thing this layer never resolves by itself.
   */
  private async edit(
    entity: string,
    id: string,
    kind: OperationKind,
    values: Draft,
  ): Promise<EditResult> {
    const current = kind === 'create' ? null : this.get(entity, id)
    const patches = this.patchesFor(entity, current, values)

    if (kind === 'update' && patches.length === 0) {
      // Nothing changed. Queueing it would put an operation in front of the
      // server that asks it to do nothing, and a receipt in front of a person.
      return { outcome: 'queued', id }
    }

    const operation: Operation = {
      id: uuidv7() as OperationId,
      entity,
      recordId: id,
      kind,
      baseVersion: typeof current?.['version'] === 'number' ? current['version'] : null,
      patches,
      recordedAt: new Date(),
      deviceId: this.deviceId,
    }

    const decision = decideMerge(operation, current, this.parentFor(operation, current))

    if (decision.outcome === 'conflict') {
      return { outcome: 'refused', reason: decision.reason, fields: decision.fields }
    }

    if (decision.outcome === 'skip') {
      return { outcome: 'queued', id }
    }

    await this.store.queue(operation)
    this.outbox = [...this.outbox, operation]
    this.regroup()
    this.publish({ pending: this.outbox.length })

    // Deliberately not awaited. A form must close when the entry is safe on
    // the device, not when a server somewhere has heard about it.
    void this.synchronise()

    return { outcome: 'queued', id }
  }

  /**
   * The fields that really change, with what the device saw in them.
   *
   * `from` is what makes a merge on field level possible at all: it lets the
   * server answer whether anybody else touched this one field, without either
   * side keeping a clock per field.
   */
  private patchesFor(
    entity: string,
    current: RecordState | null,
    values: Draft,
  ): readonly FieldPatch[] {
    const patches: FieldPatch[] = []

    for (const [field, raw] of Object.entries(values)) {
      if (isSetByServer(entity, field)) {
        // Sending one of these is refused outright by the server, for the
        // whole transmission. Dropping it here keeps a form that happens to
        // carry the whole record from taking the outbox down with it.
        continue
      }

      const to = toSyncValue(raw)
      const from: SyncValue = current ? (current[field] ?? null) : null

      if (!sameValue(from, to)) {
        patches.push({ field, from, to })
      }
    }

    return patches
  }

  /**
   * The record a gate hangs on, when the policy has one.
   *
   * A document line is the case: whether it may still be written follows from
   * the status of its document, not from anything on the line. The server
   * looks the parent up in the database; here it is looked up in what the
   * device holds, which is the point of the rule living in `domain`.
   *
   * The reference comes from the operation first and from the record second,
   * in the same order the server reads them. A new line exists only in the
   * operation that creates it, so reading the record alone found no document
   * for it, and every line added on this device was refused on the spot as
   * belonging to nothing. Nobody noticed until #72, which is the first screen
   * that adds lines at all.
   */
  private parentFor(operation: Operation, current: RecordState | null): RecordState | null {
    const gate = policyFor(operation.entity)?.gateFrom

    if (!gate) {
      return null
    }

    const patched = operation.patches.find((patch) => patch.field === gate.reference)
    const reference = patched ? patched.to : (current?.[gate.reference] ?? null)

    return typeof reference === 'string' ? this.get(gate.entity, reference) : null
  }

  // Exchanging

  /**
   * Push, then pull, then fetch the conflicts.
   *
   * The order is not a preference. Pushing first means the server has seen
   * this device's changes before it answers what has changed, so the delta
   * that comes back already contains them and the local copy converges in one
   * round instead of two. Conflicts last, because pushing is what makes them.
   */
  async synchronise(): Promise<void> {
    // Asked for, whether or not one is running. A request that arrived while
    // an exchange was in flight used to be dropped, and the operation it was
    // made for then sat in the outbox until something else happened to
    // trigger a round. On a device that is mostly idle that is a long time,
    // and nothing on the screen says so.
    this.wanted = true

    if (this.running) {
      return this.running
    }

    this.running = (async () => {
      try {
        while (this.wanted) {
          this.wanted = false

          await this.exchange()
        }
      } finally {
        this.running = null
      }
    })()

    return this.running
  }

  private async exchange(): Promise<void> {
    this.publish({ exchanging: true, trouble: null })

    try {
      // A push refused over one operation does not stop the pull. What comes
      // down only overwrites rows by their id, and the outbox is laid over it
      // as over anything else. Stopping here left a device without the jobs of
      // the next day for as long as the one entry stayed (#120).
      // The files first: a version names its file by hash, and the server
      // finds the file only if it arrived before the version did (#77).
      if (this.filesWaiting > 0) {
        await this.uploadFiles()
      }

      const refused = await this.pushOutbox()

      await this.pullChanges()

      // Everything that settled is in the rows now, as the server holds it.
      if (this.settling.length > 0) {
        this.settling = []
        this.regroup()
      }
      await this.refreshConflicts()

      this.publish({ lastSyncedAt: new Date(), exchanging: false, trouble: null, refused })
    } catch (error) {
      if (isUnauthenticated(error)) {
        this.publish({ exchanging: false, trouble: 'Die Anmeldung ist abgelaufen.' })
        this.wanted = false
        this.onSignedOut()

        return
      }

      this.publish({
        exchanging: false,
        trouble:
          error instanceof RequestRefused
            ? error.message
            : 'Keine Verbindung. Die Änderungen bleiben auf dem Gerät.',
      })

      // Nothing is asked for again after a failure. Whoever comes back, the
      // network or a person pressing the button, starts the next round; a
      // retry from here would turn a refusal into a loop against a server
      // that has already given its answer.
      this.wanted = false
    }
  }

  /**
   * Sends the outbox. Answers with the operation it was refused over, when the
   * server named one this device still holds, and with null otherwise.
   */
  private async pushOutbox(): Promise<RefusedOperation | null> {
    if (this.outbox.length === 0) {
      return null
    }

    const sent = inOutboxOrder(this.outbox)
    let receipts: readonly OperationReceipt[]

    try {
      receipts = await this.transport.push(this.deviceId, sent)
    } catch (error) {
      const refused = this.refusedOver(error)

      if (refused) {
        return refused
      }

      throw error
    }

    const done = new Set<OperationId>()
    const applied = new Set<OperationId>()

    for (const receipt of receipts) {
      // Every outcome empties the slot, a conflict included. The server has
      // written the conflict down and it now lives in that list, where a
      // person decides it. An operation kept in the outbox for it would be
      // sent again on every exchange and produce the same conflict for ever.
      done.add(receipt.operationId)

      if (receipt.outcome === 'applied') {
        applied.add(receipt.operationId)
      }
    }

    await this.store.dequeue([...done])
    // What landed stays laid over the rows until the pull brings them. What
    // did not land is not shown at all: a conflict is on its own list, and a
    // skipped operation changed nothing.
    this.settling = [
      ...this.settling,
      ...this.outbox.filter((operation) => applied.has(operation.id)),
    ]
    this.outbox = this.outbox.filter((operation) => !done.has(operation.id))
    this.regroup()
    this.publish({ pending: this.outbox.length })

    return null
  }

  /**
   * The operation a refusal names, when it is one this device still holds.
   *
   * Anything else is nothing a person here could let go of. A refusal without
   * a name comes from a client speaking the wrong protocol, which the next
   * build fixes, since the wire form is made at sending and not stored; a lost
   * connection is no refusal at all.
   */
  private refusedOver(error: unknown): RefusedOperation | null {
    if (!(error instanceof RequestRefused)) {
      return null
    }

    const named = (error.body as { operationId?: unknown } | null)?.operationId
    const operation = this.outbox.find((entry) => entry.id === named)

    return operation ? { operation, message: error.message } : null
  }

  private async pullChanges(): Promise<void> {
    let guard = 0

    for (;;) {
      const answer = await this.transport.pull(this.cursor)

      for (const change of answer.changes) {
        const byId = this.records.get(change.entity)

        if (!byId) {
          // An entity this build does not know about. Not an error: an older
          // client talking to a newer server is the ordinary case during an
          // update, and it has no screen for those rows anyway.
          continue
        }

        for (const row of change.rows) {
          byId.set(String(row['id']), row)
        }

        await this.store.write(change.entity, change.rows)
      }

      this.cursor = answer.cursor
      await this.store.writeMeta(cursorKey, this.cursor)
      this.publish({})

      // `hasMore` means the server stopped at its limit. Asking again is the
      // whole point; the counter is there so a server that always says yes
      // cannot spin this for ever.
      if (!answer.hasMore || (guard += 1) > 100) {
        return
      }
    }
  }

  private async refreshConflicts(): Promise<void> {
    const conflicts = await this.transport.conflicts()

    await this.store.writeConflicts(conflicts)
    this.publish({ conflicts })
  }

  /**
   * Says that a conflict has been looked at. What the decision was is an
   * ordinary change and goes through the outbox like any other; this only
   * takes the entry off the list.
   */
  // Files

  /**
   * Keeps the bytes of a file made on this device, until the server has them
   * and for the screens that show them after, and says what a version names
   * them by (#77). The upload comes with the next exchange, ahead of the
   * version, so a photo taken without a network goes up when the network is
   * back, like everything else made in the cellar.
   */
  async keepFile(
    bytes: ArrayBuffer,
    mediaType: string,
  ): Promise<{ readonly sha256: string; readonly sizeBytes: number }> {
    const sha256 = await sha256Of(bytes)

    await this.store.keepFile({ sha256, bytes, mediaType }, true)
    this.filesWaiting += 1

    return { sha256, sizeBytes: bytes.byteLength }
  }

  /** A file this device holds, made here or fetched before; null for any other. */
  readFile(sha256: string): Promise<StoredFile | null> {
    return this.store.readFile(sha256)
  }

  /**
   * Keeps a file fetched from the server, a preview first of all, so that it
   * shows without a network the next time. Nothing to upload: the server is
   * where it came from.
   */
  rememberFile(sha256: string, bytes: ArrayBuffer, mediaType: string): Promise<void> {
    return this.store.keepFile({ sha256, bytes, mediaType }, false)
  }

  /**
   * Sends the files made here that the server does not have yet, oldest
   * first.
   *
   * A lost connection stops the exchange, and the files wait with the outbox.
   * A refusal of one file does not: too large or damaged on the device, it
   * would get the same answer every time. It comes off the list, and the
   * version that names it comes back as a conflict about that version, which
   * is where a person sees it and can let it go.
   */
  private async uploadFiles(): Promise<void> {
    const waiting = await this.store.waitingFiles()

    if (waiting.length === 0) {
      this.filesWaiting = 0

      return
    }

    if (!this.transport.upload) {
      throw new Error('Dieser Abgleich kann keine Dateien hochladen.')
    }

    for (const file of waiting) {
      try {
        await this.transport.upload(file.sha256, file.bytes, file.mediaType)
      } catch (error) {
        if (!(error instanceof RequestRefused) || isUnauthenticated(error)) {
          throw error
        }
      }

      await this.store.fileSent(file.sha256)
    }

    // Counted again rather than set to nothing: a photo taken while this ran
    // is on the list and was not in the batch.
    this.filesWaiting = await this.store.countWaitingFiles()
  }

  async resolveConflict(id: string): Promise<void> {
    await this.transport.resolve(id)
    await this.store.dropConflict(id)
    this.publish({ conflicts: this.snapshot.conflicts.filter((entry) => entry.id !== id) })
  }

  /**
   * Lets go of an operation the server refused outright, on this device.
   *
   * A create takes the later changes to the same record with it: none of them
   * can land without it, and each would come back as a conflict about a
   * record that is not there. Records that point at it are left alone. The
   * server answers for them as for any missing parent, with a conflict
   * somebody sees, and that is better than losing them without a word.
   */
  async discard(operationId: OperationId): Promise<void> {
    const refused = this.outbox.find((operation) => operation.id === operationId)

    if (!refused) {
      return
    }

    const going = new Set(
      this.outbox
        .filter(
          (operation) =>
            operation.id === refused.id ||
            (refused.kind === 'create' &&
              operation.entity === refused.entity &&
              operation.recordId === refused.recordId),
        )
        .map((operation) => operation.id),
    )

    await this.store.dequeue([...going])
    this.outbox = this.outbox.filter((operation) => !going.has(operation.id))
    this.regroup()
    this.publish({ pending: this.outbox.length, refused: null })

    await this.synchronise()
  }

  /** Everything this device holds of this business, gone. Signing out. */
  async forget(): Promise<void> {
    await this.store.clear()
  }

  // Bookkeeping

  /** The two views of the queue, after it changed. */
  private regroup(): void {
    this.pending = byRecord(this.outbox)
    this.laid = byRecord([...this.settling, ...this.outbox])
  }

  private decideState(): SyncState {
    // Ahead of the conflicts. While the outbox is stuck, a decision on one of
    // them does not get out either, because a decision leaves through it.
    if (this.snapshot.refused) {
      return 'refused'
    }

    if (this.snapshot.conflicts.length > 0) {
      return 'conflict'
    }

    // The outbox is the honest measure, not `navigator.onLine`. A browser
    // reports itself online on a hotel network that answers nothing, and a
    // queue that is empty means everything arrived whatever the flag says.
    return this.outbox.length === 0 && this.snapshot.trouble === null ? 'synced' : 'offline'
  }

  private publish(change: Partial<Omit<SyncSnapshot, 'state'>>): void {
    this.snapshot = { ...this.snapshot, ...change }
    this.snapshot = { ...this.snapshot, state: this.decideState() }
    this.lists.clear()
    this.projected.clear()
    this.generation += 1

    for (const listener of this.listeners) {
      listener()
    }
  }
}

/** SHA-256 in lower case hex, the name the server stores a file under. */
async function sha256Of(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
