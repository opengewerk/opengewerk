/**
 * What the help for the Marktstammdatenregister works out of the PV structure
 * (#306): the main and the secondary orientation of a solar unit, which the
 * register asks with their tilt (annex of the MaStRV, B.1.6.1.4 to B.1.6.1.7).
 */

/** A string as the structure has it, with its modules counted and their power summed. */
export interface OrientedString {
  readonly azimuthDeg: number | null
  readonly tiltDeg: number | null
  readonly modules: number
  /** Of all its modules in watts; null where one of them names none. */
  readonly ratedPowerW: number | null
}

/** Strings that face the same way at the same tilt, taken together. */
export interface Orientation {
  readonly azimuthDeg: number
  readonly tiltDeg: number | null
  readonly modules: number
  /** Null where a string of them names no power. */
  readonly ratedPowerW: number | null
}

/**
 * The orientations of a solar unit, the main one first: the strings grouped
 * by azimuth and tilt, ordered by their power where every string names one
 * and otherwise by their modules, since a sum short of a module would put a
 * smaller roof first. A string without an azimuth faces nowhere the register
 * could name and is left out.
 */
export function pvOrientations(strings: readonly OrientedString[]): readonly Orientation[] {
  const groups = new Map<string, Orientation>()

  for (const entry of strings) {
    if (entry.azimuthDeg === null) {
      continue
    }

    const key = `${String(entry.azimuthDeg)} ${String(entry.tiltDeg)}`
    const group = groups.get(key)

    groups.set(key, {
      azimuthDeg: entry.azimuthDeg,
      tiltDeg: entry.tiltDeg,
      modules: (group?.modules ?? 0) + entry.modules,
      ratedPowerW:
        group === undefined
          ? entry.ratedPowerW
          : group.ratedPowerW === null || entry.ratedPowerW === null
            ? null
            : group.ratedPowerW + entry.ratedPowerW,
    })
  }

  const all = [...groups.values()]
  const byPower = all.every((group) => group.ratedPowerW !== null)

  return all.sort(
    (left, right) =>
      (byPower ? (right.ratedPowerW ?? 0) - (left.ratedPowerW ?? 0) : 0) ||
      right.modules - left.modules ||
      left.azimuthDeg - right.azimuthDeg,
  )
}
