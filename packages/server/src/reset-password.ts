import { resetPasswordCommand } from '@opengewerk/platform-server'

import { access } from './authentication/access.js'
import { application } from './configuration.js'

// A new password for an account, from the command line (#126): the way back
// when no mail can bring a link. Every session of the account ends, the second
// factor stays. The password is asked for on the terminal and not shown, or
// comes from `OPENGEWERK_PASSWORD` in a script, and never as an argument.
//
//     docker compose -f docker/compose.yaml exec app node dist/reset-password.js <email>
//
// The command is the foundation's (ADR 0010); what this application adds is
// its name and its words.
await resetPasswordCommand(application, access)
