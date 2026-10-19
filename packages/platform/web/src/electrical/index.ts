// The electrical and the PV structure, as an entry of its own:
// `@opengewerk/platform-web/electrical` (ADR 0014).
//
// What both entries of an application share about the structure below an
// installation: the forms of board, section, circuit and equipment and of
// inverter, string and module, reading a figure with its unit, the order of
// the parts, the groups and the lines that describe a part. What a board and
// an inverter hang on is the application's, which asks for them by the field
// that names it; the screens, their addresses and rights are its own as well.

export * from './electrical.js'
export * from './photovoltaic.js'
