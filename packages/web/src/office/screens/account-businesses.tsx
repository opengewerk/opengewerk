import { businessNameMaxLength, businessNameProblem, type TenantId } from '@opengewerk/domain'
import { Button, Field, Panel } from '@opengewerk/platform-web'
import { SettingsText, switchTenant, useTenants } from '@opengewerk/platform-web/office'
import { rolesInWords } from '@opengewerk/platform-web/session'
import { RequestRefused, useSync } from '@opengewerk/platform-web/sync'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { useMay } from '../../app/queries.js'
import { createOwnTenant } from '../../session/instance.js'

/**
 * The businesses of this person (#142, #242), `betriebe_card()` of the
 * canvas: each with the roles in it, the one worked in marked, the others one
 * click away without signing in again. An owner creates a further one here and
 * is its owner at once, with the second factor already set up; it starts
 * empty, as after the first run.
 */
export function BusinessesPanel() {
  const client = useSync()
  const queries = useQueryClient()
  const mayCreate = useMay('tenant.create')
  const { list, current } = useTenants()
  const [switching, setSwitching] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [tried, setTried] = useState(false)
  const [made, setMade] = useState<{ tenantId: TenantId; name: string } | null>(null)
  const problem = businessNameProblem(name) ?? undefined

  const create = useMutation({
    mutationFn: createOwnTenant,
    onSuccess: (answer) => {
      setName('')
      setTried(false)
      setMade({ tenantId: answer.tenantId, name: answer.name })
      void queries.invalidateQueries({ queryKey: ['tenants'] })
    },
    onError: (error) => {
      setTrouble(
        error instanceof RequestRefused ? error.message : 'Der Betrieb ließ sich nicht anlegen.',
      )
    },
  })

  function switchTo(tenantId: TenantId) {
    setTrouble(null)
    setSwitching(tenantId)
    switchTenant(client, tenantId).catch(() => {
      setSwitching(null)
      setTrouble('Der Wechsel ging nicht. Ist der Server erreichbar?')
    })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    setTrouble(null)
    setMade(null)

    if (problem) {
      return
    }

    create.mutate(name)
  }

  return (
    <Panel title="Betriebe" roomy>
      <div id="betriebe" className="flex scroll-mt-20 flex-col gap-2.5">
        <SettingsText muted>
          Die Betriebe, in denen du arbeitest. Gewechselt wird ohne neue Anmeldung.
        </SettingsText>
        <ul aria-label="Deine Betriebe" className="flex flex-col">
          {list.map((tenant) => (
            <li key={tenant.id} className="flex items-center gap-2.5 border-t border-row py-2">
              <span className="min-w-0 grow">
                <span className="block text-[14px] font-medium [overflow-wrap:anywhere]">
                  {tenant.name}
                </span>
                <span className="block text-[12px] text-ink-faint">
                  {rolesInWords(tenant.roleLabels)}
                </span>
              </span>
              {tenant.id === current ? (
                <span className="text-[13px] text-ink-faint">Dieser Betrieb</span>
              ) : (
                <Button
                  size="small"
                  aria-label={`Zu ${tenant.name} wechseln`}
                  disabled={switching !== null}
                  onClick={() => {
                    switchTo(tenant.id)
                  }}
                >
                  Wechseln
                </Button>
              )}
            </li>
          ))}
        </ul>
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        {made ? (
          <div className="flex flex-wrap items-center gap-2.5 rounded-[5px] border border-done-edge bg-done-fill px-3 py-2.5">
            <p role="status" className="grow text-[14px] text-done">
              <strong>{made.name}</strong> ist angelegt. Du bist dort Inhaber.
            </p>
            <Button
              size="small"
              disabled={switching !== null}
              onClick={() => {
                switchTo(made.tenantId)
              }}
            >
              Jetzt wechseln
            </Button>
          </div>
        ) : null}
        {mayCreate ? (
          <form
            noValidate
            onSubmit={submit}
            className="flex flex-col gap-2.5 rounded-[5px] border border-line bg-surface-sunken p-3"
          >
            <div className="font-condensed text-label font-semibold uppercase tracking-[1.1px] text-ink-faint">
              Weiterer Betrieb
            </div>
            <Field
              label="Name des Betriebs"
              value={name}
              maxLength={businessNameMaxLength}
              placeholder="etwa Kohm Elektromobilität GmbH"
              hint="Du bist dort Inhaber, mit deinem zweiten Faktor. Der Betrieb startet leer wie nach der Ersteinrichtung: Briefkopf, Steuern und Nummernkreise richtest du dort ein."
              {...(tried && problem ? { problem } : {})}
              onChange={(event) => {
                setName(event.target.value)
              }}
            />
            <div className="flex flex-wrap gap-2">
              <div className="grow" />
              <Button
                disabled={name === ''}
                onClick={() => {
                  setName('')
                  setTried(false)
                }}
              >
                Abbrechen
              </Button>
              <Button tone="primary" type="submit" icon={Plus} disabled={create.isPending}>
                Betrieb anlegen
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </Panel>
  )
}
