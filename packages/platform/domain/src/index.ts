// The foundation without I/O (ADR 0010): what every application of the
// organisation is built on, and nothing that only one of them knows. No
// customer and no document, no property and no obligation: an application
// brings those and hands them in where a mechanism here needs a list.
//
// The same rule as in `domain` holds: no frameworks, no clock, no network.
// It has to give the same answer in the browser and on the server.
export * from './model/attachment.js'
export * from './model/audit.js'
export * from './model/audit-log.js'
export * from './model/backup.js'
export * from './model/calendar.js'
export * from './model/contact.js'
export * from './model/file.js'
export * from './model/identifier.js'
export * from './model/identity.js'
export * from './model/instance.js'
export * from './model/invitation.js'
export * from './model/mail-server.js'
export * from './model/number-range.js'
export * from './model/passkey.js'
export * from './model/paths.js'
export * from './model/push.js'
export * from './model/rights.js'
export * from './model/signature.js'

// The deadline engine: kinds as data, checked against the sources and actions
// an application hands in, and what a tenant sets for a kind. Which sources
// there are and what an action does is the application's business.
export * from './deadlines/deadline.js'

// The form engine: definitions as data with versions, values, their checks
// and the verdict on a measured value. What a figure is counted in, what a
// group repeats over and which limits are worked out the application says
// (`formEngine`), and what a filled form hangs on is its own.
export * from './forms/definition.js'
export * from './forms/engine.js'
export * from './forms/values.js'

// The rule engine: records with a period of validity and the paragraph they
// come from. Which rules there are is the application's business.
export * from './rules/rule.js'

// What travels between a device and the server, what the server keeps of it,
// and what a rule about it means. Which records travel, and under which
// rules, the application says, and makes its rules from that list.
export * from './sync/conflict.js'
export * from './sync/operation.js'
export * from './sync/policy.js'
export * from './sync/record.js'
export * from './sync/rules.js'
