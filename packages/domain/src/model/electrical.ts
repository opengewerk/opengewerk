import type {
  BoardSectionId,
  CircuitId,
  DistributionBoardId,
  EquipmentId,
  InstallationId,
  Synced,
} from './identifier.js'

/**
 * The electrical structure below an installation: board, section, circuit,
 * equipment. Section 3.2 of the concept lays it out, and two things hang off
 * it that cannot hang off anything else: the test records under VDE 0100-600
 * and 0105-100, whose readings are taken per circuit, and the circuit chart
 * printed for the door of the board.
 *
 * What is here is the structure, what identifies a part, and per circuit what
 * the chart and the test record need to know about it: the protective device,
 * the RCD, the cable and what it supplies. The readings themselves arrive
 * with the test record; they are the values of a test on a day, not a
 * property of the circuit.
 */

/**
 * What kind of board this is. A meter cabinet is not among them: it is an
 * installation of its own and carries the boards inside it, the same way the
 * two files beside this one put the inverter below the PV system and storage,
 * meters and the wallbox next to it. A board is part of an installation, never
 * a stand in for one.
 */
export const distributionBoardKinds = [
  /** Niederspannungshauptverteilung. */
  'main_distribution',
  /** Unterverteilung. */
  'sub_distribution',
] as const

export type DistributionBoardKind = (typeof distributionBoardKinds)[number]

export const distributionBoardKindLabel: Readonly<Record<DistributionBoardKind, string>> = {
  main_distribution: 'Hauptverteilung',
  sub_distribution: 'Unterverteilung',
}

/**
 * The device that protects a circuit against overcurrent.
 *
 * A breaker and a fuse are told apart here because the characteristic that
 * goes with them is not the same kind of thing: a breaker trips by a curve
 * (B, C, D, K, Z), a fuse melts by its utilisation category (gG, aM). The
 * test record will ask which, since the loop impedance a circuit may have
 * follows from it.
 */
export const overcurrentDevices = [
  /** Leitungsschutzschalter. */
  'circuit_breaker',
  /** FI/LS-Schalter: overcurrent and residual current in one device. */
  'rcbo',
  /** Schmelzsicherung D (DIAZED). */
  'fuse_d',
  /** Schmelzsicherung D0 (NEOZED). */
  'fuse_d0',
  /** NH-Sicherung. */
  'fuse_nh',
] as const

export type OvercurrentDevice = (typeof overcurrentDevices)[number]

/** How the device is written on a chart: short, the way it is written on a door. */
export const overcurrentDeviceLabel: Readonly<Record<OvercurrentDevice, string>> = {
  circuit_breaker: 'LS',
  rcbo: 'FI/LS',
  fuse_d: 'D',
  fuse_d0: 'D0',
  fuse_nh: 'NH',
}

/** How the device is called in a list of choices, where there is room for it. */
export const overcurrentDeviceName: Readonly<Record<OvercurrentDevice, string>> = {
  circuit_breaker: 'Leitungsschutzschalter (LS)',
  rcbo: 'FI/LS-Schalter',
  fuse_d: 'Schmelzsicherung D (DIAZED)',
  fuse_d0: 'Schmelzsicherung D0 (NEOZED)',
  fuse_nh: 'NH-Sicherung',
}

export const tripCharacteristics = ['b', 'c', 'd', 'k', 'z', 'gg', 'am'] as const

export type TripCharacteristic = (typeof tripCharacteristics)[number]

export const tripCharacteristicLabel: Readonly<Record<TripCharacteristic, string>> = {
  b: 'B',
  c: 'C',
  d: 'D',
  k: 'K',
  z: 'Z',
  gg: 'gG',
  am: 'aM',
}

/** The curves a breaker trips by. */
const breakerCharacteristics: readonly TripCharacteristic[] = ['b', 'c', 'd', 'k', 'z']

/** The categories a fuse is made in. */
const fuseCharacteristics: readonly TripCharacteristic[] = ['gg', 'am']

/**
 * The characteristics that go with a device, all of them when no device is
 * chosen yet. A form offers these and no others, and the check below refuses
 * the rest, so a "D0 with curve B" cannot reach a chart.
 */
export function characteristicsFor(
  device: OvercurrentDevice | null,
): readonly TripCharacteristic[] {
  if (device === null) {
    return tripCharacteristics
  }

  return device === 'circuit_breaker' || device === 'rcbo'
    ? breakerCharacteristics
    : fuseCharacteristics
}

