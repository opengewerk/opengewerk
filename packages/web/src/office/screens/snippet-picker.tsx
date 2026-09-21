import type { SnippetPurpose } from '@opengewerk/domain'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { SelectField } from '../../components/index.js'
import { snippetPurposeLabel } from '../../app/labels.js'
import { textSnippets } from '../../session/documents.js'
import type { TextSnippet } from '../../session/documents.js'

/**
 * A list of snippets to take a text from. A choice list that acts rather than
 * holds a value: picking one hands it over and the list goes back to its
 * prompt, so the same snippet can be picked twice.
 */
export function SnippetPicker({
  purpose,
  label,
  onPick,
}: {
  readonly purpose: SnippetPurpose
  readonly label: string
  readonly onPick: (snippet: TextSnippet) => void
}) {
  const snippets = useQuery({ queryKey: ['text-snippets'], queryFn: textSnippets })
  const fitting = (snippets.data ?? []).filter((snippet) => snippet.purpose === purpose)

  if (snippets.isError) {
    return <p className="text-table text-ink-muted">Textbausteine gibt es nur mit Verbindung.</p>
  }

  if (fitting.length === 0) {
    return (
      <p className="text-table text-ink-muted">
        Noch kein Textbaustein für {snippetPurposeLabel[purpose]}. Angelegt werden sie unter{' '}
        <Link to="/textbausteine" className="text-copper-text underline underline-offset-2">
          Textbausteine
        </Link>
        .
      </p>
    )
  }

  return (
    <SelectField
      label={label}
      value=""
      options={[
        { value: '', label: 'Textbaustein wählen' },
        ...fitting.map((snippet) => ({ value: snippet.id, label: snippet.title })),
      ]}
      onChange={(id) => {
        const picked = fitting.find((snippet) => snippet.id === id)

        if (picked) {
          onPick(picked)
        }
      }}
    />
  )
}

/** A text taken from a snippet: into an empty box as it is, below what is there otherwise. */
export function withSnippet(current: string, snippet: TextSnippet): string {
  return current.trim() === '' ? snippet.text : `${current.trimEnd()}\n\n${snippet.text}`
}
