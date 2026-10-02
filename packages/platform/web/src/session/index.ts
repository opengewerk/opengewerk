// Who is signed in, in which tenant, on which device and with which rights,
// as an entry of its own: `@opengewerk/platform-web/session`.
//
// The three questions of ADR 0006 as the interface asks them of the server,
// what a device keeps of the answers for a start without a network, and the
// two questions every screen asks: who is this, and may they do that. Which
// rights there are and what an application is called, the application says
// (ADR 0010).

// The account, the first run, the second factor, the tenants of an account,
// the devices it is signed in on, the people of a tenant, and the two links
// somebody reaches the gate with.
export {
  availableTenants,
  changePassword,
  chooseTenant,
  currentAccount,
  devices,
  instanceVersion,
  invitationOffer,
  invitationPath,
  invitationToken,
  invite,
  newRecoveryCodes,
  openInvitations,
  passwordResetPath,
  passwordResetToken,
  recoveryCodesLeft,
  redeemInvitation,
  requestPasswordReset,
  resetPassword,
  revokeDevice,
  revokeStaffDevice,
  runSetup,
  secretFrom,
  setBlocked,
  setRoles,
  setupNeeded,
  shortestPassword,
  signIn,
  signOut,
  staff,
  staffDevices,
  staffRoles,
  startSecondFactor,
  verifyRecoveryCode,
  verifySecondFactor,
  withdrawInvitation,
} from './session.js'
export type {
  Account,
  DeviceEntry,
  FirstRun,
  InvitationEntry,
  InvitationMail,
  InvitationOffer,
  InvitationState,
  SecondFactorStart,
  SignInOutcome,
  StaffEntry,
  TenantChoice,
} from './session.js'

// What a device keeps of the last answers, so that it opens in a basement.
export {
  forgetAccount,
  forgetSignIn,
  keptTenantsKey,
  rememberAccount,
  rememberedAccount,
  rememberedTenants,
  rememberTenants,
  unreachable,
} from './remembered.js'

// Passkeys: the list, adding one after confirming again, signing in with one.
export {
  addPasskey,
  passkeys,
  passkeysSupported,
  passkeyTrouble,
  reconfirm,
  removePasskey,
  renamePasskey,
  signInWithPasskey,
} from './passkeys.js'

// This device, and what a person calls one.
export { deviceIdentity } from './device.js'
export { deviceName } from './device-name.js'

// The cache for what is no synced record, and the questions every screen
// asks through it.
export { accountQuery, queries, QueryProvider, tenantsQuery, useRight } from './queries.js'
export { initialsOf, rolesInWords, useWho } from './who.js'
export type { Who } from './who.js'
