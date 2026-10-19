import { belongsToPvSystemKind, type RecordState } from '@opengewerk/domain'
import { inverterChoice, ordered, useInvertersOf } from '@opengewerk/platform-web/electrical'
import { text, useRecords, useRelated } from '@opengewerk/platform-web/sync'
import type { Draft, FormField } from '@opengewerk/platform-web/sync'
import { useMemo } from 'react'

/**
 * The PV structure below a PV system, as this application binds it (#300).
 * The forms and parts are the foundation's (ADR 0014) and come from here as
 * well; what is this application's is that an inverter hangs on the
 * installation that is the PV system, and that a battery, a meter or a
 * wallbox says which system it belongs to.
 */
export * from '@opengewerk/platform-web/electrical'

/** The inverters of a PV system. */
export function useInverters(installationId: string | undefined) {
  return useInvertersOf('installationId', installationId)
}

/** The batteries, meters and wallboxes that say they belong to this PV system. */
export function useCompanions(pvSystemId: string | undefined) {
  const related = useRelated('installations', 'pvSystemId', pvSystemId)

  return useMemo(() => ordered(related), [related])
}

/** The modules below a PV system, over its inverters and their strings. */
export function useSystemModules(installationId: string | undefined): readonly RecordState[] {
  const inverters = useInverters(installationId)
  const strings = useRecords('pv_strings')
  const modules = useRecords('pv_modules')

  return useMemo(() => {
    const ids = new Set(inverters.map((inverter) => String(inverter['id'])))
    const stringIds = new Set(
      strings
        .filter((pvString) => ids.has(text(pvString, 'inverterId')))
        .map((pvString) => String(pvString['id'])),
    )

    return modules.filter((module) => stringIds.has(text(module, 'pvStringId')))
  }, [inverters, strings, modules])
}

/**
 * The two fields of a battery, a meter or a wallbox that say where it belongs
 * (#300): the PV systems at its site, and the inverters of the one chosen.
 * Only for those three kinds, and the inverter only once a system is chosen;
 * the form hands back what does not stand as empty.
 */
export function companionFields(
  pvSystems: readonly RecordState[],
  inverters: readonly RecordState[],
): readonly FormField[] {
  return [
    {
      name: 'pvSystemId',
      label: 'Gehört zu PV-Anlage',
      hint: 'Nur PV-Anlagen an diesem Objekt.',
      options: [
        { value: '', label: 'Zu keiner' },
        ...pvSystems.map((system) => ({
          value: String(system['id']),
          label: text(system, 'designation'),
        })),
      ],
      shownWhen: (values) => belongsToPvSystemKind(values['kind']),
    },
    {
      name: 'inverterId',
      label: 'Am Wechselrichter',
      hint: 'Leer, wenn er an keinem hängt.',
      optionsFor: (values) => [
        { value: '', label: 'An keinem' },
        ...inverters
          .filter((inverter) => text(inverter, 'installationId') === values['pvSystemId'])
          .map((inverter) => ({ value: String(inverter['id']), label: inverterChoice(inverter) })),
      ],
      shownWhen: (values) =>
        belongsToPvSystemKind(values['kind']) && (values['pvSystemId'] ?? '') !== '',
    },
  ]
}

/** The link the two fields above hand back, as the installation keeps it. */
export function asCompanion(values: Readonly<Record<string, string>>): Draft {
  const pvSystemId = values['pvSystemId'] ?? ''
  const inverterId = values['inverterId'] ?? ''

  return {
    pvSystemId: pvSystemId === '' ? null : pvSystemId,
    inverterId: pvSystemId === '' || inverterId === '' ? null : inverterId,
  }
}
