import { readFileSync } from 'node:fs'

/**
 * The template of the technical and organisational measures (#319), shipped
 * beside `dist` in `templates/`. Part A in it is what the page of the
 * contract on opengewerk.de reads as well. Read once; it changes only with
 * the version of the application.
 */
const location = new URL('../../templates/measures.md', import.meta.url)
let template: string | null = null

export function measuresTemplate(): string {
  template ??= readFileSync(location, 'utf8')

  return template
}
