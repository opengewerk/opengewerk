import clsx from 'clsx'
import { Camera, ImageIcon } from 'lucide-react'
import { useRef } from 'react'
import type { ReactNode } from 'react'

import { Button } from '../components/button.js'

export interface PhotoTakerProps {
  /**
   * What the photo is of, which the file input of the camera is called; the
   * one of the gallery says so after it.
   */
  readonly label: string
  /**
   * The photos as the application shows them, once there are any: small
   * pictures out of its own files. Without them the buttons take the whole width.
   */
  readonly photo?: ReactNode
  /**
   * Called with each file taken or chosen, one after the other in the order
   * they were chosen; keeping them is the application's.
   */
  readonly onTake: (file: File) => void
  /**
   * Whether a point holds several photos: then a further one is added and
   * none replaced, the gallery lets several be chosen at once, and the photos
   * stand over the buttons. Without it one photo replaces the one before.
   */
  readonly multiple?: boolean
  readonly disabled?: boolean
}

/** The name of the file input of the gallery, beside the one of the camera. */
export function fromTheGallery(label: string): string {
  return `${label}, aus der Galerie`
}

/**
 * A photo for a point: straight from the camera of the device, or chosen from
 * its gallery, a photo taken before (opengewerk-haustechnik, 19.10.2026: in a
 * round only the camera opened and no photo from the gallery could be added).
 * Two buttons, because `capture` opens the camera at once and leaves no way
 * to the gallery, while an input without it asks first every time; where a
 * device has no camera both open its files. Where the file goes and how it is
 * shown is the application's, which keeps its documents its own way.
 */
export function PhotoTaker({
  label,
  photo,
  onTake,
  multiple = false,
  disabled = false,
}: PhotoTakerProps) {
  const camera = useRef<HTMLInputElement>(null)
  const gallery = useRef<HTMLInputElement>(null)
  const there = photo !== undefined && photo !== null

  function took(input: HTMLInputElement) {
    const files = [...(input.files ?? [])]

    input.value = ''

    for (const file of multiple ? files : files.slice(0, 1)) {
      onTake(file)
    }
  }

  const again = multiple ? 'Weiteres Foto' : 'Anderes Foto'

  return (
    <div
      className={clsx('flex min-w-0 gap-2.5', multiple ? 'flex-col items-stretch' : 'items-center')}
    >
      {there ? photo : null}
      {/* Side by side where they fit, one under the other where they do not,
          as beside a photo on a phone. */}
      <div className="flex min-w-0 grow flex-wrap gap-2">
        <div className="min-w-0 grow basis-40">
          <Button
            icon={Camera}
            height={52}
            wide
            disabled={disabled}
            onClick={() => {
              camera.current?.click()
            }}
          >
            {there ? again : 'Foto aufnehmen'}
          </Button>
        </div>
        <div className="min-w-0 grow basis-40">
          <Button
            icon={ImageIcon}
            height={52}
            wide
            disabled={disabled}
            onClick={() => {
              gallery.current?.click()
            }}
          >
            Aus der Galerie
          </Button>
        </div>
      </div>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        aria-label={label}
        onChange={(event) => {
          took(event.target)
        }}
      />
      <input
        ref={gallery}
        type="file"
        accept="image/*"
        multiple={multiple}
        hidden
        aria-label={fromTheGallery(label)}
        onChange={(event) => {
          took(event.target)
        }}
      />
    </div>
  )
}
