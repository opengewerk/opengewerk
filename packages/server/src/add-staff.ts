import { addStaffCommand } from '@opengewerk/platform-server'

import { access } from './authentication/access.js'
import { application } from './configuration.js'

// Puts a person into a business from the command line: the way back when
// somebody has shut themselves out, and the only way on a machine without a
// browser. The password is asked for on the terminal and not shown, or comes
// from `OPENGEWERK_PASSWORD` in a script, and never as an argument.
//
//     docker compose -f docker/compose.yaml exec app \
//       node dist/add-staff.js <tenant-id> <email> <name> owner
//
// The command is the foundation's (ADR 0010); what this application adds is
// its name, its roles and its words.
await addStaffCommand(application, access)
