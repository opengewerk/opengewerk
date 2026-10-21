import type { InstanceCertificateView, InstanceSigningState } from '@opengewerk/platform-domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../components/button.js'
import { Confirm } from '../components/confirm.js'
import { Panel } from '../components/panel.js'
import { date, moment } from '../format.js'
import { SettingsText } from '../office/settings.js'
import { instanceSigning, renewInstanceSigning } from '../session/instance.js'
import { RequestRefused } from '../sync/transport.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/**
 * The key the instance signs PDFs with (opengewerk-haustechnik#457), the card
 * "Signatur der PDFs" of the board `HT-Instanz-Einstellungen`: the
 * certificate with its fingerprint, and a new key on request. On an instance
 * whose application signs nothing there is no card.
 */
export function InstanceSigning() {
  const state = useQuery({ queryKey: ['instance-signing'], queryFn: instanceSigning })

  if (state.isPending || (state.isSuccess && !state.data.signs)) {
    return null
  }

  return (
    <Panel title="Signatur der PDFs" roomy>
      <div className="flex flex-col gap-3">
        <SettingsText muted>
          Jedes PDF mit einer Unterschrift darin signiert die Instanz mit ihrem eigenen Schlüssel.
          Wird es danach geändert, zeigt jedes PDF-Programm die Signatur als ungültig. Der Schlüssel
          liegt versiegelt in der Datenbank der Instanz; ein Passwort zum Öffnen braucht das PDF
          nicht.
        </SettingsText>
        {state.isError ? (
          <SettingsText muted>
            {saidWhy(state.error, 'Die Signatur der Instanz kam nicht an.')}
          </SettingsText>
        ) : (
          <SigningBody certificate={state.data.certificate} />
        )}
      </div>
    </Panel>
  )
}

function SigningBody({ certificate }: { readonly certificate: InstanceCertificateView | null }) {
  const queries = useQueryClient()
  const [asking, setAsking] = useState(false)
  const renew = useMutation({
    mutationFn: renewInstanceSigning,
    onSuccess: (saved: InstanceSigningState) => {
      queries.setQueryData(['instance-signing'], saved)
    },
  })
  const refused = renew.isError ? (
    <p role="alert" className="text-[13px] font-semibold text-conflict">
      {saidWhy(renew.error, 'Der neue Schlüssel ist nicht entstanden.')}
    </p>
  ) : null

  if (certificate === null) {
    return (
      <>
        <SettingsText>
          Noch kein Schlüssel. Er entsteht mit dem ersten PDF, das eine Unterschrift zeigt, oder
          hier.
        </SettingsText>
        <div>
          <Button
            type="button"
            icon={Plus}
            disabled={renew.isPending}
            onClick={() => {
              renew.mutate()
            }}
          >
            Schlüssel erzeugen
          </Button>
        </div>
        {refused}
      </>
    )
  }

  return (
    <>
      {certificate.readable ? null : (
        <div
          role="note"
          className="flex items-start gap-2 rounded-[5px] border border-line bg-surface-sunken px-3 py-2.5 text-[13px] leading-[1.45]"
        >
          <TriangleAlert
            size={16}
            strokeWidth={2.2}
            aria-hidden="true"
            className="mt-px shrink-0 text-ink-muted"
          />
          <span>
            Der gespeicherte Schlüssel lässt sich nicht mehr öffnen, weil SESSION_SECRET der Instanz
            seitdem getauscht wurde. Mit dem nächsten PDF entsteht ein neuer.
          </span>
        </div>
      )}
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-baseline">
        <dt className="text-[12px] text-ink-muted">Zertifikat für</dt>
        <dd className="text-[13px]">
          {certificate.commonName}, {certificate.organisation}
        </dd>
        <dt className="text-[12px] text-ink-muted">Fingerabdruck (SHA-256)</dt>
        <dd className="font-mono text-[12px] break-all">{certificate.fingerprint}</dd>
        <dt className="text-[12px] text-ink-muted">Gültig</dt>
        <dd className="text-[13px]">
          {date(certificate.validFrom)} bis {date(certificate.validTo)}
        </dd>
        <dt className="text-[12px] text-ink-muted">Signiert seit</dt>
        <dd className="text-[13px]">{moment(certificate.since)}</dd>
        <dt className="text-[12px] text-ink-muted">Frühere Zertifikate</dt>
        <dd className="text-[13px]">
          {certificate.earlier === 0 ? 'keine' : String(certificate.earlier)}
        </dd>
      </dl>
      <SettingsText muted>
        Der Fingerabdruck steht in jedem PDF-Programm bei den Angaben zur Signatur. Stimmt er
        überein, stammt das PDF aus dieser Instanz.
      </SettingsText>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          icon={RefreshCw}
          disabled={renew.isPending}
          onClick={() => {
            setAsking(true)
          }}
        >
          Neuen Schlüssel erzeugen
        </Button>
        <span className="self-center text-[12px] text-ink-muted">
          PDFs mit dem bisherigen Schlüssel bleiben gültig und werden weiter erkannt.
        </span>
      </div>
      {refused}
      <Confirm
        open={asking}
        title="Neuen Schlüssel erzeugen?"
        confirm="Erzeugen"
        tone="primary"
        busy={renew.isPending}
        onConfirm={() => {
          setAsking(false)
          renew.mutate()
        }}
        onCancel={() => {
          setAsking(false)
        }}
      >
        Jedes PDF, das von jetzt an entsteht, trägt die Signatur des neuen Schlüssels. PDFs mit der
        bisherigen Signatur bleiben gültig, und die Instanz erkennt sie weiter als ihre.
      </Confirm>
    </>
  )
}
