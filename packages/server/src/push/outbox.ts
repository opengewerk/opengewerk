import { pushStore } from '@opengewerk/platform-server'

import { push } from '../database/schema/index.js'

/**
 * The devices and messages of push of this application, kept by the
 * foundation (ADR 0010): whom a message reaches, once per cause and device,
 * and when it is tried again or given up on is the same for every
 * application. The entries and occasions are this application's.
 */
export const pushes = pushStore(push)

export type { PushDevice, PushRow } from '@opengewerk/platform-server'
