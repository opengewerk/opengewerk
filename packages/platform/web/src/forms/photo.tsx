import clsx from 'clsx'
import { Camera } from 'lucide-react'
import { useRef } from 'react'
import type { ReactNode } from 'react'

import { Button } from '../components/button.js'

export interface PhotoTakerProps {
  /** What the photo is of, which the file input is called. */
  readonly label: string
  /**
   * The photo as the application shows it, once there is one: a small
   * picture out of its own files. Without it the button is the whole width.
   */
  readonly photo?: ReactNode
  /** Called with the file taken or chosen; keeping it is the application's. */
  readonly onTake: (file: File) => void
  readonly disabled?: boolean
}

/**
 * A photo for a point: the camera of the device where it has one, the files
 * where it has not. One photo to a point; taking another replaces it, and
 * the button says so. Where the file goes and how it is shown is the
 * application's, which keeps its documents its own way.
 */
export function PhotoTaker({ label, photo, onTake, disabled = false }: PhotoTakerProps) {
  const picker = useRef<HTMLInputElement>(null)
  const there = photo !== undefined && photo !== null

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {there ? photo : null}
      <div className={clsx('min-w-0', 'grow')}>
        <Button
          icon={Camera}
          height={52}
          wide
          disabled={disabled}
          onClick={() => {
            picker.current?.click()
          }}
        >
          {there ? 'Anderes Foto' : 'Foto aufnehmen'}
        </Button>
      </div>
      <input
        ref={picker}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        aria-label={label}
        onChange={(event) => {
          const file = event.target.files?.[0]

          event.target.value = ''

          if (file !== undefined) {
            onTake(file)
          }
        }}
      />
    </div>
  )
}