/**
 * The type of the residual current device a circuit is behind: which fault
 * currents it detects. `a_ev` is type A with the detection of smooth direct
 * fault currents of 6 mA that a wallbox asks for.
 */
export const rcdTypes = ['ac', 'a', 'a_ev', 'f', 'b', 'b_plus'] as const

export type RcdType = (typeof rcdTypes)[number]

export const rcdTypeLabel: Readonly<Record<RcdType, string>> = {
  ac: 'AC',
  a: 'A',
  a_ev: 'A EV',
  f: 'F',
  b: 'B',
  b_plus: 'B+',
}

/**
 * The reference installation method of a cable after DIN VDE 0298-4 and
 * IEC 60364-5-52, the letter the current carrying capacity is read under.
 */
export const cableInstallationMethods = [
  'a1',
  'a2',
  'b1',
  'b2',
  'c',
  'd1',
  'd2',
  'e',
  'f',
  'g',
] as const

export type CableInstallationMethod = (typeof cableInstallationMethods)[number]

export const cableInstallationMethodLabel: Readonly<Record<CableInstallationMethod, string>> = {
  a1: 'A1',
  a2: 'A2',
  b1: 'B1',
  b2: 'B2',
  c: 'C',
  d1: 'D1',
  d2: 'D2',
  e: 'E',
  f: 'F',
  g: 'G',
}

/** What each method means, for the list a person picks from. */
export const cableInstallationMethodName: Readonly<Record<CableInstallationMethod, string>> = {
  a1: 'A1: Aderleitung im Rohr in wärmegedämmter Wand',
  a2: 'A2: Mehradrige Leitung im Rohr in wärmegedämmter Wand',
  b1: 'B1: Aderleitung im Rohr auf oder in der Wand',
  b2: 'B2: Mehradrige Leitung im Rohr auf oder in der Wand',
  c: 'C: Direkt auf oder in der Wand',
  d1: 'D1: Im Erdreich im Schutzrohr',
  d2: 'D2: Direkt im Erdreich',
  e: 'E: Frei in Luft, mit Abstand zur Wand',
  f: 'F: Einadrig, frei in Luft, sich berührend',
  g: 'G: Einadrig, frei in Luft, mit Abstand',
}

export interface DistributionBoard extends Synced {
  readonly id: DistributionBoardId
  readonly installationId: InstallationId
  readonly kind: DistributionBoardKind
  /** `HV`, `UV Küche`, whatever is written on the door. */
  readonly designation: string
  /** Where it hangs: `Keller, Raum 2`. */
  readonly location: string | null
  readonly position: number
}

/**
 * A section of a board. Large boards are divided into them, a small sub
 * distribution is not, which is why a circuit may point straight at its board.
 */
export interface BoardSection extends Synced {
  readonly id: BoardSectionId
  readonly distributionBoardId: DistributionBoardId
  readonly designation: string
  readonly position: number
}

/**
 * One circuit, with what section 3.2 lists for it.
 *
 * The figures are whole numbers of thousandths, like `quantityMilli` on a
 * document line: a rated current of 16 A is 16000, a residual current of
 * 30 mA is 30, a cross section of 1.5 mm² is 1500, a length of 12.5 m is
 * 12500. No fractions travel between device and server, and a comparison
 * against a limit in the test record is a comparison of integers.
 *
 * Every figure may be missing. A circuit written down in front of a board is
 * a designation first; what the breaker says, somebody reads off later, and
 * the chart prints what is there.
 */
export interface Circuit extends Synced {
  readonly id: CircuitId
  readonly distributionBoardId: DistributionBoardId
  /** Set when the board is divided into sections, null when it is not. */
  readonly boardSectionId: BoardSectionId | null
  /** `F3`, `-1F3`, whatever the label on the device says. */
  readonly designation: string
  /** What it supplies: `Steckdosen Bad`, `Herd`. */
  readonly consumer: string | null
  readonly overcurrentDevice: OvercurrentDevice | null
  readonly tripCharacteristic: TripCharacteristic | null
  /** The rated current In, in milliamperes. */
  readonly ratedCurrentMilli: number | null
  readonly rcdType: RcdType | null
  /** The rated residual current IΔn, in milliamperes. */
  readonly ratedResidualCurrentMilli: number | null
  /** `NYM-J`, `NYY-J`, `H07V-K`. */
  readonly cableType: string | null
  /** How many conductors: the 3 of `3 × 1,5`. */
  readonly cableCores: number | null
  /** In thousandths of a square millimetre. */
  readonly cableCrossSectionMilli: number | null
  /** In millimetres, the thousandths of a metre. */
  readonly cableLengthMilli: number | null
  readonly cableInstallationMethod: CableInstallationMethod | null
  readonly position: number
}

