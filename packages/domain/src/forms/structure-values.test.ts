import { describe, expect, it } from 'vitest'

import { definitionProblems, type FormDefinition } from './definition.js'
import { type InstallationStructure, structureValues } from './structure-values.js'

/** A commissioning protocol the way a trade package writes one, cut down to what starts from the structure. */
const commissioning: FormDefinition = {
  key: 'probe-commissioning',
  version: 1,
  title: 'Probe der Inbetriebsetzung',
  attachesTo: 'installation',
  installationKinds: ['pv_system', 'battery'],
  purpose: 'commissioning',
  fromStructure: {
    operator: 'operator',
    inverters: 'inverters',
    batteries: 'batteries',
    meter: 'meters',
    apparent_power: 'inverter_power',
    active_power: 'inverter_power',
    module_power: 'module_power',
    with_battery: 'battery_present',
  },
  sections: [
    {
      key: 'plant',
      title: 'Anlage',
      fields: [
        { kind: 'text', key: 'operator', label: 'Anlagenbetreiber', multiline: true },
        { kind: 'text', key: 'inverters', label: 'Wechselrichter', multiline: true },
        { kind: 'text', key: 'batteries', label: 'Speicher', multiline: true },
        { kind: 'text', key: 'meter', label: 'Zähler' },
        {
          kind: 'number',
          key: 'apparent_power',
          label: 'Scheinleistung',
          unit: 'kilovoltampere',
          decimals: 2,
        },
        {
          kind: 'number',
          key: 'active_power',
          label: 'Wirkleistung',
          unit: 'kilowatt',
          decimals: 2,
        },
        {
          kind: 'number',
          key: 'module_power',
          label: 'Modulleistung',
          unit: 'kilowatt_peak',
          decimals: 2,
        },
        { kind: 'yes_no', key: 'with_battery', label: 'Mit Speicher' },
        { kind: 'text', key: 'remark', label: 'Bemerkung' },
      ],
    },
  ],
}

const roof: InstallationStructure = {
  operator: { name: ' Familie Berger ', address: 'Lindenweg 4, 68535 Edingen-Neckarhausen' },
  inverters: [
    {
      designation: 'WR 1',
      manufacturer: 'SMA',
      model: 'Sunny Tripower 8.0',
      serialNumber: '3001234567',
      ratedPowerW: 8000,
    },
    {
      designation: 'WR 2',
      manufacturer: 'SMA',
      model: 'Sunny Boy 1.5',
      serialNumber: null,
      ratedPowerW: 1500,
    },
  ],
  modules: Array.from({ length: 22 }, () => ({ ratedPowerW: 430 })),
  batteries: [
    {
      designation: 'Speicher Keller',
      manufacturer: 'BYD',
      model: 'HVS 7.7',
      serialNumber: 'B-77-1',
    },
  ],
  meters: [
    {
      designation: 'Zweirichtungszähler',
      manufacturer: null,
      model: null,
      serialNumber: '1EMH0012345678',
    },
  ],
}

