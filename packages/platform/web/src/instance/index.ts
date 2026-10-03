// The area of the instance, as an entry of its own:
// `@opengewerk/platform-web/instance`.
//
// What belongs to an instance and to none of the tenants on it, for whoever
// runs it (#188): the tenants on it, what holds for all of them, who runs it,
// and its log. Not an office of a tenant, so it has a frame of its own. An
// application lists the screens of the area in its navigation, by its own
// words, and mounts the frame as the route over them at `/instanz`.

// The frame of the area, with the door for whoever may not enter, and the
// frame of one of its screens.
export { InstanceFrame, InstancePage } from './frame.js'
export type { InstanceEntry } from './frame.js'

// The screens of the area. Its log is drawn from the pieces of the change log
// of a tenant.
export { InstanceLogScreen } from './log.js'
export { InstanceOperatorsScreen } from './operators.js'
export { InstanceSettingsScreen } from './settings.js'
export { InstanceTenantsScreen } from './tenants.js'
