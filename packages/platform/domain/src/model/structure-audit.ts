import type { AuditPart, AuditTableWords, AuditTitleRule } from './audit-log.js'

// The words of the change log for the electrical and the PV structure (ADR
// 0014), for an application to take into its vocabulary with the tables it
// makes with `electricalSchema` and `photovoltaicSchema`. They are not among
// the tables of the foundation the log of every tenant keeps: an application
// makes the structure only once it needs it. What a board and an inverter
// hang on is the application's column, and so are its words, the part it
// makes of the structure and the reference to it.

/** What a row of each table of the structure is called, and the fields it names its own way. */
export const structureAuditTables: Readonly<Record<string, AuditTableWords>> = {
  board_sections: {
    label: 'Feld eines Verteilers',
    fields: { distribution_board_id: 'Verteiler' },
  },
  circuits: {
    label: 'Stromkreis',
    fields: {
      distribution_board_id: 'Verteiler',
      board_section_id: 'Feld',
      consumer: 'Verbraucher',
      overcurrent_device: 'Schutzeinrichtung',
      trip_characteristic: 'Charakteristik',
      rated_current_milli: 'Nennstrom',
      rcd_type: 'RCD-Typ',
      rated_residual_current_milli: 'Bemessungsdifferenzstrom',
      cable_type: 'Leitungstyp',
      cable_cores: 'Aderzahl',
      cable_cross_section_milli: 'Querschnitt',
      cable_length_milli: 'Leitungslänge',
      cable_installation_method: 'Verlegeart',
    },
  },
  distribution_boards: { label: 'Verteiler', fields: { location: 'Standort' } },
  equipment: { label: 'Betriebsmittel', fields: { circuit_id: 'Stromkreis' } },
  inverters: {
    label: 'Wechselrichter',
    fields: { rated_power_w: 'Nennleistung in W', mpp_inputs: 'MPP-Eingänge' },
  },
  pv_modules: {
    label: 'PV-Modul',
    fields: { pv_string_id: 'String', rated_power_w: 'Leistung in Wp' },
  },
  pv_strings: {
    label: 'String',
    fields: {
      inverter_id: 'Wechselrichter',
      mpp_input: 'MPP-Eingang',
      azimuth_deg: 'Ausrichtung in Grad',
      tilt_deg: 'Neigung in Grad',
    },
  },
}

/** The parts of a record of the structure: a board with its sections and circuits, and so on down. */
export const structureAuditParts: Readonly<Record<string, readonly AuditPart[]>> = {
  distribution_boards: [
    { table: 'board_sections', column: 'distribution_board_id' },
    { table: 'circuits', column: 'distribution_board_id' },
  ],
  circuits: [{ table: 'equipment', column: 'circuit_id' }],
  inverters: [{ table: 'pv_strings', column: 'inverter_id' }],
  pv_strings: [{ table: 'pv_modules', column: 'pv_string_id' }],
}

/** The fields of the structure that point at another part of it. */
export const structureAuditReferences: Readonly<Record<string, string>> = {
  distribution_board_id: 'distribution_boards',
  board_section_id: 'board_sections',
  circuit_id: 'circuits',
  inverter_id: 'inverters',
  pv_string_id: 'pv_strings',
}

/** Where a part of the structure is named, field by field until one has a value. */
export const structureAuditTitles: Readonly<Record<string, AuditTitleRule>> = {
  circuits: ['designation', 'consumer'],
  equipment: ['designation', 'model'],
  pv_modules: ['model', 'serial_number'],
}
