import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button, Cell, Column, Table } from '../../components/index.js'
import { moment } from '../../app/format.js'
import { SecondFactorSetup } from '../../app/setup.js'
import { currentAccount, devices, revokeDevice, signOut } from '../../session/session.js'
import { Nothing, Page, Section } from '../layout.js'

/**
 * What somebody can look after about their own account: the second factor and
 * the devices they are signed in on.
 *
 * One screen and not two, because both answer the same question: who can get
 * in as me, and how do I stop them. The device list is what makes the long
 * session of ADR 0006 bearable, a phone on a registered device stays signed in
 * for thirty days, which is right for somebody in a cellar and wrong for a
 * phone left in a van that was broken into.
 */
export function AccountScreen() {
  const queries = useQueryClient()
  const account = useQuery({ queryKey: ['account'], queryFn: currentAccount })
  const list = useQuery({ queryKey: ['devices'], queryFn: devices })
  const [trouble, setTrouble] = useState<string | null>(null)
  const [setting, setSetting] = useState(false)

  const revoke = useMutation({
    mutationFn: revokeDevice,
    onSuccess: () => {
      void queries.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: () => {
      setTrouble('Das Gerät ließ sich nicht abmelden.')
    },
  })

  return (
    <Page
      title="Konto"
      meta={account.data ? `${account.data.name}, ${account.data.email}` : 'Dieses Konto.'}
      actions={
        <Button
          tone="secondary"
          onClick={() => {
            // Reloading afterwards rather than routing: signing out has to end
            // with the sync client stopped and the local store closed, and the
            // shortest honest way to be sure of that is to start again.
            void signOut().finally(() => {
              globalThis.location.assign('/')
            })
          }}
        >
          Abmelden
        </Button>
      }
    >
      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      <Section title="Zweiter Faktor">
        {account.data?.twoFactorEnabled ? (
          <p className="text-body">
            Eingerichtet. Bei jeder Anmeldung fragt OpenGewerk zusätzlich nach dem Code aus der App.
          </p>
        ) : setting ? (
          <SecondFactorSetup
            onDone={() => {
              setSetting(false)
              // The confirmation swaps the session, so what the application
              // knows about the account and about the devices is both a step
              // behind.
              void queries.invalidateQueries({ queryKey: ['account'] })
              void queries.invalidateQueries({ queryKey: ['devices'] })
            }}
            onCancel={() => {
              setSetting(false)
            }}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-body">
              Noch nicht eingerichtet. Ein zweiter Faktor macht ein gestohlenes Passwort allein
              nutzlos. Für die Rolle Inhaber ist er Pflicht, für alle anderen empfohlen.
            </p>
            <div>
              <Button
                tone="primary"
                onClick={() => {
                  setSetting(true)
                }}
              >
                Zweiten Faktor einrichten
              </Button>
            </div>
          </div>
        )}
      </Section>

      <Section title="Angemeldete Geräte">
        {list.isPending ? (
          <Nothing>Wird geladen.</Nothing>
        ) : list.isError ? (
          <Nothing>Die Liste kam nicht an.</Nothing>
        ) : list.data.length === 0 ? (
          <Nothing>Keine Anmeldung außer dieser.</Nothing>
        ) : (
          <Table caption="Geräte, auf denen dieses Konto angemeldet ist">
            <thead>
              <tr>
                <Column>Gerät</Column>
                <Column>Angemeldet</Column>
                <Column>Läuft ab</Column>
                <Column>Art</Column>
                <Column>
                  <span className="sr-only">Abmelden</span>
                </Column>
              </tr>
            </thead>
            <tbody>
              {list.data.map((entry) => (
                <tr key={entry.sessionId}>
                  <Cell>
                    {entry.userAgent ?? 'Unbekanntes Gerät'}
                    {entry.current ? (
                      <span className="ml-2 font-semibold text-copper-text">dieses Gerät</span>
                    ) : null}
                  </Cell>
                  <Cell>{moment(entry.signedInAt)}</Cell>
                  <Cell>{moment(entry.expiresAt)}</Cell>
                  <Cell>{entry.longLived ? 'Baustelle, 30 Tage' : 'Büro, 12 Stunden'}</Cell>
                  <Cell>
                    <Button
                      tone="danger"
                      disabled={entry.current || revoke.isPending}
                      onClick={() => {
                        setTrouble(null)
                        revoke.mutate(entry.sessionId)
                      }}
                    >
                      Abmelden
                    </Button>
                  </Cell>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </Page>
  )
}
