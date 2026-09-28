import type { RecordState } from '@opengewerk/domain'
import { inverterProblems, pvModuleProblems, pvStringProblems } from '@opengewerk/domain'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'

import {
  Button,
  cardLink,
  Cell,
  Column,
  Confirm,
  Panel,
  PanelLabel,
  TablePanel,
} from '../../components/index.js'
import { moveAmong, nextPosition, ordered } from '../../app/electrical.js'
import { installationKindLabel, installationKindOf } from '../../app/labels.js'
import {
  addModules,
  azimuthOf,
  batchCount,
  batchProblems,
  batchStart,
  figureOf,
  inputOf,
  inverterFields,
  inverterPower,
  makeAndModel,
  moduleBatchFields,
  moduleFields,
  modulesInWords,
  modulesPowerText,
  peakCell,
  PvForm,
  serialsMissingText,
  stringFields,
  stringsInWords,
  tiltOf,
  useInverters,
  usePvModules,
  usePvStrings,
} from '../../app/photovoltaic.js'
import { useMay } from '../../app/queries.js'
import { refusalFor } from '../../sync/client.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useRecords, useRelated, useSync } from '../../sync/provider.js'
import { FactList, Screen } from '../kit.js'
import { Reorder, SmallIcon } from './boards.js'
import {
  Detail,
  detailAnchor,
  Missing,
  RemoveButton,
  StructurePath,
  TreeItem,
  useScrollToDetail,
} from './structure.js'

/**
 * The PV structure below a PV system (#300), as the boards "Anlagenstruktur:
 * Wechselrichter" and "Anlagenstruktur: String mit Modulen" of the canvas draw
 * it: the tree of inverters and their strings at the left, what is selected in
 * it at the right, the path to the installation in the header, the way the
 * electrical structure next to it is built.
 *
 * An inverter and a string have their own addresses, `/wechselrichter/<id>`
 * and `/strings/<id>`; both show this screen with that part selected. The
 * modules stand at their string, with their serial numbers.
 */

type Making =
  { readonly kind: 'inverter' } | { readonly kind: 'string'; readonly inverterId: string }

export function InverterScreen() {
  const { inverterId } = useParams({ strict: false }) as { inverterId?: string }
  const inverter = useRecord('inverters', inverterId)

  if (!inverter || !inverterId) {
    return <Missing what="Diesen Wechselrichter" />
  }

  return (
    <PvStructureScreen
      installationId={text(inverter, 'installationId')}
      inverterId={inverterId}
      stringId={null}
    />
  )
}

export function PvStringScreen() {
  const { stringId } = useParams({ strict: false }) as { stringId?: string }
  const pvString = useRecord('pv_strings', stringId)
  const inverter = useRecord('inverters', maybeText(pvString, 'inverterId') ?? undefined)

  if (!pvString || !stringId || !inverter) {
    return <Missing what="Diesen String" />
  }

  return (
    <PvStructureScreen
      installationId={text(inverter, 'installationId')}
      inverterId={String(inverter['id'])}
      stringId={stringId}
    />
  )
}

