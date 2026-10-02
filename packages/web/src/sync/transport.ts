import {
  httpTransport,
  type PullResult,
  request,
  type SyncTransport,
} from '@opengewerk/platform-web/sync'

/**
 * The transport of the site (#286): the one of the foundation, and its pull
 * asks for the values of the ways into the sites of the open jobs its person
 * is assigned to, whatever their role (#447). The office entry never asks.
 * Any other value the owner and the office get on request, from the route
 * that keeps who saw it.
 */
export const siteTransport = (): SyncTransport => ({
  ...httpTransport,
  pull(since) {
    return request<PullResult>(`/sync?since=${String(since)}&access=values`)
  },
})
