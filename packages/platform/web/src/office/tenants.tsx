import type { TenantId } from '@opengewerk/platform-domain'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import clsx from 'clsx'
import { Check, ChevronDown, ChevronUp, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useApplication } from '../application.js'
import type { OwnTenantLink } from '../application.js'
import { accountQuery, tenantsQuery, useRight } from '../session/queries.js'
import { chooseTenant } from '../session/session.js'
import type { TenantChoice } from '../session/session.js'
import { rolesInWords } from '../session/who.js'
import { entryPath } from '../shell/entry.js'
import type { SyncClient } from '../sync/client.js'
import { useSync } from '../sync/provider.js'

/**
 * The tenants of the person signed in, and the switch between them without
 * signing in again (#242). The list is the one the gate and every check of a
 * right read already, so asking it here costs nothing.
 */
export function useTenants(): {
  readonly list: readonly TenantChoice[]
  readonly current: TenantId | null
  /** Whether there is another tenant to switch to, which decides between a button and a name. */
  readonly offersMore: boolean
} {
  const account = useQuery(accountQuery)
  const tenants = useQuery(tenantsQuery)
  const list = tenants.data ?? []

  // Only with a second tenant, as #242 has it: somebody in one sees its name
  // as before.
  return { list, current: account.data?.tenantId ?? null, offersMore: list.length > 1 }
}

/**
 * Moves this session into another tenant and starts the application again in
 * it.
 *
 * What waits in the outbox goes first while there is a connection, which the
 * switch needs anyway: the outbox belongs to the tenant it was written in and
 * would otherwise wait on this device until somebody switches back. Then the
 * session is moved, and the page starts again, the shortest honest way to a
 * sync client and a local store of the new tenant, as signing out does.
 */
export async function switchTenant(client: SyncClient | null, tenantId: TenantId): Promise<void> {
  try {
    await client?.synchronise()

    // A round already under way when the switch was asked for answers for it,
    // and one that fails asks nothing again (`synchronise`). What still waits
    // then gets a round of its own.
    if (client && client.status().pending > 0) {
      await client.synchronise()
    }
  } catch {
    // What could not go out stays in the store of this tenant, as it does
    // without a connection, and goes out after the next switch back.
  }

  await chooseTenant(tenantId)
  globalThis.location.assign(entryPath.office)
}

/**
 * The way to a further tenant of one's own, for whoever the application lets
 * make one: its link and its right are the application's (ADR 0010), which
 * has the route behind it. Nothing where it has none, or for somebody who
 * lacks the right.
 */
function useOwnTenantLink(): OwnTenantLink | null {
  const { ownTenant } = useApplication()
  // Asked whether there is a link or not: a hook is not called now and then.
  const may = useRight(ownTenant?.right ?? '')

  return ownTenant && may ? ownTenant : null
}

/** One tenant in a list to choose from: the name, the roles under it, a tick at the current one. */
function TenantRow({
  tenant,
  current,
  large,
  busy,
  onChoose,
}: {
  readonly tenant: TenantChoice
  readonly current: boolean
  readonly large: boolean
  readonly busy: boolean
  readonly onChoose: () => void
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={current}
      disabled={busy}
      onClick={current ? undefined : onChoose}
      className={clsx(
        'flex w-full items-center gap-2.5 border-0 text-left text-ink cursor-pointer disabled:cursor-wait',
        large ? 'min-h-12 border-t border-line px-3' : 'rounded-control px-2.5 py-2',
        current ? 'bg-selected' : large ? 'bg-surface' : 'bg-transparent hover:bg-surface-sunken',
      )}
    >
      {current ? (
        <Check
          size={large ? 18 : 16}
          strokeWidth={2.4}
          aria-hidden="true"
          className="shrink-0 text-done"
        />
      ) : (
        <span aria-hidden="true" className={large ? 'w-[18px] shrink-0' : 'w-4 shrink-0'} />
      )}
      <span className="min-w-0 grow">
        <span
          className={clsx(
            'block [overflow-wrap:anywhere]',
            large ? 'text-[15px]' : 'text-[14px]',
            current ? 'font-semibold' : 'font-normal',
          )}
        >
          {tenant.name}
        </span>
        <span className={clsx('block text-ink-faint', large ? 'text-[13px]' : 'text-[12px]')}>
          {rolesInWords(tenant.roleLabels)}
        </span>
      </span>
    </button>
  )
}

/** The link under the list, to where a further tenant of one's own is made. */
function OwnTenant({
  link,
  large,
  onFollow,
}: {
  readonly link: OwnTenantLink
  readonly large: boolean
  readonly onFollow: () => void
}) {
  return (
    <Link
      to={link.to}
      {...(link.hash === undefined ? {} : { hash: link.hash })}
      role="menuitem"
      onClick={onFollow}
      className={clsx(
        'flex items-center gap-2.5 text-ink no-underline',
        large
          ? 'min-h-12 border-t border-line bg-surface px-3 text-[15px]'
          : 'rounded-control px-2.5 py-2 text-[14px] hover:bg-surface-sunken',
      )}
    >
      <Plus size={large ? 18 : 16} strokeWidth={1.9} aria-hidden="true" className="shrink-0" />
      {link.label}
    </Link>
  )
}

