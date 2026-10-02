import { labelCodeFromScan } from '@opengewerk/domain'
import { Button } from '@opengewerk/platform-web'
import { SiteScreen, SiteText } from '@opengewerk/platform-web/site'
import { useSync } from '@opengewerk/platform-web/sync'
import { useNavigate } from '@tanstack/react-router'
import { Ban, Info, ScanLine, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { labelMessages, useLabelLookup } from '../../app/installation-labels.js'
import { useCodeReading } from '../camera.js'
import { SiteHeader } from '../header.js'

/**
 * The tab "Scannen" (#308), the boards "Etikett scannen" and the three that
 * say why a code opens nothing: the camera looks for the QR label of an
 * installation and opens the installation it belongs to, also without a
 * network when the installation lies on this device.
 *
 * Only the path of the address on the label counts, not its host, so a label
 * printed while the instance lived under another address still opens its
 * installation here.
 */
export function SiteLabelScanScreen() {
  const [scanned, setScanned] = useState<string | null>(null)
  const [foreign, setForeign] = useState(false)

  const again = () => {
    setScanned(null)
    setForeign(false)
  }

  if (foreign) {
    return (
      <LabelMessage
        icon={TriangleAlert}
        tone="waiting"
        message={labelMessages.foreign}
        onAgain={again}
      />
    )
  }

  if (scanned !== null) {
    return <ScannedLabel code={scanned} onAgain={again} />
  }

  return (
    <LabelCamera
      onCode={(text) => {
        const code = labelCodeFromScan(text)

        if (code === null) {
          setForeign(true)
        } else {
          setScanned(code)
        }
      }}
    />
  )
}

/**
 * The camera within the tab, as the board draws it: dark, the square frame
 * for the QR, the sentence under it, the tabs below.
 */
function LabelCamera({ onCode }: { readonly onCode: (text: string) => void }) {
  const { video, trouble } = useCodeReading(true, onCode, {
    noReader: 'Dieses Gerät liest keine QR-Codes. Eine Anlage öffnet sich dann über ihren Auftrag.',
    noCamera:
      'Die Kamera lässt sich nicht öffnen, sie ist nicht freigegeben oder nicht da. Eine Anlage öffnet sich dann über ihren Auftrag.',
  })

  return (
    <div className="flex min-h-[calc(100dvh-64px)] flex-col bg-camera text-camera-ink">
      <div className="shrink-0 px-4 py-3.5">
        <h1 className="text-[19px] font-bold">Etikett scannen</h1>
        <p className="text-[15px] text-camera-muted">QR-Etikett einer Anlage</p>
      </div>
      <div className="relative min-h-[420px] grow overflow-hidden">
        <video
          ref={video}
          muted
          playsInline
          aria-label="Bild der Kamera"
          className="absolute inset-0 size-full object-cover"
        />
        {trouble ? null : (
          <div
            aria-hidden="true"
            className="absolute top-[12%] left-1/2 aspect-square w-[min(250px,70%)] -translate-x-1/2 rounded-[10px] border-[3px] border-camera-ink shadow-[0_0_0_2000px_rgb(14_19_26/0.45)]"
          />
        )}
        <p
          role={trouble ? 'alert' : undefined}
          className="absolute inset-x-0 top-[calc(12%+274px)] px-7 text-center text-[16px] leading-[1.45]"
        >
          {trouble ?? 'Den QR-Code auf dem Etikett der Anlage in den Rahmen halten.'}
        </p>
      </div>
    </div>
  )
}

/**
 * A code of a label: the installation it opens, or why it opens none. A code
 * the device does not know is asked for once more after an exchange, since a
 * label made in the office a minute ago is not on the device yet.
 */
function ScannedLabel({ code, onAgain }: { readonly code: string; readonly onAgain: () => void }) {
  const client = useSync()
  const navigate = useNavigate()
  const lookup = useLabelLookup(code)
  const [asked, setAsked] = useState(false)
  const asking = useRef(false)

  useEffect(() => {
    if (lookup.state === 'open') {
      void navigate({ to: `/anlagen/${lookup.installationId}` })
    }
  }, [lookup, navigate])

  useEffect(() => {
    if (lookup.state !== 'unknown' || asking.current) {
      return
    }

    asking.current = true
    void client
      .synchronise()
      .catch(() => undefined)
      .then(() => {
        setAsked(true)
      })
  }, [client, lookup.state])

  if (
    lookup.state === 'open' ||
    lookup.state === 'waiting' ||
    (lookup.state === 'unknown' && !asked)
  ) {
    return (
      <SiteScreen>
        <SiteHeader title="Etikett scannen" />
        <SiteText muted>Einen Moment, dieses Gerät sucht die Anlage des Etiketts.</SiteText>
      </SiteScreen>
    )
  }

  if (lookup.state === 'blocked') {
    return (
      <LabelMessage icon={Ban} tone="conflict" message={labelMessages.blocked} onAgain={onAgain} />
    )
  }

  return (
    <LabelMessage
      icon={Info}
      tone="muted"
      message={lookup.wholeBusiness ? labelMessages.notOurs : labelMessages.notHere}
      onAgain={onAgain}
    />
  )
}

const tones = {
  muted: { border: 'border-l-ink-muted', icon: 'text-ink-muted' },
  conflict: { border: 'border-l-conflict', icon: 'text-conflict' },
  waiting: { border: 'border-l-waiting', icon: 'text-waiting' },
} as const

/** What a code opens not, as the boards "... nicht auf dem Gerät", "Gesperrtes Etikett" and "Ein Code, der kein Etikett ist" draw it. */
function LabelMessage({
  icon: Icon,
  tone,
  message,
  onAgain,
}: {
  readonly icon: LucideIcon
  readonly tone: keyof typeof tones
  readonly message: { readonly title: string; readonly lines: readonly string[] }
  readonly onAgain: () => void
}) {
  return (
    <SiteScreen>
      <SiteHeader title="Etikett scannen" />
      <section
        role="status"
        className={`flex flex-col gap-2.5 rounded-[6px] border border-l-4 border-line bg-surface px-4 py-[18px] ${tones[tone].border}`}
      >
        <div className="flex items-center gap-2.5">
          <Icon
            size={24}
            strokeWidth={2.3}
            aria-hidden="true"
            className={`shrink-0 ${tones[tone].icon}`}
          />
          <h2 className="text-[19px] leading-[1.3] font-bold">{message.title}</h2>
        </div>
        {message.lines.map((line) => (
          <p key={line} className="text-[16px] leading-[1.45] text-ink-muted">
            {line}
          </p>
        ))}
      </section>
      <Button tone="primary" wide height={56} icon={ScanLine} onClick={onAgain}>
        Nochmal scannen
      </Button>
    </SiteScreen>
  )
}
