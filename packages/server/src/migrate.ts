import { migrateCommand } from '@opengewerk/platform-server'

import { application } from './configuration.js'
import { migrationsFolder } from './database/migrations.js'

// Brings the database up to the current state, then exits. Its own command
// and its own container step, run before the application starts: it connects
// as the owner of the tables, and the application never does.
//
// The command is the foundation's (ADR 0010); what this application adds is
// its name for the sentences and the folder its migrations are in.
await migrateCommand(application, migrationsFolder)
