// The files in the records of an application, as an entry of its own:
// `@opengewerk/platform-web/attachments`.
//
// What both entries of an application share about a file, whatever they draw
// around it: what becomes of a chosen file before anything is queued (a photo
// made smaller, a preview for a list, the bytes kept on the device and sent
// ahead of the record), a new file and a new version through the outbox, the
// versions of each file newest first, the preview of one as the device holds
// or fetches it, opening one, and the line under its name.
//
// What a file hangs on, who may add, replace or remove one and how a list of
// them is drawn are the application's; its rules are the ones its sync asks
// as well (`attachmentRules`).

export {
  addAttachment,
  addVersion,
  openVersion,
  prepareVersion,
  usePreview,
  useVersions,
  versionLine,
  versionPath,
  versionsByAttachment,
} from './files.js'
export type { FilingOptions, PreparedVersion, ShrinkPicture } from './files.js'
export { shrinkPicture } from './pictures.js'
