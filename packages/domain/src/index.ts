// Schemas, calculations, rules and deadlines. No I/O, no frameworks: this
// package has to produce the same result in the browser and on the server.
//
// The model below is the binding shape of the data. The storage side mirrors
// it and is checked against it by the compiler, so the two cannot drift apart
// unnoticed.
export * from './model/address.js'
export * from './model/audit.js'
export * from './model/authorization.js'
export * from './model/contact.js'
export * from './model/customer.js'
export * from './model/document.js'
export * from './model/electrical.js'
export * from './model/identifier.js'
export * from './model/installation.js'
export * from './model/job.js'
export * from './model/number-range.js'
export * from './model/photovoltaic.js'
export * from './model/site.js'
export * from './model/tenant.js'

// The offline data layer. Rules, not storage: how an operation from a device
// is merged and when that is a conflict. Where the outbox physically sits is
// the client's business and comes with the interface that shows it.
export * from './sync/merge.js'
export * from './sync/operation.js'
export * from './sync/policy.js'
export * from './sync/record.js'
