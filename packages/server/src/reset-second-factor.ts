import { resetSecondFactorCommand } from '@opengewerk/platform-server'

import { application } from './configuration.js'

// Takes every second factor of an account away, from the command line (N6 of
// the security audit): the way back for whoever has lost the only one and
// works for more than one business, or runs the instance, which the owner of
// a business may not do for them, and for the owner of the only business
// there is. The app and every passkey go, every session ends, the password
// stays; every business the account works in has it in its log.
//
//     docker compose -f docker/compose.yaml exec app node dist/reset-second-factor.js <email>
//
// The command is the foundation's (ADR 0010); what this application adds is
// its name.
await resetSecondFactorCommand(application)
