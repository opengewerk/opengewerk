import type { RecordState } from '@opengewerk/domain'

import { DocumentState } from '../../components/index.js'
import { documentStatusOf } from '../../app/labels.js'

/** The state of a document as a list shows it: the marker alone, the number has its column. */
export function DocumentMarker({ document }: { readonly document: RecordState }) {
  return <DocumentState status={documentStatusOf(document)} />
}
