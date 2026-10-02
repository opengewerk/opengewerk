import { addTenantCommand } from '@opengewerk/platform-server'

import { access } from './authentication/access.js'
import { application } from './configuration.js'

// Creates a further business on the instance from the command line (#142),
// with its owner. The operators do the same in the area of the instance, where
// the owner gets a link; here the owner is put in at once, with an account
// when there is none yet, as `add-staff` does it.
//
// The password of a new account is asked for on the terminal and not shown,
// or comes from `OPENGEWERK_PASSWORD`, never from an argument.
//
//     docker compose -f docker/compose.yaml exec app \
//       node dist/add-tenant.js "<name des betriebs>" <e-mail> "<name des inhabers>"
//
// The command is the foundation's (ADR 0010); what this application adds is
// its name, its roles and its words.
await addTenantCommand(application, access)
