import { Controller, Get } from '@nestjs/common'
import type { LegalTexts } from '@opengewerk/platform-domain'

import { PublicRoute } from '../api/authorization.js'
import { Database } from '../database/database.js'
import { readLegalTexts } from './legal-texts.js'

/**
 * The legal texts of the instance for anybody (opengewerk-haustechnik#129):
 * the foot of the sign in links to them, and the page they stand on is read
 * before signing in. So the route answers without an identity, with the two
 * texts and nothing else of the instance.
 *
 * A controller of its own and not a route of the area of the instance, so
 * that it is left out with the other ways in that need no identity: a closed
 * instance hands out nothing.
 */
@Controller('legal-texts')
export class LegalTextsController {
  constructor(private readonly database: Database) {}

  @Get()
  @PublicRoute()
  texts(): Promise<LegalTexts> {
    return readLegalTexts(this.database)
  }
}