/** A device on a circuit: socket, luminaire, motor, whatever is connected. */
export interface Equipment extends Synced {
  readonly id: EquipmentId
  readonly circuitId: CircuitId
  readonly designation: string
  /** What it is: `Steckdose`, `Leuchte`, `Durchlauferhitzer`. */
  readonly kind: string | null
  readonly manufacturer: string | null
  /** The type designation from the rating plate. */
  readonly model: string | null
  readonly serialNumber: string | null
  readonly position: number
}

/**
 * The largest figures accepted, as guards against a slip and not as limits of
 * physics: a rated current of 6300 A is the largest a low voltage board
 * carries, and a residual current device above 30 A is not one anybody sells.
 * A cable of more than 1000 mm² or longer than 100 km is a decimal point in
 * the wrong place.
 */
const largest = {
  ratedCurrentMilli: 6_300_000,
  ratedResidualCurrentMilli: 30_000,
  cableCores: 100,
  cableCrossSectionMilli: 1_000_000,
  cableLengthMilli: 100_000_000,
} as const

/** The circuit fields a person fills in, as a device or a form sends them. */
export const circuitFigureFields = [
  'overcurrentDevice',
  'tripCharacteristic',
  'ratedCurrentMilli',
  'rcdType',
  'ratedResidualCurrentMilli',
  'cableCores',
  'cableCrossSectionMilli',
  'cableLengthMilli',
  'cableInstallationMethod',
] as const

function oneOf<Value extends string>(value: unknown, allowed: readonly Value[]): boolean {
  return value === null || value === undefined || allowed.includes(value as Value)
}

function wholeUpTo(value: unknown, most: number): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= most)
  )
}

/**
 * What is wrong with the figures of a circuit, one sentence per field, empty
 * when nothing is.
 *
 * One function for the form, the sync and the chart, so that all of them
 * refuse the same values with the same words. It takes whatever arrived,
 * because a device sends values and not types: a number that came as text is
 * a mistake here, not something to convert. It looks at the circuit as it
 * would stand afterwards, not at a patch alone, since whether a curve goes
 * with a device depends on both, and a patch may carry only one of them.
 */
export function circuitProblems(
  circuit: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const problems: Record<string, string> = {}
  const device = circuit['overcurrentDevice']
  const characteristic = circuit['tripCharacteristic']

  if (!oneOf(device, overcurrentDevices)) {
    problems['overcurrentDevice'] = 'Diese Schutzeinrichtung kennt OpenGewerk nicht.'
  }

  if (!oneOf(characteristic, tripCharacteristics)) {
    problems['tripCharacteristic'] = 'Diese Charakteristik kennt OpenGewerk nicht.'
  } else if (
    typeof characteristic === 'string' &&
    typeof device === 'string' &&
    problems['overcurrentDevice'] === undefined &&
    !characteristicsFor(device as OvercurrentDevice).includes(characteristic as TripCharacteristic)
  ) {
    problems['tripCharacteristic'] =
      'B, C, D, K und Z sind Auslösekennlinien von Schaltern, gG und aM Betriebsklassen von ' +
      'Schmelzsicherungen. Diese passt nicht zur gewählten Schutzeinrichtung.'
  }

  if (!wholeUpTo(circuit['ratedCurrentMilli'], largest.ratedCurrentMilli)) {
    problems['ratedCurrentMilli'] = 'Der Nennstrom ist größer als 0 und höchstens 6300 A.'
  }

  if (!oneOf(circuit['rcdType'], rcdTypes)) {
    problems['rcdType'] = 'Diesen RCD-Typ kennt OpenGewerk nicht.'
  }

  if (!wholeUpTo(circuit['ratedResidualCurrentMilli'], largest.ratedResidualCurrentMilli)) {
    problems['ratedResidualCurrentMilli'] =
      'Der Bemessungsdifferenzstrom ist eine ganze Zahl von 1 bis 30000 mA.'
  }

  if (!wholeUpTo(circuit['cableCores'], largest.cableCores)) {
    problems['cableCores'] = 'Die Aderzahl ist eine ganze Zahl von 1 bis 100.'
  }

  if (!wholeUpTo(circuit['cableCrossSectionMilli'], largest.cableCrossSectionMilli)) {
    problems['cableCrossSectionMilli'] = 'Der Querschnitt ist größer als 0 und höchstens 1000 mm².'
  }

  if (!wholeUpTo(circuit['cableLengthMilli'], largest.cableLengthMilli)) {
    problems['cableLengthMilli'] = 'Die Länge ist größer als 0 und höchstens 100 km.'
  }

  if (!oneOf(circuit['cableInstallationMethod'], cableInstallationMethods)) {
    problems['cableInstallationMethod'] = 'Diese Verlegeart kennt OpenGewerk nicht.'
  }

  return problems
}

