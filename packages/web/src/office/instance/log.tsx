import { type AuditChange, auditTableLabel, type InstanceLogPage } from '@opengewerk/domain'
import { Button, Cell, Column, Panel, TablePanel, useBand } from '@opengewerk/platform-web'
import { moment } from '@opengewerk/platform-web/format'
import { InstancePage } from '@opengewerk/platform-web/instance'
import { Empty, SettingsText } from '@opengewerk/platform-web/office'
import { instanceLog } from '@opengewerk/platform-web/session'
import { RequestRefused } from '@opengewerk/platform-web/sync'
import { useInfiniteQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { type ReactNode, useState } from 'react'

import { type AuditNames, changeSummary, wayWords } from '../audit-words.js'
import { ChangeFacts, FieldList, FieldsTable, PersonCell } from '../screens/audit-log.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/** The pages read so far as one. */
function merged(pages: readonly InstanceLogPage[]): InstanceLogPage {
  return {
    changes: pages.flatMap((page) => page.changes),
    next: pages.at(-1)?.next ?? null,
    titles: Object.assign({}, ...pages.map((page) => page.titles)) as InstanceLogPage['titles'],
    people: Object.assign({}, ...pages.map((page) => page.people)) as InstanceLogPage['people'],
    devices: Object.assign({}, ...pages.map((page) => page.devices)) as InstanceLogPage['devices'],
  }
}

/**
 * What a change of the instance is about: its settings, an operator by name,
 * a business by its name today or as the log last had it.
 */
export function instanceRecord(change: AuditChange, page: AuditNames): string {
  if (change.table === 'instance_settings') {
    return 'Einstellungen der Instanz'
  }

  const title = page.titles[change.recordId]?.title ?? null

  if (change.table === 'instance_operators') {
    return title === null
      ? 'Betreiber'
      : (page.people[title] ?? 'Eine Person, die es nicht mehr gibt')
  }

  if (change.table === 'tenants') {
    return title ?? 'Ein Betrieb'
  }

  return auditTableLabel(change.table)
}

/** The change in a few words: named where one word says it, the fields that moved otherwise. */
export function instanceChangeSummary(change: AuditChange): string {
  if (change.table === 'instance_operators') {
    if (change.operation === 'insert') {
      return 'Betreiber benannt'
    }

    if (change.operation === 'delete') {
      return 'Betreiber entfernt'
    }
  }

  if (change.table === 'tenants') {
    if (change.operation === 'insert') {
      return 'Betrieb angelegt'
    }

    if (change.operation === 'delete') {
      return 'Betrieb entfernt'
    }
  }

  if (change.table === 'instance_settings' && change.operation === 'insert') {
    return 'Eingerichtet'
  }

  return changeSummary(change)
}

/**
 * The log of the instance (#188), `instanz_protokoll()` of the canvas: every
 * change to its settings, its operators and the list of its businesses, who
 * made it and on which way, newest first, fifty at a time. A change in a
 * business stands in that business's own change log and not here; this one
 * holds nothing of what is in a business.
 *
 * The frame of the area, the page and the question for the log are the
 * foundation's (ADR 0010). The screen stays here for as long as the change
 * log of a business does, whose pieces it is drawn from: both move into the
 * foundation together (opengewerk/opengewerk-haustechnik#22).
 */
export function InstanceLogScreen() {
  const band = useBand()
  const [opened, setOpened] = useState<string | null>(null)
  const log = useInfiniteQuery({
    queryKey: ['instance-log'],
    queryFn: ({ pageParam }) => instanceLog(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
  })

  const page = log.data ? merged(log.data.pages) : null
  const open = page?.changes.find((change) => change.changeId === opened) ?? null
  const phone = band === 'S'

  const footer = (
    <>
      <span>Neueste zuerst, 50 je Abruf</span>
      <div className="grow" />
      {log.hasNextPage ? (
        <Button
          size="small"
          disabled={log.isFetchingNextPage}
          onClick={() => {
            void log.fetchNextPage()
          }}
        >
          Weitere laden
        </Button>
      ) : (
        <span>Das sind alle.</span>
      )}
    </>
  )

  return (
    <InstancePage
      title="Protokoll"
      sub="Jede Änderung an der Instanz. Was in einem Betrieb geändert wird, steht in dessen Änderungsprotokoll."
      fill={!phone}
    >
      {log.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : log.isError ? (
        <SettingsText muted>{saidWhy(log.error, 'Das Protokoll kam nicht an.')}</SettingsText>
      ) : page === null || page.changes.length === 0 ? (
        <Empty>Noch keine Änderung.</Empty>
      ) : phone ? (
        <PhoneList page={page} opened={opened} onOpen={setOpened} footer={footer} />
      ) : (
        <>
          {open ? (
            <Panel title={instanceRecord(open, page)}>
              <ChangeFacts change={open} page={page} />
              <FieldsTable change={open} page={page} />
              <div className="mt-3 flex">
                <div className="grow" />
                <Button
                  onClick={() => {
                    setOpened(null)
                  }}
                >
                  Schließen
                </Button>
              </div>
            </Panel>
          ) : null}
          <TablePanel caption="Änderungen an der Instanz" footer={footer} grow>
            <thead>
              <tr>
                <Column className="w-[120px] min-w-[112px]">Zeitpunkt</Column>
                <Column className="min-w-[170px]">Betrifft</Column>
                <Column className="w-[210px] min-w-[150px]">Änderung</Column>
                <Column className="w-[230px] min-w-[180px]">Person und Weg</Column>
              </tr>
            </thead>
            <tbody>
              {page.changes.map((change) => (
                <tr
                  key={change.changeId}
                  className={change.changeId === opened ? 'bg-selected' : undefined}
                >
                  <Cell className="numeric">{moment(change.changedAt)}</Cell>
                  <Cell>
                    <button
                      type="button"
                      aria-expanded={change.changeId === opened}
                      onClick={() => {
                        setOpened(change.changeId)
                      }}
                      className="cursor-pointer text-left text-ink hover:underline"
                    >
                      {instanceRecord(change, page)}
                    </button>
                  </Cell>
                  <Cell className="text-ink-muted">{instanceChangeSummary(change)}</Cell>
                  <Cell>
                    <PersonCell change={change} page={page} />
                  </Cell>
                </tr>
              ))}
            </tbody>
          </TablePanel>
        </>
      )}
    </InstancePage>
  )
}

/** On a phone, one box per change; the opened one shows its fields in place. */
function PhoneList({
  page,
  opened,
  onOpen,
  footer,
}: {
  readonly page: InstanceLogPage
  readonly opened: string | null
  readonly onOpen: (changeId: string | null) => void
  readonly footer: ReactNode
}) {
  return (
    <>
      <ul aria-label="Änderungen an der Instanz" className="flex flex-col gap-2">
        {page.changes.map((change) => {
          const isOpen = change.changeId === opened
          const said = wayWords(change, page)

          return (
            <li
              key={change.changeId}
              className={clsx(
                'rounded-[6px] border px-3 py-2.5',
                isOpen ? 'border-line-strong bg-selected' : 'border-line bg-surface',
              )}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => {
                  onOpen(isOpen ? null : change.changeId)
                }}
                className="flex w-full cursor-pointer flex-col gap-0.5 text-left text-ink"
              >
                <span className="numeric text-[13px] text-ink-faint">
                  {moment(change.changedAt)}
                </span>
                <span className="text-[16px] font-semibold [overflow-wrap:anywhere]">
                  {instanceRecord(change, page)}
                </span>
                <span className="text-[14px] text-ink-muted">{instanceChangeSummary(change)}</span>
                <span className="text-[13px] text-ink-faint">
                  {[said.person ?? 'Niemand', said.way].join(' · ')}
                </span>
              </button>
              {isOpen ? <FieldList change={change} page={page} /> : null}
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-faint">{footer}</div>
    </>
  )
}
