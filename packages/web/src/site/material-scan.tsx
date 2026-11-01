import { eanFromScan, type IsoDate } from '@opengewerk/domain'
import { Button } from '@opengewerk/platform-web'
import { SiteText, useCodeReading } from '@opengewerk/platform-web/site'
import { Info, Pencil, ScanLine, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { type FoundArticle, useEanLookup } from '../app/article-search.js'
import { ArticleHits, type StockOf } from './article-choice.js'

/** An article a scan found, and the EAN it was found by. */
export interface ScannedArticle {
  readonly article: FoundArticle
  readonly ean: string
}

interface Ways {
  /** "Von Hand eintragen": the form of "Material eintragen" without an article. */
  readonly onByHand: () => void
  readonly onCancel: () => void
}

/**
 * "Material scannen" in the report (#263), the boards "Material scannen",
 * "Zwei Artikel zu einer EAN", "Kein Artikel mit dieser EAN" and "Das ist
 * keine EAN": the camera reads the EAN on a package or at the shelf, and the
 * article with it goes to `onFound`, which fills "Material eintragen". Several
 * articles with one EAN stand as a choice; a code that is no EAN, or an EAN
 * no article has, says so.
 */
export function MaterialScan({
  day,
  stock,
  onFound,
  onByHand,
  onCancel,
}: Ways & {
  /** The date of the report. */
  readonly day: IsoDate
  /** What the store of the report holds of each article (#298), where the device knows it. */
  readonly stock?: StockOf
  readonly onFound: (scanned: ScannedArticle) => void
}) {
  // What the camera read: the EAN in it, or null for a code that is none.
  const [read, setRead] = useState<{ readonly ean: string | null } | null>(null)
  const ways = { onByHand, onCancel }

  const again = () => {
    setRead(null)
  }

  if (read === null) {
    return (
      <ScanCamera
        onCode={(code) => {
          setRead({ ean: eanFromScan(code) })
        }}
        {...ways}
      />
    )
  }

  if (read.ean === null) {
    return (
      <ScanMessage
        icon={TriangleAlert}
        tone="waiting"
        title="Das ist keine EAN"
        lines={[
          'Material findet die App an der EAN, dem Strichcode mit 13 oder 8 Ziffern auf der Packung oder am Regal.',
          'Ein QR-Etikett einer Anlage öffnet der Reiter „Scannen“.',
        ]}
        onAgain={again}
        {...ways}
      />
    )
  }

  return (
    <ScannedEan
      ean={read.ean}
      day={day}
      onFound={onFound}
      onAgain={again}
      {...ways}
      {...(stock ? { stock } : {})}
    />
  )
}

/** The camera within the card, as the board draws it: dark, the wide frame for a bar code. */
function ScanCamera({
  onCode,
  onByHand,
  onCancel,
}: Ways & { readonly onCode: (code: string) => void }) {
  const { video, trouble } = useCodeReading(true, onCode, {
    noReader: 'Dieses Gerät liest keine Strichcodes. Das Material dann von Hand eintragen.',
    noCamera:
      'Die Kamera lässt sich nicht öffnen, sie ist nicht freigegeben oder nicht da. Das Material dann von Hand eintragen.',
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="relative h-[240px] overflow-hidden rounded-[6px] bg-camera">
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
            className="absolute top-1/2 left-1/2 h-[104px] w-[min(258px,80%)] -translate-x-1/2 -translate-y-1/2 rounded-[10px] border-[3px] border-camera-ink shadow-[0_0_0_2000px_rgb(14_19_26/0.45)]"
          />
        )}
      </div>
      <p role={trouble ? 'alert' : undefined} className="text-[16px] leading-[1.45] text-ink">
        {trouble ?? 'Die EAN auf der Packung oder am Regal in den Rahmen halten.'}
      </p>
      <Button wide height={48} icon={Pencil} onClick={onByHand}>
        Von Hand eintragen
      </Button>
      <Button wide height={48} onClick={onCancel}>
        Abbrechen
      </Button>
    </div>
  )
}

