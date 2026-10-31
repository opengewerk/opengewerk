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
  addressOffer,
  addressPath,
  addressToken,
  availableTenants,
  changeOwnAccount,
  changePassword,
  chooseTenant,
  confirmAddressLink,
  correctAccount,
  currentAccount,
  devices,
  discardCorrectedAddress,
  discardWaitingAddress,
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
  sendAddressLink,
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
  waitingAddress,
  withdrawInvitation,
} from './session.js'
export type {
  Account,
  AddressOffer,
  PendingAddress,
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

// Whether the person signed in runs the instance, and for whoever does, the
// area of the instance: its settings, who runs it, its log and its tenants.
export {
  appointOperator,
  createTenantFor,
  instanceAccess,
  instanceAccessQuery,
  instanceLog,
  instanceSettings,
  instanceTenants,
  operators,
  removeOperator,
  saveInstanceSettings,
} from './instance.js'
export type { CreatedForSomebody } from './instance.js'

// The change log of a tenant: a page of changes, the check of the chain, and
// the people it can be narrowed to.
export { auditChain, auditChanges, auditPeople, noAuditFilter } from './audit.js'
export type { AuditFilterView } from './audit.js'

// This device, and what a person calls one.
export { deviceIdentity } from './device.js'
export { deviceName } from './device-name.js'

// The cache for what is no synced record, and the questions every screen
// asks through it.
export {
  accountQuery,
  queries,
  QueryProvider,
  tenantsQuery,
  useRight,
  useRights,
} from './queries.js'
export { initialsOf, rolesInWords, useWho } from './who.js'
export type { Who } from './who.js'

// The mail server of a tenant: whether it sends mail, and for whoever may see
// it, the connection itself, never with its password.
export {
  checkMailServer,
  mailServer,
  mailStatus,
  removeMailServer,
  saveMailServer,
} from './mail.js'
export type {
  MailServer,
  MailServerCheck,
  MailServerInput,
  MailStatus,
  SavedMailServer,
} from './mail.js'

// Push on the devices of the person signed in: what the server knows of it,
// what this browser can take, and both kept in step. Which occasions there
// are and which entries a device subscribes from, the application names.
export {
  pushOverview,
  sendTestPush,
  setOccasion,
  subscribeDevice,
  unsubscribeDevice,
} from './push.js'
export type { BrowserSubscription, PushDeviceView, PushOccasionView, PushOverview } from './push.js'
export {
  browserSubscription,
  leavePush,
  pushBlocker,
  PushRefused,
  refreshPush,
  switchOff,
  switchOn,
} from './push-device.js'
export type { PushBlocker } from './push-device.js'
export { pushNotice, pushNoticeLink } from './push-notice.js'
export { usePush, usePushRefresh } from './push-state.js'
export type { PushState } from './push-state.js'

// The stores of the office and their stock (ADR 0011, opengewerk#298).
export {
  bookCount,
  bookReceipt,
  bookTransfer,
  keepArticle,
  movementsOf,
  newStore,
  removeStore,
  changeStore,
  storeOf,
  storesOf,
} from './stock.js'
export type { MovementPage, MovementRow, StockRow, StoreSummary, StoreWithStock } from './stock.js'
