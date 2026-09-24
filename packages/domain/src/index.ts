// Schemas, calculations, rules and deadlines. No I/O, no frameworks: this
// package has to produce the same result in the browser and on the server.
//
// The model below is the binding shape of the data. The storage side mirrors
// it and is checked against it by the compiler, so the two cannot drift apart
// unnoticed.
export * from './model/address.js'
export * from './model/attachment.js'
export * from './model/audit.js'
export * from './model/authorization.js'
export * from './model/contact.js'
export * from './model/customer.js'
export * from './model/backup.js'
export * from './model/document.js'
export * from './model/document-content.js'
export * from './model/document-line.js'
export * from './model/document-signature.js'
export * from './model/electrical.js'
export * from './model/file.js'
export * from './model/identifier.js'
export * from './model/installation.js'
export * from './model/instruction.js'
export * from './model/job.js'
export * from './model/letterhead.js'
export * from './model/mail-server.js'
export * from './model/mail-signature.js'
export * from './model/membership.js'
export * from './model/number-range.js'
export * from './model/payment.js'
export * from './model/payment-term.js'
export * from './model/photovoltaic.js'
export * from './model/site.js'
export * from './model/task.js'
export * from './model/time-entry.js'
export * from './model/tenant.js'
export * from './model/text-snippet.js'

// The form engine of section 1.3 (#78). The definitions come from the trade
// packages under `packages/gewerke/`; this is what reads and checks them.
export * from './forms/definition.js'
export * from './forms/limits.js'
export * from './forms/record.js'
export * from './forms/report-fields.js'
export * from './forms/values.js'

// The legal parameters. Not in the code: they sit in data packages with a
// period of validity and the paragraph they come from, and every question to
// them needs a date, so that a document is judged by the rules of its own time.
export * from './rules/cancellation.js'
export * from './rules/document-content.js'
export * from './rules/e-invoice.js'
export * from './rules/instructions.js'
export * from './rules/invoice.js'
export * from './rules/mandatory-details.js'
export * from './rules/outline.js'
export * from './rules/parameter.js'
export * from './rules/payment.js'
export * from './rules/rule.js'
export * from './rules/shipped.js'
export * from './rules/tax.js'
export * from './rules/working-time.js'

// The offline data layer. Rules, not storage: how an operation from a device
// is merged and when that is a conflict. Where the outbox physically sits is
// the client's business and comes with the interface that shows it.
export * from './sync/merge.js'
export * from './sync/operation.js'
export * from './sync/policy.js'
export * from './sync/record.js'
