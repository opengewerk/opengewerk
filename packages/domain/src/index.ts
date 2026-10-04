// Schemas, calculations, rules and deadlines. No I/O, no frameworks: this
// package has to produce the same result in the browser and on the server.
//
// The model below is the binding shape of the data. The storage side mirrors
// it and is checked against it by the compiler, so the two cannot drift apart
// unnoticed.
//
// What every application of the organisation shares sits in the foundation
// (ADR 0010) and is handed on from here, so that server and interface keep
// asking one package.
export * from '@opengewerk/platform-domain'
export * from './model/address.js'
export * from './model/attachment.js'
export * from './model/audit-log.js'
export * from './model/authorization.js'
export * from './model/contact.js'
export * from './model/supplier.js'
export * from './model/article.js'
export * from './model/article-import.js'
export * from './model/customer.js'
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
export * from './model/mail-signature.js'
export * from './model/membership.js'
export * from './model/number-range.js'
export * from './model/payment.js'
export * from './model/payment-term.js'
export * from './model/installation-label.js'
export * from './model/photovoltaic.js'
export * from './model/push.js'
export * from './model/server-paths.js'
export * from './model/site.js'
export * from './model/site-access.js'
export * from './model/tag.js'
export * from './model/task.js'
export * from './model/time-entry.js'
export * from './model/job-note.js'
export * from './model/tenant.js'
export * from './model/text-snippet.js'

// The form engine of section 1.3 (#78). The engine is the foundation's
// (opengewerk-haustechnik#28); the definitions come from the trade packages
// under `packages/gewerke/`, and what is here binds the engine to the units,
// circuits and limits of this application.
export * from './forms/definition.js'
export * from './forms/limits.js'
export * from './forms/record.js'
export * from './forms/report-fields.js'
export * from './forms/values.js'
// The general shapes of the foundation go by the same names; these are the
// ones written with the units, circuits and limits of this application, and
// named here so that they are the ones handed on.
export {
  type BlockField,
  type FormDefinition,
  type FormField,
  type FormRegistry,
  type FormSection,
  type GroupField,
  type LimitSpec,
  type MeasurementField,
  type NumberField,
} from './forms/definition.js'
export { type FormValue, type FormValues, type GroupBlock, readFormValues } from './forms/values.js'

// The deadline engine of section 1.2 (#283): one record for everything that
// falls due. The kinds are data, from the core and from the trade packages.
export * from './deadlines/core.js'
export * from './deadlines/deadline.js'
// The kind, the registry and its factory share their names with the general
// ones of the foundation; these are the ones bound to the sources, actions and
// fields of this application, and named here so that they are the ones handed on.
export { type DeadlineKind, type DeadlineRegistry, deadlineRegistry } from './deadlines/deadline.js'

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
export * from './rules/shipped.js'
export * from './rules/tax.js'
export * from './rules/working-time.js'

// The offline data layer. Rules, not storage: how an operation from a device
// is merged and when that is a conflict. Where the outbox physically sits is
// the client's business and comes with the interface that shows it.
export * from './sync/merge.js'
export * from './sync/names.js'
export * from './sync/policy.js'
