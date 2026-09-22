import { Controller, Get } from '@nestjs/common'

import { type Colleague, listColleagues } from '../authentication/administration.js'
import { Database } from '../database/database.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/**
 * What the tasks need beyond the rows themselves.
 *
 * The rows travel through the sync like every record a technician fills in:
 * a task is written and done on site as much as in the office, and both
 * without a network. What does not travel is who can be given one. The people
 * of a business live in the memberships and the accounts, which never go to a
 * device, and the staff list behind them is the owner's. So the names come
 * from here, with only what a task needs to know.
 */
@Controller('tasks')
export class TasksController {
  constructor(private readonly database: Database) {}

  /**
   * The people of this business by name, and which of them can still be
   * given a task. Everybody who reads tasks may ask, because a task names its
   * person and a key is not a name.
   */
  @Get('assignees')
  @RequiresPermission('task.read')
  assignees(@CurrentIdentity() identity: RequestIdentity): Promise<Colleague[]> {
    return listColleagues(this.database, identity)
  }
}
