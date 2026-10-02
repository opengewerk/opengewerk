import { serialFromCode, serialNumberProblem } from '@opengewerk/domain'
import { Button, Field } from '@opengewerk/platform-web'
import { SiteActionBar, SiteScreen, SiteText, useCodeReading } from '@opengewerk/platform-web/site'
import {
  maybeText,
  refusalFor,
  text,
  useRecord,
  useRecords,
  useSync,
} from '@opengewerk/platform-web/sync'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Camera, Check, Pencil, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'

import { inModules, usePvModules } from '../../app/photovoltaic.js'
import { SiteHeader } from '../header.js'
import { useStructureBase } from '../structure-base.js'

/**
 * Serial numbers from the labels of a string's modules (#300), as the boards
 * "Seriennummern scannen" and "Seriennummer von Hand" draw it: the camera with
 * a frame for the label, which module is next and which was last, and typing
 * the number where no label can be read.
 *
 * Every number goes to the next module of the string that has none, in the
 * order of the string, and through the outbox like anything else on site: a
 * roof has no network more often than not. A number that another module on
 * this device already has is refused with the module's name, since the same
 * label read twice is the likelier story than two modules with one number.
 *
 * That check sees what this device holds and nothing more (pr-review on
 * #451): two devices without a network do not see each other, and the server
 * does not hold a serial number to be unique, because one is unique only for
 * its manufacturer, and a key that refused a second maker's number would
 * refuse a true one.
 */

/** A number the camera keeps seeing after it was taken is the same label, not a new one. */
const sameLabelFor = 3_000

type Taken = { readonly number: number; readonly serial: string }

export function SiteScannerScreen() {
  const { inverterId, stringId } = useParams({ strict: false }) as {
    inverterId?: string
    stringId?: string
  }
  const base = useStructureBase()
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

  const back = `${base ?? ''}/wechselrichter/${inverterId ?? ''}/strings/${stringId ?? ''}`
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

  if (!pvString || !stringId || !base || !inverterId) {
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
  // No camera once every module has its number: nothing left to read.
  const { video, trouble } = useCodeReading(!done, onCode, {
    noReader: 'Dieses Gerät liest keine Strichcodes. Die Nummern lassen sich von Hand eingeben.',
    noCamera:
      'Die Kamera lässt sich nicht öffnen, sie ist nicht freigegeben oder nicht da. Die Nummern lassen sich von Hand eingeben.',
  })

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
