import { serialFromCode, serialNumberProblem } from '@opengewerk/domain'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Camera, Check, Pencil, X } from 'lucide-react'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import { Button, Field } from '../../components/index.js'
import { openCamera, openCodeReader, type CodeReader } from '../../app/barcode.js'
import { inModules, usePvModules } from '../../app/photovoltaic.js'
import { refusalFor } from '../../sync/client.js'
import { maybeText, text } from '../../sync/fields.js'
import { useRecord, useRecords, useSync } from '../../sync/provider.js'
import { SiteActionBar } from '../action-bar.js'
import { SiteHeader } from '../header.js'
import { SiteScreen, SiteText } from '../kit.js'

/**
 * Serial numbers from the labels of a string's modules (#300), as the boards
 * "Seriennummern scannen" and "Seriennummer von Hand" draw it: the camera with
 * a frame for the label, which module is next and which was last, and typing
 * the number where no label can be read.
 *
 * Every number goes to the next module of the string that has none, in the
 * order of the string, and through the outbox like anything else on site: a
 * roof has no network more often than not. A number that another module
 * already has is refused with the module's name, since the same label read
 * twice is the likelier story than two modules with one number.
 */

/**
 * Where the camera and the reader come from, and how often a frame is read.
 * The tests put their own in; a browser without a camera has none to give.
 */
export interface Scanning {
  readonly openReader: () => Promise<CodeReader | null>
  readonly openCamera: () => Promise<MediaStream>
  /** Milliseconds between two frames. */
  readonly interval: number
}

export const ScanningContext = createContext<Scanning>({
  openReader: openCodeReader,
  openCamera,
  interval: 250,
})

/** A number the camera keeps seeing after it was taken is the same label, not a new one. */
const sameLabelFor = 3_000

type Taken = { readonly number: number; readonly serial: string }

export function SiteScannerScreen() {
  const { jobId, inverterId, stringId } = useParams({ strict: false }) as {
    jobId?: string
    inverterId?: string
    stringId?: string
  }
  const navigate = useNavigate()
  const client = useSync()
  const pvString = useRecord('pv_strings', stringId)
  const inverter = useRecord('inverters', inverterId)
  const modules = usePvModules(stringId)
  const everyModule = useRecords('pv_modules')
  const strings = useRecords('pv_strings')
  const [mode, setMode] = useState<'camera' | 'hand'>('camera')
  const [last, setLast] = useState<Taken | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // The number of the last label taken and when, so that the camera, still on
  // the label, does not take it again or call it somebody else's.
  const lastLabel = useRef<{ readonly serial: string; readonly at: number } | null>(null)
  const busy = useRef(false)

  const back = `/auftraege/${jobId ?? ''}/wechselrichter/${inverterId ?? ''}/strings/${stringId ?? ''}`
  const index = modules.findIndex((module) => maybeText(module, 'serialNumber') === null)
  const target = index < 0 ? null : modules[index]
  const where = [text(pvString, 'designation'), text(inverter, 'designation')]
    .filter((part) => part !== '')
    .join(', ')

  /** The module that has this number already, named as the site names it, or null. */
  function holderOf(serial: string): string | null {
    const holder = everyModule.find((module) => maybeText(module, 'serialNumber') === serial)

    if (!holder) {
      return null
    }

    const own = text(holder, 'pvStringId')
    const siblings = inModules(everyModule.filter((module) => text(module, 'pvStringId') === own))
    const number = siblings.findIndex((module) => module['id'] === holder['id']) + 1
    const place = strings.find((one) => String(one['id']) === own)

    return own === stringId || !place
      ? `Modul ${String(number)}`
      : `Modul ${String(number)} an ${text(place, 'designation')}`
  }

  /** Takes a number for the next module without one; says why not, where not. */
  async function take(serial: string): Promise<boolean> {
    if (!target) {
      return false
    }

    const holder = holderOf(serial)

    if (holder !== null) {
      setNotice(`Diese Nummer hat schon ${holder}.`)

      return false
    }

    const result = await client.update('pv_modules', String(target['id']), { serialNumber: serial })

    if (result.outcome === 'refused') {
      setNotice(refusalFor(result))

      return false
    }

    lastLabel.current = { serial, at: Date.now() }
    setLast({ number: index + 1, serial })
    setNotice(null)
    navigator.vibrate?.(60)

    return true
  }

  async function read(code: string) {
    const serial = serialFromCode(code)
    const previous = lastLabel.current

    if (
      serial === null ||
      busy.current ||
      (previous && previous.serial === serial && Date.now() - previous.at < sameLabelFor)
    ) {
      return
    }

    busy.current = true

    try {
      await take(serial)
    } finally {
      busy.current = false
    }
  }

  if (!pvString || !stringId || !jobId || !inverterId) {
    return (
      <SiteScreen>
        <SiteHeader title="Nicht gefunden" />
        <SiteText>
          Diesen String hat dieses Gerät nicht. Mit Verbindung holt der Abgleich ihn.
        </SiteText>
      </SiteScreen>
    )
  }

  const heading = target
    ? `Modul ${String(index + 1)} von ${String(modules.length)}`
    : 'Alle Module haben eine Seriennummer'

  if (mode === 'hand') {
    return (
      <ByHand
        heading={heading}
        sub={`${where}, von Hand`}
        number={target ? index + 1 : null}
        notice={notice}
        onTake={take}
        onCamera={() => {
          setNotice(null)
          setMode('camera')
        }}
        onDone={() => void navigate({ to: back })}
      />
    )
  }

  return (
    <CameraScreen
      heading={heading}
      sub={where}
      done={target === null}
      last={last}
      notice={notice}
      onCode={(code) => void read(code)}
      onClose={() => void navigate({ to: back })}
      onHand={() => {
        setNotice(null)
        setMode('hand')
      }}
    />
  )
}

