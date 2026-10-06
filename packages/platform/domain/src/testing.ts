// What the tests of the foundation share, as an entry of its own:
// `@opengewerk/platform-domain/testing`. Nothing a running application needs
// is in here.
//
// The material belongs to no application (ADR 0010). The packages of the
// foundation test a mechanism with it, the merge here, the sync client in the
// interface, so that none of them needs a record of a real application to be
// tested, and all of them mean the same records.
export { probePolicies } from './sync/probe-policies.js'
export { probeAttachmentRules } from './model/probe-attachments.js'
export { probeAuditVocabulary } from './model/probe-audit.js'
export { probeContactRules } from './model/probe-contacts.js'
