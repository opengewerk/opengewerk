import type { AuditChange, InstanceLogPage } from '@opengewerk/platform-domain'
import { useInfiniteQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { type ReactNode, useState } from 'react'

import { useInstanceSentences } from '../application.js'
import { useBand } from '../components/band.js'
import { Button } from '../components/button.js'
import { Panel, TablePanel } from '../components/panel.js'
import { Cell, Column } from '../components/table.js'
import { moment } from '../format.js'
import { ChangeFacts, FieldList, FieldsTable, PersonCell } from '../office/audit-log.js'
import { type AuditNames, type AuditWords, useAuditWords } from '../office/audit-words.js'
import { Empty } from '../office/kit.js'
import { SettingsText } from '../office/settings.js'
import { instanceLog } from '../session/instance.js'
import { RequestRefused } from '../sync/transport.js'
import { InstancePage } from './frame.js'

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

/** What the log of the instance says in the words of the application. */
type LogSentences = ReturnType<typeof useInstanceSentences>['log']

/**
 * What a change of the instance is about: its settings, one of those who run
 * it by name, a tenant by its name today or as the log last had it.
 */
export function instanceRecord(
  change: AuditChange,
  page: AuditNames,
  words: AuditWords,
  sentences: LogSentences,
): string {
  if (change.table === 'instance_settings') {
    return 'Einstellungen der Instanz'
  }

  const title = page.titles[change.recordId]?.title ?? null

  if (change.table === 'instance_operators') {
    return title === null
      ? words.language.tableLabel(change.table)
      : (page.people[title] ?? 'Eine Person, die es nicht mehr gibt')
  }

  if (change.table === 'tenants') {
    return title ?? sentences.aTenant
  }

  return words.language.tableLabel(change.table)
}

/** The change in a few words: named where one word says it, the fields that moved otherwise. */
export function instanceChangeSummary(
  change: AuditChange,
  words: AuditWords,
  sentences: LogSentences,
): string {
  if (change.table === 'instance_operators') {
    if (change.operation === 'insert') {
      return sentences.operatorAppointed
    }

    if (change.operation === 'delete') {
      return sentences.operatorRemoved
    }
  }

  if (change.table === 'tenants') {
    if (change.operation === 'insert') {
      return sentences.tenantCreated
    }

    if (change.operation === 'delete') {
      return sentences.tenantRemoved
    }
  }

  if (change.table === 'instance_settings' && change.operation === 'insert') {
    return 'Eingerichtet'
  }

  return words.changeSummary(change)
}

/**
 * The log of the instance (#188; `instanz_protokoll()` of the canvas of the
 * trades application): every change to its settings, to who runs it and to
 * the list of its tenants, who made it and on which way, newest first, fifty
 * at a time. A change in a tenant stands in that tenant's own change log and
 * not here; this one holds nothing of what is in a tenant.
 *
 * Drawn from the pieces of the change log of a tenant, in the words of the
 * application (ADR 0010): its vocabulary names the tables, its sentences the
 * tenants and those who run the instance (`sentences.instance.log`).
 */
export function InstanceLogScreen() {
  const band = useBand()
  const words = useAuditWords()
  const sentences = useInstanceSentences().log
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
    <InstancePage title="Protokoll" sub={sentences.what} fill={!phone}>
      {log.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : log.isError ? (
        <SettingsText muted>{saidWhy(log.error, 'Das Protokoll kam nicht an.')}</SettingsText>
      ) : page === null || page.changes.length === 0 ? (
        <Empty>Noch keine Änderung.</Empty>
      ) : phone ? (
        <PhoneList
          page={page}
          opened={opened}
          onOpen={setOpened}
          footer={footer}
          sentences={sentences}
        />
      ) : (
        <>
          {open ? (
            <Panel title={instanceRecord(open, page, words, sentences)}>
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
                      {instanceRecord(change, page, words, sentences)}
                    </button>
                  </Cell>
                  <Cell className="text-ink-muted">
                    {instanceChangeSummary(change, words, sentences)}
                  </Cell>
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
  sentences,
}: {
  readonly page: InstanceLogPage
  readonly opened: string | null
  readonly onOpen: (changeId: string | null) => void
  readonly footer: ReactNode
  readonly sentences: LogSentences
}) {
  const words = useAuditWords()

  return (
    <>
      <ul aria-label="Änderungen an der Instanz" className="flex flex-col gap-2">
        {page.changes.map((change) => {
          const isOpen = change.changeId === opened
          const said = words.wayWords(change, page)

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
                  {instanceRecord(change, page, words, sentences)}
                </span>
                <span className="text-[14px] text-ink-muted">
                  {instanceChangeSummary(change, words, sentences)}
                </span>
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
