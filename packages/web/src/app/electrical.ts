import { useBoardsOf } from '@opengewerk/platform-web/electrical'

/**
 * The electrical structure below an installation, as this application binds
 * it. The forms and parts are the foundation's (ADR 0014) and come from here
 * as well, so that a screen asks one module; what is this application's is
 * that a board hangs on an installation, and where its circuit chart is.
 */
export * from '@opengewerk/platform-web/electrical'

/** The boards of an installation. */
export function useBoards(installationId: string | undefined) {
  return useBoardsOf('installationId', installationId)
}

/** The address of the chart, for a link that opens it: every board, or one. */
export function circuitChartAddress(installationId: string, boardId?: string): string {
  const base = `/installations/${encodeURIComponent(installationId)}/circuit-chart`

  return boardId === undefined ? base : `${base}?board=${encodeURIComponent(boardId)}`
}
