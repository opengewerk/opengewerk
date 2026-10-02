import type { OperatorView } from '@opengewerk/platform-domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, TriangleAlert } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { useInstanceSentences } from '../application.js'
import { Button } from '../components/button.js'
import { Confirm } from '../components/confirm.js'
import { Field } from '../components/field.js'
import { Panel, TablePanel } from '../components/panel.js'
import type { TableCard } from '../components/panel.js'
import { Status } from '../components/status.js'
import { Cell, Column } from '../components/table.js'
import { date } from '../format.js'
import { SettingsText } from '../office/settings.js'
import {
  appointOperator,
  instanceAccessQuery,
  operators,
  removeOperator,
} from '../session/instance.js'
import { accountQuery } from '../session/queries.js'
import { RequestRefused } from '../sync/transport.js'
import { InstancePage } from './frame.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/**
 * Who runs the instance (#188), `instanz_betreiber()` of the canvas. Somebody
 * named to run it is an account that exists already; naming one hands it this
 * area and nothing in any tenant. Nobody takes themselves off, and the last
 * one stays, so the instance always has somebody who can reach it.
 */
export function InstanceOperatorsScreen() {
  const sentences = useInstanceSentences().operators
  const queries = useQueryClient()
  const list = useQuery({ queryKey: ['instance-operators'], queryFn: operators })
  const account = useQuery(accountQuery)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [removing, setRemoving] = useState<OperatorView | null>(null)
  const you = account.data?.userId ?? null
  const count = list.data?.length ?? 0

  function refresh() {
    void queries.invalidateQueries({ queryKey: ['instance-operators'] })
    void queries.invalidateQueries({ queryKey: instanceAccessQuery.queryKey })
  }

  const remove = useMutation({
    mutationFn: removeOperator,
    onSuccess: () => {
      setRemoving(null)
      refresh()
    },
    onError: (error) => {
      setRemoving(null)
      setTrouble(saidWhy(error, sentences.notRemoved))
    },
  })

  function removeButton(operator: OperatorView) {
    return (
      <Button
        size="small"
        tone="danger"
        aria-label={sentences.remove(operator.name)}
        disabled={operator.userId === you || count <= 1 || remove.isPending}
        onClick={() => {
          setTrouble(null)
          setRemoving(operator)
        }}
      >
        Entfernen
      </Button>
    )
  }

  const cards: readonly TableCard[] = (list.data ?? []).map((operator) => ({
    key: operator.userId,
    title: '',
    form: (
      <div className="flex flex-col gap-2 text-[15px]">
        <Person operator={operator} you={operator.userId === you} inBox />
        <span className="text-[13px] text-ink-muted">Seit {date(operator.since)}</span>
        <SecondFactor operator={operator} />
        <div>{removeButton(operator)}</div>
      </div>
    ),
  }))

  return (
    <InstancePage title={sentences.title} sub="Wer diese Instanz verwaltet.">
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      {list.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : list.isError ? (
        <SettingsText muted>{saidWhy(list.error, 'Die Liste kam nicht an.')}</SettingsText>
      ) : (
        <TablePanel
          caption={sentences.caption}
          cards={cards}
          note={`Ohne zweiten Faktor kommt niemand hierher; eingerichtet wird er unter „Konto“. ${sentences.whoStays}`}
        >
          <thead>
            <tr>
              <Column>{sentences.column}</Column>
              <Column className="w-[110px]">Seit</Column>
              <Column className="w-[160px]">Zweiter Faktor</Column>
              <Column numeric className="w-[120px]">
                <span className="sr-only">Entfernen</span>
              </Column>
            </tr>
          </thead>
          <tbody>
            {list.data.map((operator) => (
              <tr key={operator.userId}>
                <Cell>
                  <Person operator={operator} you={operator.userId === you} />
                </Cell>
                <Cell className="text-[13px]">{date(operator.since)}</Cell>
                <Cell className="text-[13px]">
                  <SecondFactor operator={operator} />
                </Cell>
                <Cell numeric>{removeButton(operator)}</Cell>
              </tr>
            ))}
          </tbody>
        </TablePanel>
      )}

      <Panel title={sentences.appoint} roomy>
        <AppointForm onAppointed={refresh} />
      </Panel>

      <Confirm
        open={removing !== null}
        title={`${sentences.remove(removing?.name ?? '')}?`}
        confirm="Entfernen"
        busy={remove.isPending}
        onConfirm={() => {
          if (removing) {
            remove.mutate(removing.userId)
          }
        }}
        onCancel={() => {
          setRemoving(null)
        }}
      >
        {sentences.whatStays}
      </Confirm>
    </InstancePage>
  )
}

function Person({
  operator,
  you,
  inBox = false,
}: {
  readonly operator: OperatorView
  readonly you: boolean
  readonly inBox?: boolean
}) {
  const breaks = inBox ? '[overflow-wrap:anywhere]' : 'whitespace-nowrap'

  return (
    <>
      <span className={`block text-[14px] font-medium max-sm:text-[15px] ${breaks}`}>
        {operator.name}
        {you ? <span className="ml-1.5 text-[12px] font-bold text-copper-text">du</span> : null}
      </span>
      <span className={`block text-[12px] text-ink-faint ${breaks}`}>{operator.email}</span>
    </>
  )
}

function SecondFactor({ operator }: { readonly operator: OperatorView }) {
  return operator.secondFactor ? (
    <Status tone="done">Eingerichtet</Status>
  ) : (
    <Status tone="waiting" icon={TriangleAlert}>
      Fehlt
    </Status>
  )
}

function AppointForm({ onAppointed }: { readonly onAppointed: () => void }) {
  const sentences = useInstanceSentences().operators
  const [email, setEmail] = useState('')
  const [trouble, setTrouble] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const appoint = useMutation({
    mutationFn: appointOperator,
    onSuccess: (operator) => {
      setEmail('')
      setDone(sentences.appointed(operator.name))
      onAppointed()
    },
    onError: (error) => {
      setTrouble(saidWhy(error, 'Das Konto ließ sich nicht benennen.'))
    },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    setTrouble(null)
    setDone(null)

    if (!email.includes('@')) {
      setTrouble('Die E-Mail-Adresse sieht nicht wie eine aus.')

      return
    }

    appoint.mutate(email)
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-2.5">
      <SettingsText muted>{sentences.appointing}</SettingsText>
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="w-[320px] max-sm:w-full">
          <Field
            label="E-Mail des Kontos"
            type="email"
            value={email}
            placeholder={sentences.exampleAddress}
            autoComplete="off"
            onChange={(event) => {
              setEmail(event.target.value)
            }}
          />
        </div>
        <Button tone="primary" type="submit" icon={Plus} disabled={appoint.isPending}>
          Benennen
        </Button>
      </div>
      {trouble ? (
        <p role="alert" className="text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="text-[13px] text-done">
          {done}
        </p>
      ) : null}
    </form>
  )
}
