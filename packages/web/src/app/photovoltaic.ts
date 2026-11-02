import {
  belongsToPvSystemKind,
  type BlockCircuit,
  type InstallationStructure,
  pvStringItem,
  type RecordState,
  type StructurePart,
} from '@opengewerk/domain'
import { inverterChoice, ordered, useInvertersOf } from '@opengewerk/platform-web/electrical'
import { maybeText, text, useRecord, useRecords, useRelated } from '@opengewerk/platform-web/sync'
import type { Draft, FormField } from '@opengewerk/platform-web/sync'
import { useMemo } from 'react'

import { addressLine } from './format.js'

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

function partOf(record: RecordState): StructurePart {
  const power = record['ratedPowerW']

  return {
    designation: maybeText(record, 'designation'),
    manufacturer: maybeText(record, 'manufacturer'),
    model: maybeText(record, 'model'),
    serialNumber: maybeText(record, 'serialNumber'),
    ratedPowerW: typeof power === 'number' ? power : null,
  }
}

/**
 * The structure a protocol at an installation starts from (#304): the
 * customer of its site, and for a PV system, or a battery that belongs to
 * one, the inverters, modules, batteries and meters of that system. A battery
 * of no system is the only battery there is.
 */
export function useInstallationStructure(
  installationId: string | undefined,
): InstallationStructure | null {
  const installation = useRecord('installations', installationId)
  const site = useRecord('sites', installation ? text(installation, 'siteId') : undefined)
  const customer = useRecord('customers', site ? text(site, 'customerId') : undefined)
  const kind = installation ? text(installation, 'kind') : ''
  const systemId =
    kind === 'pv_system'
      ? installationId
      : installation
        ? (maybeText(installation, 'pvSystemId') ?? undefined)
        : undefined
  const inverters = useInverters(systemId)
  const modules = useSystemModules(systemId)
  const companions = useCompanions(systemId)

  return useMemo(() => {
    if (!installation) {
      return null
    }

    const ofKind = (wanted: string) =>
      companions.filter((companion) => text(companion, 'kind') === wanted).map(partOf)
    const power = (record: RecordState) => record['ratedPowerW']

    return {
      operator: customer ? { name: text(customer, 'name'), address: addressLine(customer) } : null,
      inverters: inverters.map(partOf),
      modules: modules.map((module) => {
        const watts = power(module)

        return { ratedPowerW: typeof watts === 'number' ? watts : null }
      }),
      batteries:
        systemId === undefined && kind === 'battery' ? [partOf(installation)] : ofKind('battery'),
      meters: ofKind('meter'),
    }
  }, [installation, customer, kind, systemId, inverters, modules, companions])
}

/**
 * The strings of a PV system as the blocks of a test of its DC side take them
 * (#305): in the order of the structure, inverter by inverter, each with its
 * inverter, its input, its modules and their power.
 */
export function useBlockStrings(
  installationId: string | undefined,
): readonly (BlockCircuit & { readonly id: string })[] {
  const inverters = useInverters(installationId)
  const strings = useRecords('pv_strings')
  const modules = useRecords('pv_modules')

  return useMemo(
    () =>
      inverters.flatMap((inverter) =>
        ordered(
          strings.filter((pvString) => text(pvString, 'inverterId') === String(inverter['id'])),
        ).map((pvString) => {
          const own = modules.filter(
            (module) => text(module, 'pvStringId') === String(pvString['id']),
          )
          const powers = own.map((module) => module['ratedPowerW'])
          const input = pvString['mppInput']

          return {
            id: String(pvString['id']),
            ...pvStringItem({
              designation: text(pvString, 'designation'),
              mppInput: typeof input === 'number' ? input : null,
              inverter: maybeText(inverter, 'designation'),
              modules: own.length,
              ratedPowerW:
                own.length > 0 && powers.every((power) => typeof power === 'number')
                  ? (powers as number[]).reduce((sum, power) => sum + power, 0)
                  : null,
            }),
          }
        }),
      ),
    [inverters, strings, modules],
  )
}