/**
 * The camera screen, `baustelle_scanner()`: dark from edge to edge over the
 * tabs, the label to hold in the frame, the module last taken and the two
 * ways on at the foot.
 */
function CameraScreen({
  heading,
  sub,
  done,
  last,
  notice,
  onCode,
  onClose,
  onHand,
}: {
  readonly heading: string
  readonly sub: string
  readonly done: boolean
  readonly last: Taken | null
  readonly notice: string | null
  readonly onCode: (code: string) => void
  readonly onClose: () => void
  readonly onHand: () => void
}) {
  const scanning = useContext(ScanningContext)
  const video = useRef<HTMLVideoElement>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const latestCode = useRef(onCode)

  // The handler of the last render, which knows the module that is next.
  useEffect(() => {
    latestCode.current = onCode
  })

  useEffect(() => {
    // No camera once every module has its number: nothing left to read.
    if (done) {
      return
    }

    let stopped = false
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    const release = () => {
      for (const track of stream?.getTracks() ?? []) {
        track.stop()
      }
    }

    void (async () => {
      const reader = await scanning.openReader()

      if (stopped) {
        return
      }

      if (!reader) {
        setTrouble(
          'Dieses Gerät liest keine Strichcodes. Die Nummern lassen sich von Hand eingeben.',
        )

        return
      }

      const element = video.current

      try {
        stream = await scanning.openCamera()

        if (stopped || !element) {
          release()

          return
        }

        element.srcObject = stream
      } catch {
        // Refused, not there, or a stream the picture does not take: the same
        // for whoever stands on the roof.
        release()

        if (!stopped) {
          setTrouble(
            'Die Kamera lässt sich nicht öffnen, sie ist nicht freigegeben oder nicht da. Die Nummern lassen sich von Hand eingeben.',
          )
        }

        return
      }

      try {
        await element.play()
      } catch {
        // A picture that does not start is read all the same, or not at all;
        // either way the frames below say so.
      }

      const next = async () => {
        if (stopped) {
          return
        }

        const code = await reader.read(element).catch(() => null)

        if (code !== null && !stopped) {
          latestCode.current(code)
        }

        timer = setTimeout(() => void next(), scanning.interval)
      }

      void next()
    })()

    return () => {
      stopped = true
      clearTimeout(timer)
      release()
    }
  }, [done, scanning])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-camera text-camera-ink">
      <div className="flex shrink-0 items-center gap-3 px-4 py-3.5">
        <div className="min-w-0 grow">
          <h1 className="text-[19px] font-bold">{heading}</h1>
          <p className="text-[15px] text-camera-muted">{sub}</p>
        </div>
        <button
          type="button"
          aria-label="Scannen beenden"
          onClick={onClose}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-camera-ink/15 text-camera-ink"
        >
          <X size={20} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>

      <div className="relative min-h-0 grow overflow-hidden">
        {done ? null : (
          <video
            ref={video}
            muted
            playsInline
            aria-label="Bild der Kamera"
            className="absolute inset-0 size-full object-cover"
          />
        )}
        {/* The frame the label is held in, the rest of the picture dimmed. */}
        {done || trouble ? null : (
          <div
            aria-hidden="true"
            className="absolute top-[18%] left-1/2 h-[190px] w-[min(290px,80%)] -translate-x-1/2 rounded-[10px] border-[3px] border-camera-ink shadow-[0_0_0_2000px_rgb(14_19_26/0.45)]"
          />
        )}
        <p
          role={trouble || notice ? 'alert' : undefined}
          className="absolute inset-x-0 top-[calc(18%+214px)] px-7 text-center text-[16px] leading-[1.45]"
        >
          {done
            ? 'Jedes Modul dieses Strings hat eine Seriennummer.'
            : (trouble ??
              notice ??
              'Das Etikett mit dem Strichcode oder QR-Code in den Rahmen halten.')}
        </p>
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-ground px-4 pt-3 pb-4 text-ink">
        {last ? (
          <div
            role="status"
            className="flex items-center gap-2.5 rounded-[6px] border border-line bg-surface px-3.5 py-3"
          >
            <Check size={20} strokeWidth={2.6} aria-hidden="true" className="shrink-0 text-done" />
            <div className="min-w-0">
              <div className="text-[15px] text-ink-muted">{`Modul ${String(last.number)}`}</div>
              <div className="font-condensed text-[20px] font-semibold tracking-[1.2px] [overflow-wrap:anywhere]">
                {last.serial}
              </div>
            </div>
          </div>
        ) : null}
        <Button tone="primary" wide height={52} icon={Check} onClick={onClose}>
          Fertig
        </Button>
        {done ? null : (
          <Button wide height={48} icon={Pencil} onClick={onHand}>
            Von Hand eingeben
          </Button>
        )}
      </div>
    </div>
  )
}

