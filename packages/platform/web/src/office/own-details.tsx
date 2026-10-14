import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '../components/button.js'
import { Field } from '../components/field.js'
import { Panel } from '../components/panel.js'
import { accountQuery } from '../session/queries.js'
import { changeOwnAccount } from '../session/session.js'
import { RequestRefused } from '../sync/transport.js'
import { Reconfirmation } from './passkeys.js'
import { Saved } from './settings.js'

/**
 * "Eigene Angaben", as the board "Konto (3)" draws it: the name and the
 * address of one's own account, changed after confirming again with the
 * password and the code from the app (opengewerk-haustechnik#128).
 *
 * The one way to change an account that works for more than one tenant or
 * runs the instance, which nobody else corrects. The confirmation is asked
 * only once there is something to change, and what was changed goes into the
 * log of every tenant the account works in; that is the server's.
 */
export function OwnDetails() {
  const queries = useQueryClient()
  const account = useQuery(accountQuery)
  const [name, setName] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // What stands in the fields: what was typed, or else what the account says.
  const shownName = name ?? account.data?.name ?? ''
  const shownEmail = email ?? account.data?.email ?? ''
  const change = {
    ...(account.data && shownName.trim() !== account.data.name ? { name: shownName } : {}),
    ...(account.data && shownEmail.trim().toLowerCase() !== account.data.email.toLowerCase()
      ? { email: shownEmail }
      : {}),
  }
  const changed = Object.keys(change).length > 0
  const problem =
    shownName.trim() === ''
      ? 'Der Name fehlt.'
      : !shownEmail.includes('@')
        ? 'Die E-Mail-Adresse sieht nicht wie eine aus.'
        : null

  function ask(event: FormEvent) {
    event.preventDefault()
    setTrouble(problem)
    setSaved(false)

    if (problem === null && changed) {
      setConfirming(true)
    }
  }

  async function send() {
    try {
      await changeOwnAccount(change)
      setName(null)
      setEmail(null)
      setSaved(true)
      void queries.invalidateQueries({ queryKey: accountQuery.queryKey })
    } catch (error) {
      setTrouble(error instanceof RequestRefused ? error.message : 'Die Änderung kam nicht an.')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <Panel title="Eigene Angaben" roomy>
      <form noValidate className="flex flex-col gap-2.5" onSubmit={ask}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Name"
            autoComplete="name"
            value={shownName}
            disabled={confirming}
            onChange={(event) => {
              setName(event.target.value)
              setSaved(false)
            }}
          />
          <Field
            label="E-Mail"
            type="email"
            autoComplete="email"
            value={shownEmail}
            disabled={confirming}
            onChange={(event) => {
              setEmail(event.target.value)
              setSaved(false)
            }}
          />
        </div>
        {confirming ? null : (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!changed}>
              Ändern
            </Button>
            <span className="text-[12px] text-ink-muted">
              Mit erneuter Bestätigung durch Passwort und Code.
            </span>
          </div>
        )}
      </form>
      {confirming ? (
        <section
          aria-label="Eigene Angaben bestätigen"
          className="mt-2.5 rounded-[5px] border border-line bg-surface-sunken p-3"
        >
          <Reconfirmation
            narrow
            onConfirmed={() => {
              void send()
            }}
            onCancel={() => {
              setConfirming(false)
            }}
          />
        </section>
      ) : null}
      {trouble ? (
        <p role="alert" className="mt-2.5 text-[13px] font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
      {saved ? (
        <div className="mt-2.5">
          <Saved />
        </div>
      ) : null}
    </Panel>
  )
}
