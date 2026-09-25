import {
  type LetterheadField,
  largestLogoBytes,
  letterheadFieldLabels,
  logoMediaTypes,
} from '@opengewerk/domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Upload } from 'lucide-react'
import { useRef, useState } from 'react'

import { Button, Confirm, Field, Panel, SelectField } from '../../components/index.js'
import { countryOptions } from '../../app/format.js'
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
import { SettingsPage, SettingsText } from '../settings-frame.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

/**
 * The fields of one group on the screen. Their labels come from
 * `letterheadFieldLabels`, which the route uses as well when it refuses one.
 */
interface Group {
  readonly title: string
  /** The rows of the group, each a list of fields beside each other, with its columns. */
  readonly rows?: readonly {
    readonly fields: readonly LetterheadField[]
    readonly columns: string
  }[]
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
    // As the board sets them: the name half across, the street three times
    // the house number, the town twice the postcode.
    rows: [
      { fields: ['companyName'], columns: 'sm:grid-cols-2' },
      { fields: ['street', 'houseNumber'], columns: 'sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]' },
      {
        fields: ['postalCode', 'city', 'country'],
        columns: 'sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1.2fr)]',
      },
    ],
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
      { field: 'country' },
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
    <SettingsPage
      active="briefkopf"
      title="Briefkopf"
      sub="Was auf jedem Beleg steht, oben und in der Fußzeile."
    >
      <SettingsText muted>
        Für eine Rechnung braucht es mindestens den Namen und die Anschrift des Betriebs und die
        Steuernummer oder die USt-IdNr. Fehlt davon etwas, sagt OpenGewerk es beim Festschreiben.
        Ein festgeschriebener Beleg behält den Briefkopf, mit dem er festgeschrieben wurde.
      </SettingsText>

      {loaded.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : loaded.isError ? (
        <SettingsText muted>{saidWhy(loaded.error, 'Der Briefkopf kam nicht an.')}</SettingsText>
      ) : (
        <>
          {mayWrite ? null : (
            <p className="text-[14px] font-semibold">Ändern kann den Briefkopf nur der Inhaber.</p>
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
    </SettingsPage>
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

  function input({ field, hint, type, autoComplete }: Group['fields'][number]) {
    return field === 'country' ? (
      // The same list as at a customer and a site, by name and not as a code
      // to type (#223). A stored code the list does not know stays choosable,
      // so a save does not change it.
      <SelectField
        key={field}
        label={letterheadFieldLabels[field]}
        value={values[field] || 'DE'}
        options={
          countryOptions.some((option) => option.value === (values[field] || 'DE'))
            ? countryOptions
            : [...countryOptions, { value: values[field], label: values[field] }]
        }
        disabled={!mayWrite}
        onChange={(value) => {
          onSaved(false)
          setValues({ ...values, [field]: value })
        }}
      />
    ) : (
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
    )
  }

  function card(group: Group) {
    const byName = new Map(group.fields.map((entry) => [entry.field, entry]))

    return (
      <Panel key={group.title} title={group.title} roomy>
        <div className="flex flex-col gap-2.5">
          {group.rows
            ? group.rows.map((row) => (
                <div key={row.fields.join()} className={`grid gap-3 ${row.columns}`}>
                  {row.fields.map((field) => {
                    const entry = byName.get(field)

                    return entry ? input(entry) : null
                  })}
                </div>
              ))
            : group.fields.map((entry) => input(entry))}
        </div>
      </Panel>
    )
  }

  const [business, contact, tax, bank, register] = groups

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      {business ? card(business) : null}
      {/* In pairs from 1024 pixels on, as the board sets them side by side. */}
      <div className="grid gap-3 lg:grid-cols-2">
        {contact ? card(contact) : null}
        {tax ? card(tax) : null}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {bank ? card(bank) : null}
        {register ? card(register) : null}
      </div>

      {trouble ? (
        <p role="alert" className="text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}

      {mayWrite ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" tone="primary" icon={Check} disabled={save.isPending}>
            {save.isPending ? 'Einen Moment' : 'Briefkopf speichern'}
          </Button>
          {saved ? (
            <p role="status" className="inline-flex items-center gap-[5px] text-[13px] text-done">
              <Check size={14} strokeWidth={2.4} aria-hidden="true" />
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
  const remove = useMutation({
    mutationFn: removeLogo,
    onSuccess: (saved: LetterheadView) => {
      setAsking(false)
      done.onSuccess(saved)
    },
    onError: (error: unknown) => {
      setAsking(false)
      done.onError(error)
    },
  })
  const [asking, setAsking] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  return (
    <Panel title="Logo" roomy>
      <Confirm
        open={asking}
        title="Logo entfernen?"
        confirm="Entfernen"
        busy={remove.isPending}
        onConfirm={() => {
          remove.mutate()
        }}
        onCancel={() => {
          setAsking(false)
        }}
      >
        Neue Belege tragen oben dann nur den Namen. Was schon festgeschrieben ist, behält sein Logo.
      </Confirm>
      <div className="flex flex-wrap items-center gap-[18px]">
        {/* On paper white in both grounds: that is what it is printed on. */}
        <div className="flex h-24 w-64 max-w-full shrink-0 items-center justify-center rounded-control border border-line bg-paper p-2">
          {view.logo ? (
            <img
              // The size in the address makes a new logo a new address, so the
              // browser does not show the old one from its cache.
              src={`${logoAddress}?size=${String(view.logo.sizeBytes)}`}
              alt="Das Logo auf den Belegen"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <p className="px-3 text-center text-[13px] leading-[1.4] text-ink-muted">
              Noch kein Logo. Die Belege tragen dann oben nur den Namen.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {mayWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button
                icon={Upload}
                disabled={upload.isPending}
                onClick={() => {
                  picker.current?.click()
                }}
              >
                {view.logo ? 'Anderes Logo wählen' : 'Logo wählen'}
              </Button>
              {view.logo ? (
                <Button
                  disabled={remove.isPending}
                  onClick={() => {
                    setAsking(true)
                  }}
                >
                  Logo entfernen
                </Button>
              ) : null}
              {/* The picker of the browser, opened by the button beside it. */}
              <input
                ref={picker}
                type="file"
                tabIndex={-1}
                aria-hidden="true"
                className="sr-only"
                accept={logoMediaTypes.join(',')}
                onChange={(event) => {
                  const file = event.target.files?.[0]

                  event.target.value = ''

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
            </div>
          ) : null}
          <p className="text-[13px] text-ink-muted">PNG oder JPEG, höchstens 1 MB.</p>
        </div>
      </div>

      {trouble ? (
        <p role="alert" className="mt-3 text-body font-semibold text-conflict">
          {trouble}
        </p>
      ) : null}
    </Panel>
  )
}
