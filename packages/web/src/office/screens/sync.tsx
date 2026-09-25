import { RefreshCw } from 'lucide-react'

import { Button, Panel } from '../../components/index.js'
import { NothingToDecide, SyncStateCard, useDecisions } from '../../app/conflicts.js'
import { useSync, useSyncStatus } from '../../sync/provider.js'
import { PageHead, RecordColumns, Screen } from '../kit.js'

/**
 * "Abgleich" in the office, the board "Abgleich und Konflikt" (#219): what is
 * to decide at the left, the state of the exchange in a column of 320 pixels
 * at the right, and "Jetzt abgleichen" in the head for whoever does not want
 * to wait for the next round.
 */
export function SyncScreen() {
  const client = useSync()
  const { exchanging } = useSyncStatus()
  const { drafted, cards, empty } = useDecisions()

  return (
    <Screen>
      <PageHead
        title="Abgleich"
        sub="Was dieses Gerät mit dem System abgleicht, und was zu entscheiden ist."
        wideActions
        actions={
          <Button
            icon={RefreshCw}
            disabled={exchanging}
            onClick={() => {
              void client.synchronise()
            }}
          >
            Jetzt abgleichen
          </Button>
        }
      />
      {drafted}
      <RecordColumns
        sideWidth={320}
        main={
          empty ? (
            <Panel title="Keine Konflikte">
              <NothingToDecide />
            </Panel>
          ) : (
            cards
          )
        }
        side={<SyncStateCard />}
      />
    </Screen>
  )
}
