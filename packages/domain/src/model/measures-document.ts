import {
  instanceMeasureSections,
  type InstanceMeasures,
  plainInMarkdown,
  type Subprocessor,
} from '@opengewerk/platform-domain'

/**
 * The technical and organisational measures of a business (#319, as the
 * Haustechnik makes them with opengewerk-haustechnik#358): annex 1 of the
 * contract on processing on behalf, with annex 2. Part A, what the
 * application brings, is the template `packages/server/templates/measures.md`,
 * the same on every instance of a version, and the page of the contract on
 * opengewerk.de shows it from there: one source. Part B and the
 * subprocessors are what whoever runs the instance wrote in its area, which a
 * business changes nothing of. Made fresh whenever it is downloaded (Moritz,
 * 05.11.2026).
 */

/** The places of the template the application fills, each standing once. */
export const measuresPlaces = ['for', 'made', 'part-b-changed', 'part-b', 'subprocessors'] as const

/** For whom and when the measures are made, with part B as the instance keeps it. */
export interface MeasuresMade {
  readonly business: string
  /** "am 05.11.2026 um 10:40" */
  readonly at: string
  readonly measures: InstanceMeasures
  readonly subprocessors: readonly Subprocessor[]
  /** When whoever runs the instance last changed part B or annex 2, "am 02.11.2026", or null while never. */
  readonly changedAt: string | null
}

export class MeasuresTemplateError extends Error {}

function partB(made: MeasuresMade): string {
  if (made.changedAt === null) {
    return 'Wer die Instanz betreibt, hat Teil B noch nicht ausgefüllt. Er trägt ihn im Bereich der Instanz unter „Maßnahmen“ ein; das nächste Dokument nennt ihn dann.'
  }

  return instanceMeasureSections
    .map((section) => {
      const lines = section.fields.map((field) => {
        const value = made.measures[field.key]

        if (field.kind === 'check') {
          return `- ${value === true ? 'Ja' : 'Nein'}: ${field.label}`
        }

        const text = typeof value === 'string' ? value : null

        if (field.kind === 'area') {
          return text === null
            ? '- keine'
            : text
                .split('\n')
                .filter((line) => line.trim() !== '')
                .map((line) => `- ${plainInMarkdown(line)}`)
                .join('\n')
        }

        return `- ${field.label}: ${text === null ? 'nicht angegeben' : plainInMarkdown(text)}`
      })

      return [`### ${section.number} ${section.title}`, '', ...lines].join('\n')
    })
    .join('\n\n')
}

function annex2(made: MeasuresMade): string {
  if (made.subprocessors.length === 0) {
    return 'Keine eingetragen.'
  }

  return [
    '| Name und Anschrift | Leistung | Ort der Verarbeitung |',
    '|---|---|---|',
    ...made.subprocessors.map(
      (entry) =>
        `| ${plainInMarkdown(entry.name)} | ${plainInMarkdown(entry.service)} | ${plainInMarkdown(entry.place)} |`,
    ),
  ].join('\n')
}

/** The measures as Markdown, as the PDF prints them. */
export function describeMeasures(template: string, made: MeasuresMade): string {
  const values: Record<(typeof measuresPlaces)[number], string> = {
    for: ` für ${plainInMarkdown(made.business)}`,
    made: made.at,
    'part-b-changed':
      made.changedAt === null
        ? 'hier sind sie noch nicht ausgefüllt'
        : `hier zuletzt geändert ${made.changedAt}`,
    'part-b': partB(made),
    subprocessors: annex2(made),
  }
  const seen = new Map<string, number>()
  const filled = template.replace(/\{\{([a-z-]+)\}\}/g, (_, place: string) => {
    if (!(measuresPlaces as readonly string[]).includes(place)) {
      throw new MeasuresTemplateError(`The template names a place there is none of: ${place}.`)
    }

    seen.set(place, (seen.get(place) ?? 0) + 1)

    return values[place as (typeof measuresPlaces)[number]]
  })

  for (const place of measuresPlaces) {
    if (seen.get(place) !== 1) {
      throw new MeasuresTemplateError(
        `The place ${place} stands ${String(seen.get(place) ?? 0)} times.`,
      )
    }
  }

  return filled
}

/** Part A alone, from its heading to the one of part B: what the page of the contract shows. */
export function measuresPartA(template: string): string {
  const start = template.indexOf('## Teil A:')
  const end = template.indexOf('## Teil B:')

  if (start < 0 || end < start) {
    throw new MeasuresTemplateError('The template has no part A before its part B.')
  }

  return template.slice(start, end).trim()
}
