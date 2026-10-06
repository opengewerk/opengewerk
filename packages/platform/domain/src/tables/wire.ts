/**
 * How a table travels between a page and a route, named once for both ends.
 *
 * As the file somebody chose it goes as bytes, with its name in a header,
 * because a body of bytes has no other place for one. As a sheet with what
 * was decided about it it goes as JSON under a type of its own: such a body
 * is megabytes where every other is a form's worth, and under this type the
 * parser in front of the routes passes it by, so that it is read for whoever
 * may send it and for nobody else.
 */

/** The type of the request that carries the file of a table. */
export const tableFileType = 'application/octet-stream'

/** The header the name of that file travels in, written as `encodeURIComponent` writes it. */
export const tableFileNameHeader = 'x-file-name'

/** The type of a request that carries a sheet and what was decided about it. */
export const tableBodyType = 'application/x.table+json'
