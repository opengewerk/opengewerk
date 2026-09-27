import type { OperatorView } from '@opengewerk/domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, TriangleAlert } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import {
  Button,
  Cell,
  Column,
  Confirm,
  Field,
  Panel,
  Status,
  TablePanel,
  type TableCard,
} from '../../components/index.js'
import { date } from '../../app/format.js'
import { accountQuery } from '../../app/queries.js'
import { appointOperator, operators, removeOperator } from '../../session/instance.js'
import { RequestRefused } from '../../sync/transport.js'
import { SettingsText } from '../settings-frame.js'
import { instanceAccessQuery } from '../top-bar.js'
import { InstancePage } from './shell.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/**
 * Who runs the instance (#188), `instanz_betreiber()` of the canvas. An
 * operator is an account that exists already; naming one hands it this area
 * and nothing in any business. Nobody removes themselves, and the last one
 * stays, so the instance always has somebody who can reach it.
 */
export function OperatorsScreen() {
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
      setTrouble(saidWhy(error, 'Der Betreiber ließ sich nicht entfernen.'))
    },
  })

  function removeButton(operator: OperatorView) {
    return (
      <Button
        size="small"
        tone="danger"
        aria-label={`${operator.name} als Betreiber entfernen`}
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
    <InstancePage title="Betreiber" sub="Wer diese Instanz verwaltet.">
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
          caption="Die Betreiber dieser Instanz"
          cards={cards}
          note="Ohne zweiten Faktor kommt niemand hierher; eingerichtet wird er unter „Konto“. Sich selbst und den letzten Betreiber entfernt niemand."
        >
          <thead>
            <tr>
              <Column>Betreiber</Column>
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

      <Panel title="Betreiber benennen" roomy>
        <AppointForm onAppointed={refresh} />
      </Panel>

      <Confirm
        open={removing !== null}
        title={`${removing?.name ?? ''} als Betreiber entfernen?`}
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
        Das Konto bleibt, ebenso seine Zugänge zu Betrieben; nur dieser Bereich ist danach zu.
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
  const [email, setEmail] = useState('')
  const [trouble, setTrouble] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const appoint = useMutation({
    mutationFn: appointOperator,
    onSuccess: (operator) => {
      setEmail('')
      setDone(`${operator.name} ist jetzt Betreiber.`)
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
      <SettingsText muted>
        Betreiber wird ein Konto, das es auf dieser Instanz schon gibt. Es verwaltet dann, was allen
        Betrieben gemeinsam ist, und sieht die Liste der Betriebe, aber nichts, was in einem steht.
      </SettingsText>
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="w-[320px] max-sm:w-full">
          <Field
            label="E-Mail des Kontos"
            type="email"
            value={email}
            placeholder="name@betrieb.de"
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
