import type { FormDefinition } from './definition.js'
import { type MeasurementUnit, measurementUnitSign } from './units.js'
import type { FormValue, FormValues } from './values.js'

/**
 * What the structure of an installation tells a protocol it starts (#304):
 * the customer it belongs to, the inverters, modules, batteries and meters of
 * a PV system, and what a wallbox or a battery says of itself (#307). A definition names, under `fromStructure`, which of its fields
 * starts with which of them; whoever fills the form in checks them and
 * changes them like any other value, and once it is signed they stay as they
 * were that day, whatever the structure says later.
 */
export const structureFigures = [
  /** The customer the site belongs to: name, and the address on the next line. */
  'operator',
  /** Each inverter on a line, with its serial number and rated power. */
  'inverters',
  /** Each battery of the system on a line, with its serial number. */
  'batteries',
  /** The serial numbers of the meters of the system. */
  'meters',
  /** The rated power of all inverters together, where every one names it. */
  'inverter_power',
  /** The rated power of all modules together, where every one names it. */
  'module_power',
  /** Whether a battery belongs to the system. */
  'battery_present',
  /** The installation itself on a line: designation, maker and type, serial number (#307). */
  'installation',
  /** The power the installation is rated for, a wallbox or a battery. */
  'rated_power',
  /** What a battery delivers of its charge. */
  'usable_capacity',
  /** The job a form of a job starts at: its designation and number (#310). */
  'job_work',
  /** Whether the work of the job is a building, as the job says or suggests. */
  'job_building',
  /** Whether the VOB/B is agreed for the job as a whole. */
  'job_vob',
] as const

export type StructureFigure = (typeof structureFigures)[number]

/** The kind of field each figure fills, and for a power the units it can stand in. */
export const structureFigureFields: Readonly<
  Record<
    StructureFigure,
    | { readonly kind: 'text' | 'yes_no' }
    | { readonly kind: 'number'; readonly units: readonly MeasurementUnit[] }
  >
> = {
  operator: { kind: 'text' },
  inverters: { kind: 'text' },
  batteries: { kind: 'text' },
  meters: { kind: 'text' },
  inverter_power: { kind: 'number', units: ['kilowatt', 'kilovoltampere'] },
  module_power: { kind: 'number', units: ['kilowatt_peak'] },
  battery_present: { kind: 'yes_no' },
  installation: { kind: 'text' },
  rated_power: { kind: 'number', units: ['kilowatt', 'kilovoltampere'] },
  usable_capacity: { kind: 'number', units: ['kilowatt_hour'] },
  job_work: { kind: 'text' },
  job_building: { kind: 'yes_no' },
  job_vob: { kind: 'yes_no' },
}

/** An inverter, a battery or a meter as the structure has it. */
export interface StructurePart {
  readonly designation: string | null
  readonly manufacturer: string | null
  readonly model: string | null
  readonly serialNumber: string | null
  /** In watts, where the structure names it; a battery and a meter name none. */
  readonly ratedPowerW?: number | null
}

/** The structure of the installation a protocol starts at, as the device holds it. */
export interface InstallationStructure {
  /** The customer the site belongs to, with the address on one line. */
  readonly operator: { readonly name: string; readonly address: string } | null
  readonly inverters: readonly StructurePart[]
  readonly modules: readonly { readonly ratedPowerW: number | null }[]
  readonly batteries: readonly StructurePart[]
  readonly meters: readonly StructurePart[]
  /**
   * The installation the protocol starts at, as it names itself (#307): a
   * wallbox with its rated power, a battery with its capacity in watt hours.
   */
  readonly installation?: (StructurePart & { readonly usableCapacityWh?: number | null }) | null
  /**
   * The job a form of a job starts at (#310), with building already decided
   * or suggested, so that the form takes a yes or a no.
   */
  readonly job?: {
    readonly designation: string
    readonly number: string | null
    readonly building: boolean
    readonly vob: boolean
  } | null
}

function filled(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.trim() !== ''
}

// A rated power as its label has it, "10 kW" or "9,6 kW", not as a figure somebody measured.
const ratedPower = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 })

/** "WR 1, SMA Sunny Tripower 10.0, Seriennummer 3001234567, 10 kW", leaving out what is missing. */
function partLine(part: StructurePart): string {
  const name = [part.manufacturer, part.model].filter(filled).join(' ')

  return [
    part.designation,
    name,
    filled(part.serialNumber) ? `Seriennummer ${part.serialNumber}` : null,
    typeof part.ratedPowerW === 'number'
      ? `${ratedPower.format(part.ratedPowerW / 1000)} ${measurementUnitSign.kilowatt}`
      : null,
  ]
    .filter(filled)
    .join(', ')
}

function lines(parts: readonly StructurePart[]): string | undefined {
  const written = parts.map(partLine).filter((line) => line !== '')

  return written.length === 0 ? undefined : written.join('\n')
}

/**
 * The power of all parts together in watts, a thousandth of a kilowatt as a
 * form counts it; nothing where there is no part or one names no power, since
 * a sum short of a part would read as the power of the whole system.
 */
function totalPower(
  parts: readonly { readonly ratedPowerW?: number | null }[],
): number | undefined {
  if (parts.length === 0 || parts.some((part) => typeof part.ratedPowerW !== 'number')) {
    return undefined
  }

  return parts.reduce((sum, part) => sum + (part.ratedPowerW ?? 0), 0)
}

/** A whole number of watts or watt hours, the thousandths of the field's unit, or nothing. */
function wholeOrNothing(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/** What one figure comes to for a structure, or nothing where the structure does not say. */
export function structureValue(
  figure: StructureFigure,
  structure: InstallationStructure,
): FormValue | undefined {
  switch (figure) {
    case 'operator': {
      const operator = structure.operator

      return operator && filled(operator.name)
        ? [operator.name.trim(), operator.address].filter(filled).join('\n')
        : undefined
    }
    case 'inverters':
      return lines(structure.inverters)
    case 'batteries':
      return lines(structure.batteries)
    case 'meters': {
      const numbers = structure.meters.map((meter) => meter.serialNumber).filter(filled)

      return numbers.length === 0 ? undefined : numbers.join(', ')
    }
    case 'inverter_power':
      return totalPower(structure.inverters)
    case 'module_power':
      return totalPower(structure.modules)
    case 'battery_present':
      return structure.batteries.length > 0
    case 'installation': {
      // Its power has a field of its own, so the line names what it is and nothing more.
      const line = structure.installation
        ? partLine({ ...structure.installation, ratedPowerW: null })
        : ''

      return line === '' ? undefined : line
    }
    case 'rated_power':
      return wholeOrNothing(structure.installation?.ratedPowerW)
    case 'usable_capacity':
      return wholeOrNothing(structure.installation?.usableCapacityWh)
    case 'job_work': {
      const job = structure.job

      return job && filled(job.designation)
        ? [job.designation.trim(), job.number].filter(filled).join(', ')
        : undefined
    }
    case 'job_building':
      return structure.job ? structure.job.building : undefined
    case 'job_vob':
      return structure.job ? structure.job.vob : undefined
  }
}

/**
 * The values a new protocol starts with out of the structure: one for each
 * field the definition names under `fromStructure`, where the structure has
 * something to say.
 */
export function structureValues(
  definition: FormDefinition,
  structure: InstallationStructure,
): FormValues {
  const values: Record<string, FormValue> = {}

  for (const [key, figure] of Object.entries(definition.fromStructure ?? {})) {
    const value = structureValue(figure, structure)

    if (value !== undefined) {
      values[key] = value
    }
  }

  return values
}
