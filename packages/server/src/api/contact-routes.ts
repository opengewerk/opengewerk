import { type Permission, tradeContacts } from '@opengewerk/domain'
import type { ContactRights, ContactRoutes } from '@opengewerk/platform-server'

import type { ContactParentColumns } from '../database/schema/contacts.js'
import { contacts } from '../database/schema/index.js'
import { requireReferences } from './references.js'

/**
 * The rights of the routes of the contacts, which are the customer's.
 *
 * A contact is part of it, the way the sync treats it as well: writing down
 * who opens the door is the same act as writing down whose door it is. So a
 * technician, who may create a customer on site, may create a contact there,
 * and correcting one is for whoever may correct the customer.
 */
export const contactRights: ContactRights<Permission> = {
  read: 'customer.read',
  create: 'customer.create',
  write: 'customer.write',
}

/**
 * The people to talk to at a customer or at a site (#121), and since #296 at
 * a supplier, on the routes of the foundation (opengewerk-haustechnik#85).
 * What a contact hangs on and who may keep one is said here.
 *
 * Creating goes through the outbox on the screens, since it has to work
 * without a network. Changing and removing come to the routes, because master
 * data is only corrected with a connection (ADR 0005).
 */
export const contactRoutes: ContactRoutes<
  Permission,
  'customerId' | 'siteId' | 'supplierId',
  ContactParentColumns
> = {
  table: contacts,
  rules: tradeContacts,
  // The people of a supplier are the supplier's (#296): whoever may keep the
  // suppliers keeps them, and a technician, who may add a contact to a
  // customer on site, may not add one to a supplier.
  parentRight: (field) => (field === 'supplierId' ? 'supplier.write' : null),
  // A parent that is gone, or that belongs to another business, is refused
  // with the field in the sentence: the key in the database would refuse a
  // record of another business with a sentence about a constraint, and a
  // record marked as deleted it would take.
  place: async ({ tx, parents, creating }) => {
    await requireReferences(tx, contacts, parents, creating)

    return undefined
  },
}
