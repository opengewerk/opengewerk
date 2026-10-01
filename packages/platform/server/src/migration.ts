// What a migration of an application is written with, as an entry of its own:
// `@opengewerk/platform-server/migration`. The building blocks of the
// foundation that no schema describes, and the tool that puts them around the
// first migration of a new application (ADR 0010, point 9).
//
// Used while a migration is written and by the tests that hold the result.
// Nothing a running instance loads: an instance runs the migrations of its
// application, and what is in here has long become one of them by then.
export * from './migration/blocks.js'
export * from './migration/guards.js'
export * from './migration/initial.js'