/** Typing the number, `baustelle_von_hand()`: the field, and the way back to the camera. */
function ByHand({
  heading,
  sub,
  number,
  notice,
  onTake,
  onCamera,
  onDone,
}: {
  readonly heading: string
  readonly sub: string
  readonly number: number | null
  readonly notice: string | null
  readonly onTake: (serial: string) => Promise<boolean>
  readonly onCamera: () => void
  readonly onDone: () => void
}) {
  const [input, setInput] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()

    if (working) {
      return
    }

    const found = serialNumberProblem(input)
    setProblem(found)

    if (found !== null) {
      return
    }

    setWorking(true)

    try {
      if (await onTake(input.trim())) {
        setInput('')
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <SiteScreen>
      <SiteHeader title={heading} sub={sub} />
      {number === null ? (
        <SiteText>Jedes Modul dieses Strings hat eine Seriennummer.</SiteText>
      ) : (
        <form
          id="seriennummer-von-hand"
          className="flex flex-col gap-3.5"
          onSubmit={(event) => {
            void submit(event)
          }}
        >
          <SiteText muted size={16}>
            Kein Etikett zu lesen? Dann die Nummer abtippen, wie sie auf dem Modul steht.
          </SiteText>
          <Field
            label={`Seriennummer von Modul ${String(number)}`}
            hint="Groß und klein wie auf dem Etikett, ohne Leerzeichen am Rand."
            value={input}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(event) => {
              setInput(event.target.value)
            }}
            {...(problem ? { problem } : notice ? { problem: notice } : {})}
          />
        </form>
      )}
      <SiteActionBar stacked>
        {number === null ? (
          <Button tone="primary" wide height={60} icon={Check} onClick={onDone}>
            Fertig
          </Button>
        ) : (
          <Button
            type="submit"
            form="seriennummer-von-hand"
            tone="primary"
            wide
            height={60}
            icon={Check}
            disabled={working}
          >
            Übernehmen und weiter
          </Button>
        )}
        <Button wide height={48} icon={Camera} onClick={onCamera}>
          Zurück zur Kamera
        </Button>
      </SiteActionBar>
    </SiteScreen>
  )
}
