import type { FundingProgramId } from './identifier.js'
import type { InstallationKind } from './installation.js'

/**
 * A funding programme as a template of the office (#307, Feature-Gliederung
 * 5.1): what a programme asks for as proof, in its order and its words, so
 * that the papers for it come together at an installation without a change
 * to OpenGewerk. Programmes change often, a template is changed with them.
 *
 * Kept at the desk, it goes to no device; the owner and the office keep the
 * programmes and put the papers together. No installation names one: the
 * papers are made when they are asked for, and a programme taken out is only
 * missing from the choice.
 */
export interface FundingProgram {
  readonly id: FundingProgramId
  readonly name: string
  /** Who funds it, as the programme names itself. */
  readonly sponsor: string | null
  /** The page with its conditions, an address on the web. */
  readonly url: string | null
  /** The kinds of installation it is for, at least one. */
  readonly kinds: readonly FundingKind[]
  /** The proofs it asks for, in its order. */
  readonly evidence: readonly FundingEvidence[]
  /** The text of the declaration of the business, with placeholders. */
  readonly declaration: string | null
}

/** The kinds of installation a programme can be for: what the papers can be put together for. */
export const fundingKinds = [
  'pv_system',
  'battery',
  'wallbox',
] as const satisfies readonly InstallationKind[]

export type FundingKind = (typeof fundingKinds)[number]

/**
 * Where a proof comes from: out of OpenGewerk, which lays it in, or from the
 * operator, who brings it, a bank statement or the confirmation of the
 * Marktstammdatenregister.
 */
export const fundingEvidenceSources = [
  'invoice',
  'declaration',
  'commissioning',
  'photos',
  'serial_numbers',
  'operator',
] as const

export type FundingEvidenceSource = (typeof fundingEvidenceSources)[number]

/** How the form and the papers name where a proof comes from. */
export const fundingSourceLabel: Readonly<Record<FundingEvidenceSource, string>> = {
  invoice: 'Rechnung',
  declaration: 'Fachunternehmererklärung',
  commissioning: 'Inbetriebnahmeprotokoll',
  photos: 'Fotos',
  serial_numbers: 'Seriennummern',
  operator: 'Bringt der Betreiber',
}

/** One proof a programme asks for, and what the programme calls it. */
export interface FundingEvidence {
  readonly source: FundingEvidenceSource
  readonly label: string
}

/** The longest each text may be and the most proofs, as the checks in the database hold them. */
export const fundingProgramLimits = {
  name: 200,
  sponsor: 200,
  url: 500,
  label: 200,
  declaration: 5000,
  evidence: 20,
} as const

/** The placeholders the text of a declaration can have, each filled from the installation. */
export const declarationPlaceholders = [
  'betreiber',
  'objekt',
  'anlage',
  'seriennummer',
  'leistung',
  'kapazität',
  'inbetriebnahme',
  'betrieb',
  'datum',
] as const

export type DeclarationPlaceholder = (typeof declarationPlaceholders)[number]

const placeholderPattern = /\{([^{}\s]+)\}/g

/** Whether a value is one of the given words. */
function oneOf<T extends string>(words: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (words as readonly string[]).includes(value)
}

/**
 * What is wrong with the proofs of a programme, or nothing: at least one and
 * at most twenty, each from a known source with a name of its own, and each
 * that OpenGewerk lays in only once, since the papers lay it in once.
 */
function evidenceProblem(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return 'Ein Förderprogramm verlangt mindestens einen Nachweis.'
  }

  if (value.length > fundingProgramLimits.evidence) {
    return `Ein Förderprogramm hat höchstens ${String(fundingProgramLimits.evidence)} Nachweise.`
  }

  const seen = new Set<string>()

  for (const entry of value as unknown[]) {
    const source = (entry as { source?: unknown } | null)?.source
    const label = (entry as { label?: unknown } | null)?.label

    if (typeof entry !== 'object' || entry === null || !oneOf(fundingEvidenceSources, source)) {
      return 'Ein Nachweis kommt aus OpenGewerk oder vom Betreiber.'
    }

    if (typeof label !== 'string' || label.trim() === '') {
      return 'Jeder Nachweis braucht den Namen, den das Programm ihm gibt.'
    }

    if (label.trim().length > fundingProgramLimits.label) {
      return `Der Name eines Nachweises hat höchstens ${String(fundingProgramLimits.label)} Zeichen.`
    }

    if (source !== 'operator' && seen.has(source)) {
      return `${fundingSourceLabel[source]} steht nur einmal in der Liste; die Förderunterlagen legen sie einmal bei.`
    }

    seen.add(source)
  }

  return null
}

/**
 * What is wrong with a programme, field by field, or nothing; asked of a
 * whole programme, or of the fields a change sends together with those it
 * keeps. Sentences the office reads beside the field.
 */
