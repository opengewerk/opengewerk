/**
 * A text a person typed, made safe to stand in Markdown that a document is
 * made from: every mark escaped, every run of white space one space, so that
 * a name, a label or a sentence of the business never becomes a heading, a
 * list, a table, a link or strong text in the printed document.
 */
export function plainInMarkdown(value: string): string {
  return value.replace(/[\\`*_[\]|<>#]/g, (mark) => `\\${mark}`).replace(/\s+/g, ' ')
}