function PvStructureScreen({
  installationId,
  inverterId,
  stringId,
}: {
  readonly installationId: string
  readonly inverterId: string
  readonly stringId: string | null
}) {
  const installation = useRecord('installations', installationId)
  const writes = useMay('installation.write')
  const [making, setMaking] = useState<Making | null>(null)
  const narrow = useScrollToDetail(making)
  const done = () => {
    setMaking(null)
  }

  const detail =
    making?.kind === 'inverter' ? (
      <NewInverter installationId={installationId} onDone={done} />
    ) : making?.kind === 'string' ? (
      <NewString inverterId={making.inverterId} onDone={done} />
    ) : stringId ? (
      <StringDetail key={stringId} stringId={stringId} />
    ) : (
      <InverterDetail
        key={inverterId}
        inverterId={inverterId}
        onNewString={() => {
          setMaking({ kind: 'string', inverterId })
        }}
      />
    )

  return (
    <Screen className="lg:grow">
      <StructurePath installationId={installationId} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-[24px] font-semibold text-ink">Anlagenstruktur</h1>
        <span className="text-[14px] text-ink-faint">Anlage, Wechselrichter, String, Modul</span>
        <div className="grow" />
        {writes ? (
          <Button
            tone="primary"
            icon={Plus}
            onClick={() => {
              setMaking({ kind: 'string', inverterId })
            }}
          >
            String
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-4 lg:min-h-0 lg:grow lg:flex-row">
        <PvTree
          installation={installation}
          installationId={installationId}
          inverterId={making ? null : inverterId}
          stringId={making ? null : stringId}
          hash={narrow ? detailAnchor : undefined}
          onNewInverter={
            writes
              ? () => {
                  setMaking({ kind: 'inverter' })
                }
              : undefined
          }
        />
        {detail}
      </div>
    </Screen>
  )
}

/**
 * The tree, `pv_tree()` of the canvas: every inverter of the system with its
 * power, and under the one that is selected, or holds the string that is, its
 * strings with how many modules each has.
 */
function PvTree({
  installation,
  installationId,
  inverterId,
  stringId,
  hash,
  onNewInverter,
}: {
  readonly installation: RecordState | null
  readonly installationId: string
  readonly inverterId: string | null
  readonly stringId: string | null
  readonly hash: string | undefined
  readonly onNewInverter: (() => void) | undefined
}) {
  const inverters = useInverters(installationId)
  const strings = useRecords('pv_strings')
  const modules = useRecords('pv_modules')

  return (
    <section
      aria-label="Struktur der Anlage"
      className="flex shrink-0 flex-col rounded-[5px] border border-line bg-surface lg:w-[360px]"
    >
      <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5">
        <PanelLabel>{text(installation, 'designation')}</PanelLabel>
        <div className="grow" />
        {onNewInverter ? (
          <Button size="small" icon={Plus} onClick={onNewInverter}>
            Wechselrichter
          </Button>
        ) : null}
      </div>
      <ul className="flex grow flex-col gap-0.5 px-3 py-2.5">
        {inverters.map((inverter) => {
          const id = String(inverter['id'])
          const own = ordered(strings.filter((pvString) => text(pvString, 'inverterId') === id))
          const holdsSelected = own.some((pvString) => String(pvString['id']) === stringId)
          const open = id === inverterId || holdsSelected

          return (
            <li key={id}>
              <TreeItem
                to={`/wechselrichter/${id}`}
                hash={hash}
                level={0}
                chevron={open ? 'down' : 'right'}
                strong
                selected={id === inverterId && stringId === null}
                meta={inverterPower(inverter) ?? stringsInWords(own.length)}
              >
                {text(inverter, 'designation')}
              </TreeItem>
              {open ? (
                <ul className="flex flex-col gap-0.5">
                  {own.map((pvString) => {
                    const stringKey = String(pvString['id'])

                    return (
                      <li key={stringKey}>
                        <TreeItem
                          to={`/strings/${stringKey}`}
                          hash={hash}
                          level={1}
                          selected={stringKey === stringId}
                          meta={modulesInWords(
                            modules.filter((module) => text(module, 'pvStringId') === stringKey)
                              .length,
                          )}
                        >
                          {text(pvString, 'designation')}
                        </TreeItem>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </li>
          )
        })}
        {inverters.length === 0 ? (
          <li className="px-2.5 py-1.5 text-[13px] leading-[1.4] text-ink-muted">
            Noch kein Wechselrichter.
          </li>
        ) : null}
      </ul>
      <p className="border-t border-line px-3.5 py-2.5 text-[13px] leading-[1.4] text-ink-muted">
        Die Module stehen an ihrem String, dort auch ihre Seriennummern: auf der Baustelle vom
        Etikett gescannt oder hier von Hand.
      </p>
    </section>
  )
}

/** Up and down in the head of a part, as the canvas draws them beside "Bearbeiten". */
function MoveButtons({
  name,
  index,
  total,
  onMove,
}: {
  readonly name: string
  readonly index: number
  readonly total: number
  readonly onMove: (step: -1 | 1) => void
}) {
  return (
    <>
      <SmallIcon
        compact
        label={`${name} nach oben`}
        disabled={index <= 0}
        onClick={() => {
          onMove(-1)
        }}
      >
        <ArrowUp size={14} strokeWidth={2} aria-hidden="true" />
      </SmallIcon>
      <SmallIcon
        compact
        label={`${name} nach unten`}
        disabled={index < 0 || index === total - 1}
        onClick={() => {
          onMove(1)
        }}
      >
        <ArrowDown size={14} strokeWidth={2} aria-hidden="true" />
      </SmallIcon>
    </>
  )
}

function Trouble({ children }: { readonly children: string | null }) {
  return children ? (
    <p role="alert" className="text-[13px] font-semibold text-conflict">
      {children}
    </p>
  ) : null
}

/** One inverter, `wechselrichter_detail()`: its facts, its strings, and what hangs at it. */
function InverterDetail({
  inverterId,
  onNewString,
}: {
  readonly inverterId: string
  readonly onNewString: () => void
}) {
  const client = useSync()
  const navigate = useNavigate()
  const writes = useMay('installation.write')
  const inverter = useRecord('inverters', inverterId)
  const installationId = text(inverter, 'installationId')
  const installation = useRecord('installations', installationId)
  const siblings = useInverters(installationId)
  const strings = usePvStrings(inverterId)
  const modules = useRecords('pv_modules')
  const attached = useRelated('installations', 'inverterId', inverterId)
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  if (!inverter) {
    return null
  }

  const name = text(inverter, 'designation')
  const index = siblings.findIndex((sibling) => String(sibling['id']) === inverterId)
  const moduleCount = modules.filter((module) =>
    strings.some((pvString) => String(pvString['id']) === text(module, 'pvStringId')),
  ).length

  async function move(step: -1 | 1) {
    const refused = await moveAmong(client, 'inverters', siblings, inverterId, step)

    setTrouble(refused && refused.outcome === 'refused' ? refusalFor(refused) : null)
  }

  async function remove() {
    setRemoving(false)

    const result = await client.remove('inverters', inverterId)

    if (result.outcome === 'refused') {
      setTrouble(refusalFor(result))

      return
    }

    await navigate({ to: `/anlagen/${installationId}` })
  }

  if (editing) {
    return (
      <Detail title={`${name} bearbeiten`}>
        <PvForm
          fields={inverterFields}
          record={inverter}
          rules={inverterProblems}
          columns="lg:grid-cols-3"
          submitLabel="Speichern"
          onCancel={() => {
            setEditing(false)
          }}
          onSubmit={async (values) => {
            const saved = await client.update('inverters', inverterId, values)

            if (saved.outcome === 'queued') {
              setEditing(false)
            }

            return saved
          }}
        />
      </Detail>
    )
  }

  const inputs = figureOf(inverter, 'mppInputs')

  return (
    <Detail
      title={name}
      sub={makeAndModel(inverter) ?? undefined}
      actions={
        writes ? (
          <>
            <MoveButtons
              name={name}
              index={index}
              total={siblings.length}
              onMove={(step) => void move(step)}
            />
            <Button size="small" icon={Pencil} onClick={() => setEditing(true)}>
              Bearbeiten
            </Button>
            <RemoveButton onClick={() => setRemoving(true)}>Wechselrichter löschen</RemoveButton>
          </>
        ) : null
      }
    >
      <Trouble>{trouble}</Trouble>
      {client.isPending('inverters', inverterId) ? (
        <p className="text-[13px] text-ink-muted">Noch nicht übertragen.</p>
      ) : null}

      <Panel title="Wechselrichter">
        <FactList
          keyWidth={110}
          facts={[
            {
              label: 'Anlage',
              value: installation ? (
                <Link
                  to={`/anlagen/${installationId}`}
                  className="text-copper-text underline underline-offset-2"
                >
                  {text(installation, 'designation')}
                </Link>
              ) : null,
            },
            { label: 'Hersteller', value: maybeText(inverter, 'manufacturer') },
            { label: 'Modell', value: maybeText(inverter, 'model') },
            { label: 'Seriennummer', value: maybeText(inverter, 'serialNumber') },
            { label: 'Nennleistung', value: inverterPower(inverter) },
            { label: 'MPP-Eingänge', value: inputs === null ? null : String(inputs) },
          ]}
        />
      </Panel>

      <StringsTable
        inverter={inverter}
        strings={strings}
        modules={modules}
        writes={writes}
        onAdd={onNewString}
      />

      <Panel title="Daran angeschlossen">
        <div className="flex flex-col gap-2.5">
          {attached.length > 0 ? <Entries installations={attached} /> : null}
          <p className="text-[13px] leading-[1.4] text-ink-muted">
            {attached.length > 0
              ? 'Was an diesem Wechselrichter hängt, sagt die Anlage selbst, unter „Bearbeiten“.'
              : 'Noch hängt keine Anlage an diesem Wechselrichter. Ein Speicher sagt es selbst, unter „Bearbeiten“.'}
          </p>
        </div>
      </Panel>

      <Confirm
        open={removing}
        title={`${name} löschen?`}
        confirm="Löschen"
        onConfirm={() => void remove()}
        onCancel={() => {
          setRemoving(false)
        }}
      >
        {[
          strings.length === 0
            ? 'Der Wechselrichter hat keinen String, es geht nichts mit.'
            : `Mit dem Wechselrichter gehen ${stringsInWords(strings.length)} und ${modulesInWords(moduleCount)}.`,
          attached.length > 0
            ? `${attached.map((one) => text(one, 'designation')).join(', ')} ${
                attached.length === 1 ? 'hängt' : 'hängen'
              } danach an keinem Wechselrichter mehr.`
            : null,
        ]
          .filter(Boolean)
          .join(' ')}
      </Confirm>
    </Detail>
  )
}

/** Installations as the cards of the canvas list them: a link with what they are. */
export function Entries({
  installations,
  withInverter = false,
}: {
  readonly installations: readonly RecordState[]
  /** "am WR 1" behind what it is, where the list is not the inverter's own. */
  readonly withInverter?: boolean
}) {
  return (
    <ul className="flex flex-col gap-2">
      {installations.map((one) => (
        <Entry key={String(one['id'])} installation={one} withInverter={withInverter} />
      ))}
    </ul>
  )
}

function Entry({
  installation,
  withInverter,
}: {
  readonly installation: RecordState
  readonly withInverter: boolean
}) {
  const inverter = useRecord(
    'inverters',
    withInverter ? (maybeText(installation, 'inverterId') ?? undefined) : undefined,
  )
  const id = String(installation['id'])

  return (
    <li className="flex items-center gap-2.5 rounded-control border border-line bg-ground px-[11px] py-[9px]">
      <div className="min-w-0 grow">
        <Link
          to={`/anlagen/${id}`}
          className="text-[14px] font-semibold text-copper-text underline underline-offset-2"
        >
          {text(installation, 'designation')}
        </Link>
        <div className="text-[13px] text-ink-faint">
          {[
            installationKindLabel[installationKindOf(installation)],
            makeAndModel(installation),
            inverter ? `am ${text(inverter, 'designation')}` : null,
          ]
            .filter((part): part is string => part !== null)
            .join(', ')}
        </div>
      </div>
    </li>
  )
}

/** "Strings": the strings of an inverter, in order, to open, change, move and remove. */
function StringsTable({
  inverter,
  strings,
  modules,
  writes,
  onAdd,
}: {
  readonly inverter: RecordState
  readonly strings: readonly RecordState[]
  readonly modules: readonly RecordState[]
  readonly writes: boolean
  readonly onAdd: () => void
}) {
  const client = useSync()
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{
    readonly id: string
    readonly name: string
    readonly inside: number
  } | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const columns = writes ? 7 : 6
  const modulesOf = (id: string) => modules.filter((module) => text(module, 'pvStringId') === id)

  async function move(id: string, step: -1 | 1) {
    const refused = await moveAmong(client, 'pv_strings', strings, id, step)

    setTrouble(refused && refused.outcome === 'refused' ? refusalFor(refused) : null)
  }

  async function remove(id: string) {
    setRemoving(null)

    const result = await client.remove('pv_strings', id)

    setTrouble(result.outcome === 'refused' ? refusalFor(result) : null)
  }

  const editForm = (pvString: RecordState) => {
    const id = String(pvString['id'])

    return (
      <PvForm
        fields={stringFields(inverter, pvString)}
        record={pvString}
        rules={pvStringProblems}
        columns="lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
        submitLabel="Speichern"
        onCancel={() => {
          setEditing(null)
        }}
        onSubmit={async (values) => {
          const saved = await client.update('pv_strings', id, values)

          if (saved.outcome === 'queued') {
            setEditing(null)
          }

          return saved
        }}
      />
    )
  }

  const reorder = (pvString: RecordState, index: number) => {
    const id = String(pvString['id'])
    const name = text(pvString, 'designation')

    return (
      <Reorder
        name={name}
        canUp={index > 0}
        canDown={index < strings.length - 1}
        onMove={(step) => void move(id, step)}
        onEdit={() => setEditing(id)}
        onRemove={() => setRemoving({ id, name, inside: modulesOf(id).length })}
      />
    )
  }

  const cards = strings.map((pvString, index) => {
    const id = String(pvString['id'])
    const own = modulesOf(id)

    return editing === id
      ? { key: id, title: text(pvString, 'designation'), form: editForm(pvString) }
      : {
          key: id,
          title: (
            <Link to={`/strings/${id}`} className={cardLink}>
              {text(pvString, 'designation')}
            </Link>
          ),
          sub: [
            figureOf(pvString, 'mppInput') === null
              ? null
              : `MPP-Eingang ${String(figureOf(pvString, 'mppInput'))}`,
            modulesInWords(own.length),
            peakCell(own) || null,
            azimuthOf(pvString),
            tiltOf(pvString),
          ]
            .filter((part): part is string => part !== null)
            .join(' · '),
          right: client.isPending('pv_strings', id) ? 'noch nicht übertragen' : null,
          actions: writes ? reorder(pvString, index) : null,
        }
  })

  const table = (
    <TablePanel
      title="Strings"
      caption="Strings des Wechselrichters"
      lead={trouble ? <Trouble>{trouble}</Trouble> : null}
      action={
        writes ? (
          <Button size="small" icon={Plus} onClick={onAdd}>
            String anlegen
          </Button>
        ) : null
      }
      cards={cards}
      cardsEmpty="Noch kein String an diesem Wechselrichter."
    >
      <thead>
        <tr>
          <Column>Bezeichnung</Column>
          <Column className="w-[100px]">MPP-Eingang</Column>
          <Column numeric className="w-[80px]">
            Module
          </Column>
          <Column numeric className="w-[100px]">
            Leistung
          </Column>
          <Column className="w-[120px]">Ausrichtung</Column>
          <Column numeric className="w-[80px]">
            Neigung
          </Column>
          {writes ? (
            <Column numeric className="w-[120px]">
              Ändern
            </Column>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {strings.length === 0 ? (
          <tr>
            <Cell colSpan={columns} className="text-ink-muted">
              Noch kein String an diesem Wechselrichter.
            </Cell>
          </tr>
        ) : (
          strings.map((pvString, index) => {
            const id = String(pvString['id'])
            const own = modulesOf(id)
            const input = figureOf(pvString, 'mppInput')

            if (editing === id) {
              return (
                <tr key={id}>
                  <Cell colSpan={columns}>{editForm(pvString)}</Cell>
                </tr>
              )
            }

            return (
              <tr key={id}>
                <Cell>
                  <Link
                    to={`/strings/${id}`}
                    className="text-copper-text underline underline-offset-2"
                  >
                    {text(pvString, 'designation')}
                  </Link>
                  {client.isPending('pv_strings', id) ? (
                    <span className="block text-[13px] text-ink-faint">noch nicht übertragen</span>
                  ) : null}
                </Cell>
                <Cell>{input === null ? '' : String(input)}</Cell>
                <Cell numeric>{own.length}</Cell>
                <Cell numeric>{peakCell(own)}</Cell>
                <Cell>{azimuthOf(pvString) ?? ''}</Cell>
                <Cell numeric>{tiltOf(pvString) ?? ''}</Cell>
                {writes ? <Cell numeric>{reorder(pvString, index)}</Cell> : null}
              </tr>
            )
          })
        )}
      </tbody>
    </TablePanel>
  )

  // Beside the table rather than in it: on a phone the table is not drawn,
  // and a question inside it would never open.
  return (
    <>
      {table}
      <Confirm
        open={removing !== null}
        title={`${removing?.name ?? 'String'} löschen?`}
        confirm="Löschen"
        onConfirm={() => {
          if (removing) {
            void remove(removing.id)
          }
        }}
        onCancel={() => {
          setRemoving(null)
        }}
      >
        {removing && removing.inside > 0
          ? `Mit dem String gehen seine ${modulesInWords(removing.inside)}.`
          : 'Der String hat keine Module, es geht nichts mit.'}
      </Confirm>
    </>
  )
}

/** One string, `string_detail()`: its facts, the batch of new modules, and its modules. */
function StringDetail({ stringId }: { readonly stringId: string }) {
  const client = useSync()
  const navigate = useNavigate()
  const writes = useMay('installation.write')
  const pvString = useRecord('pv_strings', stringId)
  const inverterId = text(pvString, 'inverterId')
  const inverter = useRecord('inverters', inverterId)
  const siblings = usePvStrings(inverterId)
  const modules = usePvModules(stringId)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  if (!pvString) {
    return null
  }

  const name = text(pvString, 'designation')
  const index = siblings.findIndex((sibling) => String(sibling['id']) === stringId)
  const input = figureOf(pvString, 'mppInput')

  async function move(step: -1 | 1) {
    const refused = await moveAmong(client, 'pv_strings', siblings, stringId, step)

    setTrouble(refused && refused.outcome === 'refused' ? refusalFor(refused) : null)
  }

  async function remove() {
    setRemoving(false)

    const result = await client.remove('pv_strings', stringId)

    if (result.outcome === 'refused') {
      setTrouble(refusalFor(result))

      return
    }

    await navigate({ to: `/wechselrichter/${inverterId}` })
  }

  if (editing) {
    return (
      <Detail title={`${name} bearbeiten`}>
        <PvForm
          fields={stringFields(inverter, pvString)}
          record={pvString}
          rules={pvStringProblems}
          columns="lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
          submitLabel="Speichern"
          onCancel={() => {
            setEditing(false)
          }}
          onSubmit={async (values) => {
            const saved = await client.update('pv_strings', stringId, values)

            if (saved.outcome === 'queued') {
              setEditing(false)
            }

            return saved
          }}
        />
      </Detail>
    )
  }

  return (
    <Detail
      title={name}
      sub={[text(inverter, 'designation'), input === null ? null : `MPP-Eingang ${String(input)}`]
        .filter((part): part is string => part !== null && part !== '')
        .join(', ')}
      actions={
        writes ? (
          <>
            <MoveButtons
              name={name}
              index={index}
              total={siblings.length}
              onMove={(step) => void move(step)}
            />
            <Button size="small" icon={Pencil} onClick={() => setEditing(true)}>
              Bearbeiten
            </Button>
            <RemoveButton onClick={() => setRemoving(true)}>String löschen</RemoveButton>
          </>
        ) : null
      }
    >
      <Trouble>{trouble}</Trouble>
      {client.isPending('pv_strings', stringId) ? (
        <p className="text-[13px] text-ink-muted">Noch nicht übertragen.</p>
      ) : null}

      <Panel title="String">
        <FactList
          keyWidth={110}
          facts={[
            {
              label: 'Wechselrichter',
              value: inverter ? (
                <Link
                  to={`/wechselrichter/${inverterId}`}
                  className="text-copper-text underline underline-offset-2"
                >
                  {text(inverter, 'designation')}
                </Link>
              ) : null,
            },
            { label: 'MPP-Eingang', value: inputOf(pvString, inverter) },
            { label: 'Ausrichtung', value: azimuthOf(pvString) },
            { label: 'Neigung', value: tiltOf(pvString) },
            { label: 'Leistung', value: modulesPowerText(modules) },
          ]}
        />
      </Panel>

      {adding ? (
        <Panel title="Module anlegen" onGround>
          <PvForm
            fields={moduleBatchFields}
            record={batchStart(modules)}
            rules={batchProblems}
            columns="lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,1fr)]"
            note={(inputs) => {
              const count = batchCount(inputs)

              return `Legt ${count === null ? 'die Module' : modulesInWords(count)} mit denselben Angaben am Ende des Strings an. Die Seriennummern kommen danach, auf der Baustelle vom Etikett gescannt oder hier von Hand.`
            }}
            submitLabel={(inputs) => {
              const count = batchCount(inputs)

              return count === null ? 'Module anlegen' : `${modulesInWords(count)} anlegen`
            }}
            onCancel={() => {
              setAdding(false)
            }}
            onSubmit={async (values) => {
              const made = await addModules(client, stringId, modules, values)

              if (made.outcome === 'queued') {
                setAdding(false)
              }

              return made
            }}
          />
        </Panel>
      ) : null}

      <ModulesTable
        modules={modules}
        writes={writes}
        adding={adding}
        onAdd={() => {
          setAdding(true)
        }}
      />

      <Confirm
        open={removing}
        title={`${name} löschen?`}
        confirm="Löschen"
        onConfirm={() => void remove()}
        onCancel={() => {
          setRemoving(false)
        }}
      >
        {modules.length === 0
          ? 'Der String hat keine Module, es geht nichts mit.'
          : `Mit dem String gehen seine ${modulesInWords(modules.length)}.`}
      </Confirm>
    </Detail>
  )
}

/** "Module": the modules of a string, numbered in their order, with their serial numbers. */
function ModulesTable({
  modules,
  writes,
  adding,
  onAdd,
}: {
  readonly modules: readonly RecordState[]
  readonly writes: boolean
  readonly adding: boolean
  readonly onAdd: () => void
}) {
  const client = useSync()
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ readonly id: string; readonly name: string } | null>(
    null,
  )
  const [trouble, setTrouble] = useState<string | null>(null)
  const columns = writes ? 6 : 5
  const missing = serialsMissingText(modules)

  async function move(id: string, step: -1 | 1) {
    const refused = await moveAmong(client, 'pv_modules', modules, id, step)

    setTrouble(refused && refused.outcome === 'refused' ? refusalFor(refused) : null)
  }

  async function remove(id: string) {
    setRemoving(null)

    const result = await client.remove('pv_modules', id)

    setTrouble(result.outcome === 'refused' ? refusalFor(result) : null)
  }

  const editForm = (module: RecordState) => {
    const id = String(module['id'])

    return (
      <PvForm
        fields={moduleFields}
        record={module}
        rules={pvModuleProblems}
        columns="lg:grid-cols-4"
        submitLabel="Speichern"
        onCancel={() => {
          setEditing(null)
        }}
        onSubmit={async (values) => {
          const saved = await client.update('pv_modules', id, values)

          if (saved.outcome === 'queued') {
            setEditing(null)
          }

          return saved
        }}
      />
    )
  }

  const reorder = (module: RecordState, index: number) => {
    const id = String(module['id'])
    const name = `Modul ${String(index + 1)}`

    return (
      <Reorder
        name={name}
        canUp={index > 0}
        canDown={index < modules.length - 1}
        onMove={(step) => void move(id, step)}
        onEdit={() => setEditing(id)}
        onRemove={() => setRemoving({ id, name })}
      />
    )
  }

  const serialCell = (module: RecordState) => {
    const serial = maybeText(module, 'serialNumber')

    return serial ?? <span className="text-waiting">fehlt</span>
  }

  const power = (module: RecordState) => {
    const watts = figureOf(module, 'ratedPowerW')

    return watts === null ? '' : `${String(watts)} Wp`
  }

  const cards = modules.map((module, index) => {
    const id = String(module['id'])
    const serial = maybeText(module, 'serialNumber')

    return editing === id
      ? { key: id, title: `Modul ${String(index + 1)}`, form: editForm(module) }
      : {
          key: id,
          title: `Modul ${String(index + 1)}`,
          sub: [
            makeAndModel(module),
            power(module) || null,
            serial ? `SN ${serial}` : 'Seriennummer fehlt',
          ]
            .filter((part): part is string => part !== null)
            .join(' · '),
          right: client.isPending('pv_modules', id) ? 'noch nicht übertragen' : null,
          actions: writes ? reorder(module, index) : null,
        }
  })

  const table = (
    <TablePanel
      title="Module"
      caption="Module des Strings"
      lead={trouble ? <Trouble>{trouble}</Trouble> : null}
      action={
        writes && !adding ? (
          <Button size="small" icon={Plus} onClick={onAdd}>
            Module anlegen
          </Button>
        ) : null
      }
      cards={cards}
      cardsEmpty="Noch kein Modul an diesem String."
      note={
        missing
          ? `${missing} Gescannt wird auf der Baustelle, hier trägt man sie über den Bleistift ein.`
          : undefined
      }
    >
      <thead>
        <tr>
          <Column className="w-[50px]">Nr.</Column>
          <Column className="w-[110px]">Hersteller</Column>
          <Column>Modell</Column>
          <Column numeric className="w-[80px]">
            Leistung
          </Column>
          <Column className="w-[140px]">Seriennummer</Column>
          {writes ? (
            <Column numeric className="w-[120px]">
              Ändern
            </Column>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {modules.length === 0 ? (
          <tr>
            <Cell colSpan={columns} className="text-ink-muted">
              Noch kein Modul an diesem String.
            </Cell>
          </tr>
        ) : (
          modules.map((module, index) => {
            const id = String(module['id'])

            if (editing === id) {
              return (
                <tr key={id}>
                  <Cell colSpan={columns}>{editForm(module)}</Cell>
                </tr>
              )
            }

            return (
              <tr key={id}>
                <Cell>
                  {index + 1}
                  {client.isPending('pv_modules', id) ? (
                    <span className="block text-[13px] text-ink-faint">noch nicht übertragen</span>
                  ) : null}
                </Cell>
                <Cell>{maybeText(module, 'manufacturer') ?? ''}</Cell>
                <Cell>{maybeText(module, 'model') ?? ''}</Cell>
                <Cell numeric>{power(module)}</Cell>
                <Cell className="numeric">{serialCell(module)}</Cell>
                {writes ? <Cell numeric>{reorder(module, index)}</Cell> : null}
              </tr>
            )
          })
        )}
      </tbody>
    </TablePanel>
  )

  return (
    <>
      {table}
      <Confirm
        open={removing !== null}
        title={`${removing?.name ?? 'Modul'} entfernen?`}
        confirm="Entfernen"
        onConfirm={() => {
          if (removing) {
            void remove(removing.id)
          }
        }}
        onCancel={() => {
          setRemoving(null)
        }}
      >
        Das Modul steht danach nicht mehr am String.
      </Confirm>
    </>
  )
}

/** A new inverter of the PV system, in the place of the detail. */
function NewInverter({
  installationId,
  onDone,
}: {
  readonly installationId: string
  readonly onDone: () => void
}) {
  const client = useSync()
  const navigate = useNavigate()
  const inverters = useInverters(installationId)

  return (
    <Detail title="Neuer Wechselrichter">
      <PvForm
        fields={inverterFields}
        record={{ designation: `WR ${String(inverters.length + 1)}` }}
        rules={inverterProblems}
        columns="lg:grid-cols-3"
        submitLabel="Wechselrichter anlegen"
        onCancel={onDone}
        onSubmit={async (values) => {
          const made = await client.create('inverters', {
            ...values,
            installationId,
            position: nextPosition(inverters),
          })

          if (made.outcome === 'queued') {
            onDone()
            await navigate({ to: `/wechselrichter/${made.id}` })
          }

          return made
        }}
      />
    </Detail>
  )
}

/** A new string at an inverter, in the place of the detail. */
function NewString({
  inverterId,
  onDone,
}: {
  readonly inverterId: string
  readonly onDone: () => void
}) {
  const client = useSync()
  const navigate = useNavigate()
  const inverter = useRecord('inverters', inverterId)
  const strings = usePvStrings(inverterId)

  return (
    <Detail title={`Neuer String an ${text(inverter, 'designation')}`}>
      <PvForm
        fields={stringFields(inverter)}
        record={{ designation: `String ${String(strings.length + 1)}` }}
        rules={pvStringProblems}
        columns="lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
        submitLabel="String anlegen"
        onCancel={onDone}
        onSubmit={async (values) => {
          const made = await client.create('pv_strings', {
            ...values,
            inverterId,
            position: nextPosition(strings),
          })

          if (made.outcome === 'queued') {
            onDone()
            await navigate({ to: `/strings/${made.id}` })
          }

          return made
        }}
      />
    </Detail>
  )
}