describe('a protocol that starts from the structure (#304)', () => {
  it('is a definition without problems', () => {
    expect(definitionProblems(commissioning)).toEqual([])
  })

  it('starts with the operator, the parts and the power of the system it is at', () => {
    expect(structureValues(commissioning, roof)).toEqual({
      operator: 'Familie Berger\nLindenweg 4, 68535 Edingen-Neckarhausen',
      inverters:
        'WR 1, SMA Sunny Tripower 8.0, Seriennummer 3001234567, 8 kW\nWR 2, SMA Sunny Boy 1.5, 1,5 kW',
      batteries: 'Speicher Keller, BYD HVS 7.7, Seriennummer B-77-1',
      meter: '1EMH0012345678',
      apparent_power: 9500,
      active_power: 9500,
      module_power: 9460,
      with_battery: true,
    })
  })

  it('leaves a power empty where a part names none, rather than a sum short of it', () => {
    const values = structureValues(commissioning, {
      ...roof,
      inverters: [
        ...roof.inverters,
        { ...roof.inverters[0]!, designation: 'WR 3', ratedPowerW: null },
      ],
      modules: [...roof.modules, { ratedPowerW: null }],
    })

    expect(values['apparent_power']).toBeUndefined()
    expect(values['active_power']).toBeUndefined()
    expect(values['module_power']).toBeUndefined()
  })

  it('says nothing where the structure is empty, and that there is no battery', () => {
    expect(
      structureValues(commissioning, {
        operator: null,
        inverters: [],
        modules: [],
        batteries: [],
        meters: [{ designation: 'Zähler', manufacturer: null, model: null, serialNumber: ' ' }],
      }),
    ).toEqual({ with_battery: false })
  })

  it('refuses a figure nobody knows, and one put in a field that cannot take it', () => {
    const wrong = (fromStructure: Readonly<Record<string, string>>) =>
      definitionProblems({
        ...commissioning,
        fromStructure: fromStructure as FormDefinition['fromStructure'],
      })

    expect(wrong({ operator: 'owner' })).toEqual([
      'probe-commissioning: operator nimmt owner aus der Struktur, das gibt es nicht.',
    ])
    expect(wrong({ remark: 'inverter_power' })).toEqual([
      'probe-commissioning: remark ist kein Feld, das inverter_power aus der Struktur aufnehmen kann.',
    ])
    expect(wrong({ module_power: 'inverter_power' })).toEqual([
      'probe-commissioning: module_power ist kein Feld, das inverter_power aus der Struktur aufnehmen kann.',
    ])
    expect(wrong({ missing: 'meters' })).toEqual([
      'probe-commissioning: missing ist kein Feld, das meters aus der Struktur aufnehmen kann.',
    ])
  })

  it('names kinds of installation only on a form of an installation, and only those there are', () => {
    const sentence =
      'probe-commissioning: die Arten der Anlage stehen nur an einem Formular einer Anlage, und jede gibt es.'

    expect(definitionProblems({ ...commissioning, attachesTo: 'appliance' })).toEqual([sentence])
    expect(
      definitionProblems({
        ...commissioning,
        installationKinds: [
          'pv_system',
          'windmill',
        ] as unknown as FormDefinition['installationKinds'],
      }),
    ).toEqual([sentence])
    expect(definitionProblems({ ...commissioning, installationKinds: [] })).toEqual([sentence])
  })
})

describe('a protocol that starts from the installation itself (#307)', () => {
  const charging: FormDefinition = {
    key: 'probe-charging',
    version: 1,
    title: 'Probe der Ladeeinrichtung',
    attachesTo: 'installation',
    installationKinds: ['wallbox', 'battery'],
    purpose: 'commissioning',
    fromStructure: {
      station: 'installation',
      power: 'rated_power',
      capacity: 'usable_capacity',
    },
    sections: [
      {
        key: 'plant',
        title: 'Anlage',
        fields: [
          { kind: 'text', key: 'station', label: 'Ladeeinrichtung' },
          { kind: 'number', key: 'power', label: 'Leistung', unit: 'kilowatt', decimals: 2 },
          {
            kind: 'number',
            key: 'capacity',
            label: 'Kapazität',
            unit: 'kilowatt_hour',
            decimals: 2,
          },
        ],
      },
    ],
  }
  const garage: InstallationStructure = {
    operator: null,
    inverters: [],
    modules: [],
    batteries: [],
    meters: [],
    installation: {
      designation: 'Wallbox Garage',
      manufacturer: 'Mennekes',
      model: 'Amtron 4Business',
      serialNumber: 'MA4B-1',
      ratedPowerW: 11_000,
      usableCapacityWh: 7680,
    },
  }

  it('is a definition without problems', () => {
    expect(definitionProblems(charging)).toEqual([])
  })

  it('starts with what the installation names: itself on a line, its power and its capacity', () => {
    expect(structureValues(charging, garage)).toEqual({
      station: 'Wallbox Garage, Mennekes Amtron 4Business, Seriennummer MA4B-1',
      power: 11_000,
      capacity: 7680,
    })
  })

  it('says nothing where the installation names nothing, nor a power that is no whole watt', () => {
    expect(
      structureValues(charging, {
        ...garage,
        installation: {
          designation: null,
          manufacturer: null,
          model: null,
          serialNumber: null,
          ratedPowerW: 1.5,
          usableCapacityWh: null,
        },
      }),
    ).toEqual({})
    expect(structureValues(charging, { ...garage, installation: null })).toEqual({})
  })

  it('sends only a protocol of the commissioning to the grid operator', () => {
    expect(definitionProblems({ ...charging, toGridOperator: true })).toEqual([])
    expect(definitionProblems({ ...charging, purpose: 'test', toGridOperator: true })).toEqual([
      'probe-charging: an den Netzbetreiber geht nur ein Protokoll der Inbetriebsetzung.',
    ])
  })
})
