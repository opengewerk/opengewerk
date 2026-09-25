import {
  type LetterheadField,
  largestLogoBytes,
  letterheadFieldLabels,
  logoMediaTypes,
} from '@opengewerk/domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button, Field } from '../../components/index.js'
import { useMay } from '../../app/queries.js'
import {
  type LetterheadView,
  letterhead,
  logoAddress,
  removeLogo,
  saveLetterhead,
  uploadLogo,
} from '../../session/letterhead.js'
import { RequestRefused } from '../../sync/transport.js'
import { Nothing, Page, Section } from '../layout.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/**
 * The fields of one group on the screen. Their labels come from
 * `letterheadFieldLabels`, which the route uses as well when it refuses one.
 */
interface Group {
  readonly title: string
  readonly fields: readonly {
    readonly field: LetterheadField
    readonly hint?: string
    readonly type?: string
    readonly autoComplete?: string
  }[]
}

/**
 * The groups, in the order a letterhead is read: who, where, how to reach,
 * the tax numbers, the bank, and what the commercial register adds.
 */
const groups: readonly Group[] = [
  {
    title: 'Betrieb',
    fields: [
      {
        field: 'companyName',
        hint: 'Vollständig, bei einem Einzelunternehmen mit Vor- und Nachnamen.',
        autoComplete: 'organization',
      },
      { field: 'street', autoComplete: 'address-line1' },
      { field: 'houseNumber' },
      { field: 'postalCode', autoComplete: 'postal-code' },
      { field: 'city', autoComplete: 'address-level2' },
      { field: 'country', hint: 'Als Kürzel, etwa DE oder AT.' },
    ],
  },
  {
    title: 'Kontakt',
    fields: [
      { field: 'phone', type: 'tel', autoComplete: 'tel' },
      { field: 'email', type: 'email', autoComplete: 'email' },
      { field: 'website', autoComplete: 'url' },
    ],
  },
  {
    title: 'Steuer',
    fields: [{ field: 'taxNumber' }, { field: 'vatId', hint: 'Etwa DE123456789.' }],
  },
  {
    title: 'Bankverbindung',
    fields: [
      { field: 'bankName' },
      {
        field: 'iban',
        hint: 'Wird beim Speichern gegen ihre Prüfziffern gehalten.',
      },
      { field: 'bic' },
    ],
  },
  {
    title: 'Handelsregister und Vertretung',
    fields: [
      { field: 'registerCourt', hint: 'Etwa Amtsgericht Hamburg.' },
      { field: 'registerNumber', hint: 'Etwa HRB 12345.' },
      {
        field: 'managingDirectors',
        hint: 'So, wie es auf den Briefen stehen soll, etwa „Geschäftsführer: Max Mustermann“.',
      },
    ],
  },
]

/**
 * What the business prints on every document: the name and address at the
 * top, and at the bottom how to reach it, its tax numbers and its bank.
 *
 * Only the owner changes it, because the tax number and the bank account on
 * every invoice come from here. The office reads it, since it writes the
 * documents it ends up on, and sees the same form with nothing to press.
 *
 * The form is its own component and only appears once the letterhead has
 * arrived, which is how it starts from the stored values without an effect
 * copying them over: the fields are initialised once, when the form mounts,
 * and a saved letterhead mounts a fresh form through its key. That fresh form
 * shows what the server made of the input, trimmed and with the country in
 * capitals. The note that it was saved lives up here for the same reason: in
 * the form it would be gone with the form it was set in.
 */
export function LetterheadScreen() {
  const loaded = useQuery({ queryKey: ['letterhead'], queryFn: letterhead })
  const mayWrite = useMay('settings.write')
  const [saved, setSaved] = useState(false)

  return (
    <Page title="Briefkopf" meta="Was auf jedem Beleg steht, oben und in der Fußzeile.">
      <p className="text-body text-ink-muted">
        Für eine Rechnung braucht es mindestens den Namen und die Anschrift des Betriebs und die
        Steuernummer oder die USt-IdNr. Fehlt davon etwas, sagt OpenGewerk es beim Festschreiben.
        Ein festgeschriebener Beleg behält den Briefkopf, mit dem er festgeschrieben wurde.
      </p>

      {loaded.isPending ? (
        <Nothing>Wird geladen.</Nothing>
      ) : loaded.isError ? (
        <Nothing>{saidWhy(loaded.error, 'Der Briefkopf kam nicht an.')}</Nothing>
      ) : (
        <>
          {mayWrite ? null : (
            <p className="text-body font-semibold">Ändern kann den Briefkopf nur der Inhaber.</p>
          )}
          <LogoSection view={loaded.data} mayWrite={mayWrite} />
          <LetterheadForm
            key={JSON.stringify(loaded.data)}
            view={loaded.data}
            mayWrite={mayWrite}
            saved={saved}
            onSaved={setSaved}
          />
        </>
      )}
    </Page>
  )
}

