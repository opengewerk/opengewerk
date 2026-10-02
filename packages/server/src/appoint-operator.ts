import { appointOperatorCommand } from '@opengewerk/platform-server'

import { access } from './authentication/access.js'
import { application } from './configuration.js'

// Names an operator of the instance from the command line (#188).
//
// The account of the first run setup is the first operator, and on an
// instance set up before there were operators, migration 0051 finds that
// account in the log of the first business. This is the way where it finds
// none, and the way back when every operator has lost their second factor.
// The account must exist already; its password stays as it is.
//
//     docker compose -f docker/compose.yaml exec app \
//       node dist/appoint-operator.js <email>
//
// The command is the foundation's (ADR 0010); what this application adds is
// its name and its words.
await appointOperatorCommand(application, access)
