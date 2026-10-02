// What stands between opening an application and working in it, and the way
// out again, as an entry of its own: `@opengewerk/platform-web/gate`.
//
// The three questions of ADR 0006 in the order they are asked, with the steps
// in front of the first one: the first run of an empty instance, the link of
// an invitation, the link to a new password. None of it names a product or
// says what a tenant is called: the application says that once, with the
// value it puts over its tree (`ApplicationProvider`, ADR 0010), and the gate
// stands inside of it.

// The gate itself. An application puts its screens inside and nothing else:
// they are drawn once there is an account, a tenant and a running sync client.
export { Boot } from './boot.js'

// The frame of a step, for a step an application has of its own before its
// first screen.
export { Gate, GateText, GateWaiting } from './frame.js'

// The steps, each a screen of its own. `Boot` shows them in their order; they
// are here for a test of an application that looks at one of them with its
// own words in it.
export { InvitationScreen } from './invitation.js'
export { PasswordResetScreen } from './password-reset.js'
export { SecondFactorSetupScreen, SetupScreen } from './setup.js'
export { SecondFactorScreen, SignInScreen, TenantScreen } from './sign-in.js'

// The setup of a second factor without a frame, for where an account sets one
// up later, and the way out, for a header, a menu and an account.
export { SecondFactorSetup } from './setup.js'
export { SignOutButton } from './sign-out.js'