/** Said under the list when the session did not move. */
const switchTrouble = 'Der Wechsel ging nicht. Ist der Server erreichbar?'

/**
 * The tenant in the header, from 1024 pixels on, `business_popover()` of the
 * canvas: the name, and where there is more than one tenant, a button that
 * opens the list under it. A person in one tenant sees the name as before.
 */
export function TenantMenu({ name }: { readonly name: string }) {
  const client = useSync()
  const own = useOwnTenantLink()
  const { tenants: sentences } = useApplication().sentences
  const { list, current, offersMore } = useTenants()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const frame = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const onPointer = (event: PointerEvent) => {
      if (frame.current && !frame.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!offersMore) {
    return <span className="hidden px-2 text-[13px] text-top-muted lg:inline">{name}</span>
  }

  return (
    <div ref={frame} className="relative hidden lg:block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setTrouble(null)
          setOpen((was) => !was)
        }}
        className="flex h-11 items-center gap-1.5 rounded-control px-2 text-[13px] text-top-muted cursor-pointer"
      >
        {name}
        <ChevronDown size={13} strokeWidth={2.2} aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={sentences.switch}
          className="absolute left-0 top-full z-40 flex w-[280px] flex-col gap-0.5 rounded-[6px] border border-line bg-surface p-2 text-ink shadow-[0_8px_24px_rgb(20_26_35/0.18)]"
        >
          <div className="px-2.5 pt-1 pb-1.5 font-condensed text-label font-semibold uppercase tracking-[1.1px] text-ink-faint">
            {sentences.switch}
          </div>
          {list.map((tenant) => (
            <TenantRow
              key={tenant.id}
              tenant={tenant}
              current={tenant.id === current}
              large={false}
              busy={busy}
              onChoose={() => {
                setBusy(true)
                switchTenant(client, tenant.id).catch(() => {
                  setBusy(false)
                  setTrouble(switchTrouble)
                })
              }}
            />
          ))}
          {trouble ? (
            <p role="alert" className="px-2.5 py-1 text-[13px] font-semibold text-conflict">
              {trouble}
            </p>
          ) : null}
          {own ? (
            <>
              <div aria-hidden="true" className="my-1 h-px bg-line" />
              <OwnTenant
                link={own}
                large={false}
                onFollow={() => {
                  setOpen(false)
                }}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The tenant at the top of the menu on a phone, `business_drawer()` of the
 * canvas: a box with the name that opens the list under it in place, the way
 * the rest of the menu goes on below.
 */
export function DrawerTenant({
  name,
  onFollow,
}: {
  readonly name: string
  readonly onFollow: () => void
}) {
  const client = useSync()
  const own = useOwnTenantLink()
  const { tenants: sentences } = useApplication().sentences
  const { list, current, offersMore } = useTenants()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)

  if (!offersMore) {
    return (
      <div className="mx-3 mt-3 mb-1 flex min-h-12 items-center rounded-[5px] border border-line bg-surface px-3 text-[15px] font-semibold">
        {name}
      </div>
    )
  }

  const Chevron = open ? ChevronUp : ChevronDown

  return (
    <div className="mx-3 mt-3 mb-1 flex shrink-0 flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          setTrouble(null)
          setOpen((was) => !was)
        }}
        className={clsx(
          'flex min-h-12 items-center gap-2 border border-line bg-surface px-3 text-left text-[15px] font-semibold text-ink cursor-pointer',
          open ? 'rounded-t-[5px]' : 'rounded-[5px]',
        )}
      >
        <span className="grow [overflow-wrap:anywhere]">{name}</span>
        <Chevron size={16} strokeWidth={2.2} aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={sentences.switch}
          className="overflow-hidden rounded-b-[5px] border border-t-0 border-line"
        >
          {list.map((tenant) => (
            <TenantRow
              key={tenant.id}
              tenant={tenant}
              current={tenant.id === current}
              large
              busy={busy}
              onChoose={() => {
                setBusy(true)
                switchTenant(client, tenant.id).catch(() => {
                  setBusy(false)
                  setTrouble(switchTrouble)
                })
              }}
            />
          ))}
          {trouble ? (
            <p
              role="alert"
              className="border-t border-line bg-surface px-3 py-2 text-[14px] font-semibold text-conflict"
            >
              {trouble}
            </p>
          ) : null}
          {own ? <OwnTenant link={own} large onFollow={onFollow} /> : null}
        </div>
      ) : null}
    </div>
  )
}