const figures = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 })

/** Thousandths as the figure a person reads: 1500 as "1,5". */
export function milliText(milli: number): string {
  return figures.format(milli / 1000)
}

/** Only what a chart or a row needs from a circuit, typed loosely enough for both. */
export type CircuitFigures = Pick<
  Circuit,
  | 'overcurrentDevice'
  | 'tripCharacteristic'
  | 'ratedCurrentMilli'
  | 'rcdType'
  | 'ratedResidualCurrentMilli'
  | 'cableType'
  | 'cableCores'
  | 'cableCrossSectionMilli'
  | 'cableLengthMilli'
  | 'cableInstallationMethod'
>

/**
 * The protective device the way it is written on a board: "LS B 16 A",
 * "D0 gG 25 A". Null when nothing about it is known.
 *
 * Here and not in the screens, so that the chart on the door and the row on
 * the screen say the same thing in the same order.
 */
export function overcurrentText(circuit: CircuitFigures): string | null {
  const parts = [
    circuit.overcurrentDevice === null ? null : overcurrentDeviceLabel[circuit.overcurrentDevice],
    circuit.tripCharacteristic === null
      ? null
      : tripCharacteristicLabel[circuit.tripCharacteristic],
    circuit.ratedCurrentMilli === null ? null : `${milliText(circuit.ratedCurrentMilli)} A`,
  ].filter((part): part is string => part !== null)

  return parts.length === 0 ? null : parts.join(' ')
}

/** The residual current device: "Typ A 30 mA". Null when nothing about it is known. */
export function rcdText(circuit: CircuitFigures): string | null {
  const parts = [
    circuit.rcdType === null ? null : `Typ ${rcdTypeLabel[circuit.rcdType]}`,
    circuit.ratedResidualCurrentMilli === null
      ? null
      : `${String(circuit.ratedResidualCurrentMilli)} mA`,
  ].filter((part): part is string => part !== null)

  return parts.length === 0 ? null : parts.join(' ')
}

/**
 * The cable: "NYM-J 3 × 1,5 mm²". The cores only with a cross section,
 * because "NYM-J 3 ×" says nothing, and the cross section alone as
 * "1,5 mm²". Null when nothing about it is known.
 */
export function cableText(circuit: CircuitFigures): string | null {
  const size =
    circuit.cableCrossSectionMilli === null
      ? null
      : `${circuit.cableCores === null ? '' : `${String(circuit.cableCores)} × `}${milliText(
          circuit.cableCrossSectionMilli,
        )} mm²`
  const parts = [circuit.cableType, size].filter(
    (part): part is string => part !== null && part.trim() !== '',
  )

  return parts.length === 0 ? null : parts.join(' ')
}

/** The length of the cable: "12,5 m". */
export function cableLengthText(circuit: CircuitFigures): string | null {
  return circuit.cableLengthMilli === null ? null : `${milliText(circuit.cableLengthMilli)} m`
}

/** Anything that sits in the structure at a place among its siblings. */
export interface Positioned {
  readonly id: string
  readonly designation: string
  readonly position: number
}

const designations = new Intl.Collator('de-DE', { numeric: true, sensitivity: 'base' })

/**
 * The order boards, sections, circuits and equipment are listed in, on the
 * screen and on the chart.
 *
 * By position first, which is where somebody put a part, and by designation
 * after that, compared the way a person counts: F2 before F10, which a plain
 * string comparison gets wrong on every board with more than nine circuits.
 * The id is the last word, so that two parts with the same place and name
 * still come out the same way on every device.
 */
export function inStructureOrder(left: Positioned, right: Positioned): number {
  return (
    left.position - right.position ||
    designations.compare(left.designation, right.designation) ||
    left.id.localeCompare(right.id)
  )
}
