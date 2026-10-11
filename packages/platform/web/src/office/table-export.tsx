import { ChevronDown, Download } from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

import { useBand } from '../components/band.js'
import { Button } from '../components/button.js'
import { requestFile, RequestRefused } from '../sync/transport.js'
import { NoteBox } from './kit.js'

/**
 * "Als Tabelle" in the head of a list of the office
 * (opengewerk-haustechnik#138): what the list shows under its filter, in its
 * order and under its columns, as a workbook or as text to open in a
 * spreadsheet.
 *
 * The table is made by the server and not from the rows on the page, so that
 * it holds a list that is read a page at a time whole, and the server reads
 * it under the rights and in the areas of the person, as it reads the list.
 * The route is the list's (`tableAnswer` on the server): it gets what the
 * list is narrowed by in its address and the format beside it.
 *
 * Offered where the list is a table, from a tablet on. On a phone a list is a
 * card per row, and a file of columns is nothing that list shows.
 */

/** The formats in the order the menu offers them, with what it calls them. */
const formats = [
  { format: 'xlsx', label: 'Excel (.xlsx)' },
  { format: 'csv', label: 'CSV (.csv)' },
] as const

type Format = (typeof formats)[number]['format']

const accepts: Readonly<Record<Format, string>> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
}

/** What the button and the page say. */
export const tableExportWords = {
  button: 'Als Tabelle',
  menu: 'Als Tabelle ausgeben',
  offline: 'Ohne Verbindung zum Server gibt es keine Tabelle.',
} as const

/** The address with the format beside what it already asks. */
function withFormat(address: string, format: Format): string {
  return `${address}${address.includes('?') ? '&' : '?'}format=${format}`
}

/** Hands the file to the browser to save, under the name the server gave it. */
function save(content: Blob, name: string): void {
  const address = URL.createObjectURL(content)
  const link = document.createElement('a')

  link.href = address
  link.download = name
  link.click()
  // The browser has taken the file once the click is through.
  setTimeout(() => {
    URL.revokeObjectURL(address)
  }, 0)
}

/**
 * The button with its menu, for the actions of the head of a list, and what
 * the page says below the head when the table did not come. No button on a
 * phone.
 *
 * @param address where the list is read as a table, with what it is narrowed
 * by: `/assets/table?kind=fire_extinguisher`. The format is added.
 */
export function useTableExport(address: string): {
  readonly button: ReactNode
  readonly trouble: ReactNode
} {
  const band = useBand()
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) {
      return
    }

    // The first choice takes the focus, so that the arrows and Enter work at once.
    frame.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()

    const onPointer = (event: PointerEvent) => {
      if (frame.current && !frame.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        opener.current?.focus()
      }
    }

    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const take = (format: Format) => {
    setOpen(false)
    setWorking(true)
    setTrouble(null)
    requestFile(withFormat(address, format), accepts[format])
      .then((file) => {
        save(file.content, file.name ?? `Tabelle.${format}`)
      })
      .catch((error: unknown) => {
        setTrouble(error instanceof RequestRefused ? error.message : tableExportWords.offline)
      })
      .finally(() => {
        setWorking(false)
        opener.current?.focus()
      })
  }

  /** Up and down between the two choices, round. */
  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return
    }

    event.preventDefault()

    const items = [
      ...(frame.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    ]
    const at = items.findIndex((item) => item === document.activeElement)
    const step = event.key === 'ArrowDown' ? 1 : -1

    items[(at + step + items.length) % items.length]?.focus()
  }

  if (band === 'S') {
    return { button: null, trouble: null }
  }

  return {
    button: (
      <div ref={frame} className="relative">
        <Button
          ref={opener}
          icon={Download}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          disabled={working}
          onClick={() => {
            setOpen((was) => !was)
          }}
        >
          {tableExportWords.button}
          <ChevronDown size={13} strokeWidth={2.2} aria-hidden="true" className="ml-1.5" />
        </Button>
        {open ? (
          <div
            id={menuId}
            role="menu"
            aria-label={tableExportWords.menu}
            onKeyDown={onMenuKey}
            className="absolute right-0 top-full z-40 mt-1 flex w-[200px] flex-col gap-0.5 rounded-[6px] border border-line bg-surface p-1.5 text-ink shadow-[0_8px_24px_rgb(20_26_35/0.18)]"
          >
            {formats.map(({ format, label }) => (
              <button
                key={format}
                type="button"
                role="menuitem"
                onClick={() => {
                  take(format)
                }}
                className="flex min-h-9 w-full items-center rounded-control border-0 bg-transparent px-2.5 text-left text-[14px] text-ink cursor-pointer hover:bg-surface-sunken focus-visible:bg-surface-sunken"
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    ),
    trouble: trouble === null ? null : <NoteBox tone="conflict">{trouble}</NoteBox>,
  }
}