function LetterheadForm({
  view,
  mayWrite,
  saved,
  onSaved,
}: {
  readonly view: LetterheadView
  readonly mayWrite: boolean
  readonly saved: boolean
  readonly onSaved: (saved: boolean) => void
}) {
  const queries = useQueryClient()
  const [values, setValues] = useState<Record<LetterheadField, string>>(() => {
    const initial = {} as Record<LetterheadField, string>

    for (const group of groups) {
      for (const { field } of group.fields) {
        initial[field] = view[field] ?? ''
      }
    }

    return initial
  })
  const [trouble, setTrouble] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => saveLetterhead(values),
    onSuccess: (stored) => {
      setTrouble(null)
      onSaved(true)
      queries.setQueryData(['letterhead'], stored)
    },
    onError: (error) => {
      onSaved(false)
      setTrouble(saidWhy(error, 'Der Briefkopf ließ sich nicht speichern.'))
    },
  })

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      {groups.map((group) => (
        <Section key={group.title} title={group.title}>
          <div className="grid gap-4 sm:grid-cols-2">
            {group.fields.map(({ field, hint, type, autoComplete }) => (
              <Field
                key={field}
                label={letterheadFieldLabels[field]}
                name={field}
                type={type ?? 'text'}
                autoComplete={autoComplete ?? 'off'}
                readOnly={!mayWrite}
                value={values[field]}
                placeholder={field === 'companyName' ? view.setUpAs : undefined}
                hint={hint}
                onChange={(event) => {
                  onSaved(false)
                  setValues({ ...values, [field]: event.target.value })
                }}
              />
            ))}
          </div>
        </Section>
      ))}

      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      {mayWrite ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" tone="primary" disabled={save.isPending}>
            {save.isPending ? 'Einen Moment' : 'Briefkopf speichern'}
          </Button>
          {saved ? (
            <p role="status" className="text-body text-ink-muted">
              Gespeichert.
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  )
}

/**
 * The logo, shown as it is stored, with a way to replace it and to take it
 * off. The image comes from the server route rather than from the file just
 * picked, so what is shown is what will be printed.
 */
function LogoSection({
  view,
  mayWrite,
}: {
  readonly view: LetterheadView
  readonly mayWrite: boolean
}) {
  const queries = useQueryClient()
  const [trouble, setTrouble] = useState<string | null>(null)

  const done = {
    onSuccess: (saved: LetterheadView) => {
      setTrouble(null)
      queries.setQueryData(['letterhead'], saved)
    },
    onError: (error: unknown) => {
      setTrouble(saidWhy(error, 'Das Logo ließ sich nicht ändern.'))
    },
  }

  const upload = useMutation({ mutationFn: uploadLogo, ...done })
  const remove = useMutation({ mutationFn: removeLogo, ...done })

  return (
    <Section
      title="Logo"
      actions={
        mayWrite && view.logo ? (
          <Button tone="secondary" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Logo entfernen
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-3">
        {view.logo ? (
          <img
            // The size in the address makes a new logo a new address, so the
            // browser does not show the old one from its cache.
            src={`${logoAddress}?size=${String(view.logo.sizeBytes)}`}
            alt="Das Logo auf den Belegen"
            className="max-h-24 max-w-64 object-contain self-start"
          />
        ) : (
          <Nothing>Noch kein Logo. Die Belege tragen dann oben nur den Namen.</Nothing>
        )}

        {mayWrite ? (
          <label className="flex flex-col gap-1 text-body">
            <span className="font-medium">{view.logo ? 'Anderes Logo wählen' : 'Logo wählen'}</span>
            <input
              type="file"
              accept={logoMediaTypes.join(',')}
              disabled={upload.isPending}
              onChange={(event) => {
                const file = event.target.files?.[0]

                if (!file) {
                  return
                }

                if (file.size > largestLogoBytes) {
                  setTrouble(
                    'Das Logo ist größer als 1 MB. Für den Briefkopf reicht deutlich weniger.',
                  )
                  return
                }

                upload.mutate(file)
              }}
            />
            <span className="text-table text-ink-muted">PNG oder JPEG, höchstens 1 MB.</span>
          </label>
        ) : null}

        {trouble ? (
          <p role="alert" className="text-body font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
      </div>
    </Section>
  )
}
