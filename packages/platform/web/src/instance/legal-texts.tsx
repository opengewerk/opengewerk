import {
  type InstanceLegalTextsView,
  type LegalTextKind,
  legalTextProblem,
} from '@opengewerk/platform-domain'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Eye } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { useInstanceSentences } from '../application.js'
import { Button } from '../components/button.js'
import { TextArea } from '../components/field.js'
import { Markdown } from '../components/markdown.js'
import { Panel } from '../components/panel.js'
import { date } from '../format.js'
import { Saved, SettingsText } from '../office/settings.js'
import { instanceLegalTexts, saveInstanceLegalTexts } from '../session/instance.js'
import { legalTextsQuery } from '../session/queries.js'
import { RequestRefused } from '../sync/transport.js'
import { InstancePage } from './frame.js'

function saidWhy(error: unknown, fallback: string): string {
  return error instanceof RequestRefused ? error.message : fallback
}

const titles = { imprint: 'Impressum', privacy: 'Datenschutzhinweise' } as const

/**
 * The legal texts of the instance (opengewerk-haustechnik#129), the board
 * "Rechtstexte der Instanz" of the page "Bereich der Instanz": its legal
 * notice and its notice on data protection, kept here by whoever runs it and
 * read by anybody on the page the foot of the sign in leads to. They are in no
 * source code, and they hold for every tenant on the instance alike.
 *
 * Each text is saved on its own. What is typed is a short part of Markdown,
 * read into elements and never into HTML; "Vorschau" shows it the way the
 * page will. While no legal notice is kept the screen says so, for a link in
 * the foot that is missing is easily missed.
 */
export function InstanceLegalTextsScreen() {
  const texts = useQuery({ queryKey: ['instance-legal-texts'], queryFn: instanceLegalTexts })

  return (
    <InstancePage
      title="Rechtstexte"
      sub="Impressum und Datenschutzhinweise der Instanz. Sie stehen nicht im Quelltext."
    >
      {texts.isPending ? (
        <SettingsText muted>Wird geladen.</SettingsText>
      ) : texts.isError ? (
        <SettingsText muted>{saidWhy(texts.error, 'Die Rechtstexte kamen nicht an.')}</SettingsText>
      ) : (
        <>
          <LegalText kind="imprint" texts={texts.data} rows={7} />
          <LegalText kind="privacy" texts={texts.data} rows={6} />
        </>
      )}
    </InstancePage>
  )
}

/** When and by whom a text was last changed, as far as the log of the instance knows. */
function changedLine(view: InstanceLegalTextsView[LegalTextKind]): string | null {
  if (view.changedAt === null) {
    return null
  }

  return view.changedBy === null
    ? `Zuletzt geändert am ${date(view.changedAt)}.`
    : `Zuletzt geändert am ${date(view.changedAt)} von ${view.changedBy}.`
}

function LegalText({
  kind,
  texts,
  rows,
}: {
  readonly kind: LegalTextKind
  readonly texts: InstanceLegalTextsView
  readonly rows: number
}) {
  const sentences = useInstanceSentences().legal
  const queries = useQueryClient()
  const view = texts[kind]
  const [text, setText] = useState(view.text ?? '')
  const [preview, setPreview] = useState(false)
  const [saved, setSaved] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const problem = legalTextProblem(text.trim()) ?? undefined
  const changed = text.trim() !== (view.text ?? '')
  const save = useMutation({
    mutationFn: saveInstanceLegalTexts,
    onSuccess: (answer) => {
      queries.setQueryData(['instance-legal-texts'], answer)
      // The foot of the sign in in this browser reads the texts anew.
      void queries.invalidateQueries({ queryKey: legalTextsQuery.queryKey })
    },
  })
  const changedAt = changedLine(view)

  function submit(event: FormEvent) {
    event.preventDefault()
    setSaved(false)
    setTrouble(null)

    if (problem) {
      return
    }

    save.mutate(kind === 'imprint' ? { imprint: text } : { privacy: text }, {
      onSuccess: (answer) => {
        setText(answer[kind].text ?? '')
        setSaved(true)
      },
      onError: (error) => {
        setTrouble(saidWhy(error, `${titles[kind]} ließ sich nicht speichern.`))
      },
    })
  }

  const line =
    kind === 'imprint'
      ? (changedAt ??
        'Noch ist kein Impressum hinterlegt, und im Fuß der Anmeldung fehlt der Link dazu.')
      : [changedAt, 'Ein leerer Text blendet den Link im Fuß aus.'].filter(Boolean).join(' ')

  return (
    <Panel title={titles[kind]} roomy>
      <form noValidate onSubmit={submit} className="flex flex-col gap-2.5">
        {kind === 'imprint' ? (
          <SettingsText muted>
            {`Steht im Fuß der Anmeldung und ist ohne Anmeldung zu lesen. ${sentences.forAll}`}
          </SettingsText>
        ) : null}
        <TextArea
          label={titles[kind]}
          rows={rows}
          value={text}
          {...(problem ? { problem } : {})}
          onChange={(event) => {
            setSaved(false)
            setText(event.target.value)
          }}
        />
        {preview ? (
          <section
            aria-label={`Vorschau: ${titles[kind]}`}
            className="rounded-[5px] border border-line bg-surface-sunken px-4 py-3"
          >
            {text.trim() === '' ? (
              <SettingsText muted>Ohne Text steht im Fuß kein Link.</SettingsText>
            ) : (
              <Markdown source={text} reading breaks level={2} />
            )}
          </section>
        ) : null}
        {trouble ? (
          <p role="alert" className="text-[13px] font-semibold text-conflict">
            {trouble}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {saved ? (
            <Saved />
          ) : (
            <SettingsText small muted={kind === 'privacy' || changedAt !== null}>
              {line}
            </SettingsText>
          )}
          {/* At the right, also where the line beside them takes a row of
              its own, as on a phone. */}
          <div className="ml-auto flex gap-2">
            <Button
              icon={Eye}
              aria-pressed={preview}
              onClick={() => {
                setPreview(!preview)
              }}
            >
              Vorschau
            </Button>
            <Button
              tone="primary"
              type="submit"
              icon={Check}
              disabled={!changed || problem !== undefined || save.isPending}
            >
              Speichern
            </Button>
          </div>
        </div>
      </form>
    </Panel>
  )
}
