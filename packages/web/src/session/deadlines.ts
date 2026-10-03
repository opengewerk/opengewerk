import type { CustomerId, DeadlineAction, DeadlineSource } from '@opengewerk/domain'
import type {
  DeadlineKindView as FoundationDeadlineKindView,
  DeadlineView as FoundationDeadlineView,
} from '@opengewerk/platform-web/office'

/**
 * The deadlines of the business (#283) as this application reads them. The
 * routes and the screens are the foundation's (ADR 0010,
 * opengewerk-haustechnik#24); what a deadline of this application says beside
 * what every one says is here: the trade of its kind, its source as a document
 * or an installation, and the customer, site, job and task it hangs on.
 */

/** One deadline as the list "Fristen" reads it. */
export interface DeadlineView extends Omit<FoundationDeadlineView, 'source'> {
  readonly trade: string | null
  readonly source: {
    readonly label: string
    readonly documentId: string | null
    readonly installationId: string | null
  }
  readonly customer: { readonly id: CustomerId | string; readonly name: string } | null
  readonly siteId: string | null
  readonly jobId: string | null
  readonly taskId: string | null
}

/** A kind with what the business has set for it, with the trade it comes from. */
export interface DeadlineKindView extends FoundationDeadlineKindView {
  readonly trade: string | null
  readonly source: DeadlineSource
  readonly actions: readonly DeadlineAction[]
}
