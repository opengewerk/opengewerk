import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button, Card, Cell, Column, Table } from '../../components/index.js'
import { moment } from '../../app/format.js'
import { devices, revokeDevice, signOut } from '../../session/session.js'
import { Nothing, Page } from '../layout.js'

/**
 * Where somebody is signed in, and the way to cut one of them off.
 *
 * The screen that makes the long session of ADR 0006 bearable. A phone on a
 * registered device stays signed in for thirty days, which is right for
 * somebody in a cellar and wrong for a phone left in a van that was broken
 * into, so there has to be a place to end it from a desk.
 */
export function DeviceScreen() {
  const queries = useQueryClient()
  const list = useQuery({ queryKey: ['devices'], queryFn: devices })
  const [trouble, setTrouble] = useState<string | null>(null)

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
      title="Geräte"
      meta="Jede Anmeldung, die gerade gilt."
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

      <Card label="Angemeldete Geräte">
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
      </Card>
    </Page>
  )
}
