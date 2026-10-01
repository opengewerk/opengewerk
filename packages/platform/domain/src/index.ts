// The foundation without I/O (ADR 0010): what every application of the
// organisation is built on, and nothing that only one of them knows. No
// customer and no document, no property and no obligation: an application
// brings those and hands them in where a mechanism here needs a list.
//
// The same rule as in `domain` holds: no frameworks, no clock, no network.
// It has to give the same answer in the browser and on the server.
export * from './model/audit.js'
export * from './model/backup.js'
export * from './model/file.js'
export * from './model/identifier.js'
export * from './model/identity.js'
export * from './model/mail-server.js'
export * from './model/passkey.js'

// The rule engine: records with a period of validity and the paragraph they
// come from. Which rules there are is the application's business.
export * from './rules/rule.js'

// What travels between a device and the server, and what the server keeps of
// it. Which records travel, and under which rules, the application says.
export * from './sync/conflict.js'
export * from './sync/operation.js'
export * from './sync/record.js'
