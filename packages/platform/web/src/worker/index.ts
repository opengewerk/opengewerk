// The service worker of an application with two entry points (ADR 0004,
// ADR 0010): the shell of both precached, a navigation answered from the shell
// of its entry, push messages shown, and a new build taken when the page says
// so. What only an application knows, its name, its icon and the paths of its
// server, comes in as an argument.
export { serveShell } from './shell.js'
export type { ShellWorker, Workbox } from './shell.js'