/** How many articles share the EAN, in words, as the board says it. */
const counted = ['zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht']

/**
 * An EAN and what it finds: the one article goes straight on to "Material
 * eintragen", several stand as a choice, none says so.
 */
function ScannedEan({
  ean,
  day,
  stock,
  onFound,
  onAgain,
  onByHand,
  onCancel,
}: Ways & {
  readonly ean: string
  readonly day: IsoDate
  readonly stock?: StockOf
  readonly onFound: (scanned: ScannedArticle) => void
  readonly onAgain: () => void
}) {
  const lookup = useEanLookup(ean, day)
  const only = lookup.state === 'found' && lookup.articles.length === 1 ? lookup.articles[0] : null
  const taken = useRef(false)

  useEffect(() => {
    if (only && !taken.current) {
      taken.current = true
      onFound({ article: only, ean })
    }
  }, [only, ean, onFound])

  if (lookup.state === 'unknown') {
    return (
      <ScanMessage
        icon={Info}
        tone="muted"
        title="Kein Artikel mit dieser EAN"
        lines={[
          lookup.where === 'device'
            ? `Die EAN ${ean} kennt dieses Gerät nicht. Ohne Netz liegen hier die häufigen Artikel und die der letzten 90 Tage, den ganzen Katalog gibt es mit Netz.`
            : `Auch im ganzen Katalog hat kein Artikel die EAN ${ean}. Einen neuen Artikel legt das Büro an.`,
        ]}
        onAgain={onAgain}
        onByHand={onByHand}
        onCancel={onCancel}
      />
    )
  }

  if (lookup.state === 'searching' || only) {
    return (
      <SiteText muted size={15}>
        Einen Moment, die App sucht den Artikel zur EAN {ean}.
      </SiteText>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <SiteText size={16}>
        Zur EAN {ean} gibt es{' '}
        {counted[lookup.articles.length - 2] ?? String(lookup.articles.length)} Artikel.
      </SiteText>
      <ArticleHits
        articles={lookup.articles}
        onPick={(article) => {
          onFound({ article, ean })
        }}
        {...(stock ? { stock } : {})}
      />
      <Button wide height={48} icon={Pencil} onClick={onByHand}>
        Von Hand eintragen
      </Button>
      <Button wide height={48} onClick={onCancel}>
        Abbrechen
      </Button>
    </div>
  )
}

const tones = {
  muted: { border: 'border-l-ink-muted', icon: 'text-ink-muted' },
  waiting: { border: 'border-l-waiting', icon: 'text-waiting' },
} as const

/** Why a scan takes nothing over, and the ways on: scan again, type it, or back. */
function ScanMessage({
  icon: Icon,
  tone,
  title,
  lines,
  onAgain,
  onByHand,
  onCancel,
}: Ways & {
  readonly icon: LucideIcon
  readonly tone: keyof typeof tones
  readonly title: string
  readonly lines: readonly string[]
  readonly onAgain: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <section
        role="status"
        className={`flex flex-col gap-2.5 rounded-[6px] border border-l-4 border-line bg-ground px-3.5 py-4 ${tones[tone].border}`}
      >
        <div className="flex items-center gap-2.5">
          <Icon
            size={24}
            strokeWidth={2.3}
            aria-hidden="true"
            className={`shrink-0 ${tones[tone].icon}`}
          />
          <h2 className="text-[19px] leading-[1.3] font-bold">{title}</h2>
        </div>
        {lines.map((line) => (
          <p key={line} className="text-[16px] leading-[1.45] text-ink-muted">
            {line}
          </p>
        ))}
      </section>
      <Button tone="primary" wide height={52} icon={ScanLine} onClick={onAgain}>
        Nochmal scannen
      </Button>
      <Button wide height={48} icon={Pencil} onClick={onByHand}>
        Von Hand eintragen
      </Button>
      <Button wide height={48} onClick={onCancel}>
        Abbrechen
      </Button>
    </div>
  )
}