export function fundingProgramProblems(
  program: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const problems: Record<string, string> = {}

  if ('name' in program) {
    const name = program['name']

    if (typeof name !== 'string' || name.trim() === '') {
      problems['name'] = 'Ein Förderprogramm braucht einen Namen.'
    } else if (name.trim().length > fundingProgramLimits.name) {
      problems['name'] = `Ein Name hat höchstens ${String(fundingProgramLimits.name)} Zeichen.`
    }
  }

  for (const field of ['sponsor', 'url', 'declaration'] as const) {
    const value = program[field]
    const limit = fundingProgramLimits[field]

    if (value !== undefined && value !== null && typeof value !== 'string') {
      problems[field] = 'Hier steht Text.'
    } else if (typeof value === 'string' && value.length > limit) {
      problems[field] = `Hier stehen höchstens ${String(limit)} Zeichen.`
    }
  }

  const url = program['url']

  if (
    typeof url === 'string' &&
    problems['url'] === undefined &&
    !/^https?:\/\/[^\s/?#.]+(\.[^\s/?#.]+)+([/?#]\S*)?$/i.test(url)
  ) {
    problems['url'] = 'Die Seite ist eine Adresse, die mit https:// beginnt.'
  }

  if ('kinds' in program) {
    const kinds = program['kinds']

    if (
      !Array.isArray(kinds) ||
      kinds.length === 0 ||
      !kinds.every((kind) => oneOf(fundingKinds, kind)) ||
      new Set(kinds).size !== kinds.length
    ) {
      problems['kinds'] =
        'Ein Förderprogramm gilt für eine PV-Anlage, einen Speicher oder eine Wallbox.'
    }
  }

  if ('evidence' in program) {
    const problem = evidenceProblem(program['evidence'])

    if (problem !== null) {
      problems['evidence'] = problem
    }
  }

  const declaration = program['declaration']

  if (typeof declaration === 'string' && problems['declaration'] === undefined) {
    const unknown = [...declaration.matchAll(placeholderPattern)]
      .map((match) => match[1] ?? '')
      .find((word) => !oneOf(declarationPlaceholders, word))

    if (unknown !== undefined) {
      problems['declaration'] = `Den Platzhalter {${unknown}} kennt OpenGewerk nicht.`
    }
  }

  // Judged only with both at hand: the evidence and the text that goes with it.
  const evidence = program['evidence']

  if (
    'evidence' in program &&
    'declaration' in program &&
    problems['evidence'] === undefined &&
    problems['declaration'] === undefined &&
    Array.isArray(evidence) &&
    evidence.some((entry) => (entry as FundingEvidence).source === 'declaration') &&
    (typeof declaration !== 'string' || declaration.trim() === '')
  ) {
    problems['declaration'] = 'Eine Fachunternehmererklärung braucht ihren Text.'
  }

  return problems
}

/** The programmes for an installation of a kind, by name. */
export function fundingProgramsFor<T extends Pick<FundingProgram, 'kinds' | 'name'>>(
  programs: readonly T[],
  kind: InstallationKind,
): readonly T[] {
  return programs
    .filter((program) => (program.kinds as readonly string[]).includes(kind))
    .sort((left, right) => left.name.localeCompare(right.name, 'de'))
}

/** What a placeholder is filled with where the installation does not say: a line to write on. */
export const declarationBlank = '________'

/**
 * The text of a declaration with its placeholders filled from the
 * installation; one the installation does not fill is a line to write on.
 */
export function filledDeclaration(
  text: string,
  values: Readonly<Partial<Record<DeclarationPlaceholder, string | null>>>,
): string {
  return text.replace(placeholderPattern, (whole, word: string) => {
    if (!oneOf(declarationPlaceholders, word)) {
      return whole
    }

    const value = values[word]

    return typeof value === 'string' && value.trim() !== '' ? value.trim() : declarationBlank
  })
}

/** How a proof stands in the papers: laid in, missing from what OpenGewerk holds, or brought by the operator. */
export type FundingEvidenceState = 'enclosed' | 'missing' | 'operator'

/** What OpenGewerk holds of an installation that a proof can be made of. */
export interface FundingMaterial {
  readonly invoices: number
  readonly commissioning: number
  readonly photos: number
  readonly serialNumbers: number
  /** Whether the programme has the text of its declaration. */
  readonly declaration: boolean
}

/**
 * How each proof of a programme stands for an installation: what comes out
 * of OpenGewerk lies in where there is something to lay in, and is missing
 * where there is not, a signed commissioning protocol that is not there yet;
 * what the operator brings stays a line on the list.
 */
export function fundingChecklist(
  evidence: readonly FundingEvidence[],
  material: FundingMaterial,
): readonly (FundingEvidence & { readonly state: FundingEvidenceState })[] {
  const held: Readonly<Record<Exclude<FundingEvidenceSource, 'operator'>, boolean>> = {
    invoice: material.invoices > 0,
    declaration: material.declaration,
    commissioning: material.commissioning > 0,
    photos: material.photos > 0,
    serial_numbers: material.serialNumbers > 0,
  }

  return evidence.map((entry) => ({
    ...entry,
    state: entry.source === 'operator' ? 'operator' : held[entry.source] ? 'enclosed' : 'missing',
  }))
}
