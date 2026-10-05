import { tradeContacts } from '@opengewerk/domain'
import { ContactsPanel } from '@opengewerk/platform-web/office'
import type { ContactsPanelWords } from '@opengewerk/platform-web/office'

import { type ContactParent, contactWords } from '../../app/contacts.js'
import { useMay } from '../../app/queries.js'

/** What the card says where its words name this application's own things. */
const panelWords: ContactsPanelWords = {
  ...contactWords,
  needsConnection: 'Stammdaten werden nur mit Verbindung geändert. Gerade ist keine da.',
  removal:
    'Danach steht der Ansprechpartner hier nicht mehr, auch nicht auf den Geräten der Baustelle.',
}

/**
 * The contacts at a customer, a site or a supplier (#296), on its screen in
 * the office (#121), as `contacts_card()` of the canvas draws them (#219): the
 * card of the foundation (opengewerk-haustechnik#85), told what a contact
 * hangs on here and who may keep one.
 *
 * Creating is the customer's right to create, changing and removing its right
 * to write, the same pair the sync asks for a contact; at a supplier both are
 * the right to keep suppliers. Changing and removing go straight to the
 * server, since master data is corrected with a connection (ADR 0005).
 */
export function ContactsSection({
  parent,
  empty,
}: {
  readonly parent: ContactParent
  readonly empty: string
}) {
  // The people of a supplier are the supplier's (#296): whoever keeps the
  // suppliers adds and corrects them, not whoever may add a customer on site.
  const ofSupplier = 'supplierId' in parent
  const createsForCustomers = useMay('customer.create')
  const correctsForCustomers = useMay('customer.write')
  const keepsSuppliers = useMay('supplier.write')

  return (
    <ContactsPanel
      parent={parent}
      rules={tradeContacts}
      words={panelWords}
      creates={ofSupplier ? keepsSuppliers : createsForCustomers}
      corrects={ofSupplier ? keepsSuppliers : correctsForCustomers}
      empty={empty}
    />
  )
}
