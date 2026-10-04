/**
 * One step of the path over a screen: a record or a place the screen stands
 * under, where it leads and what it is called. The same in both entries, so
 * that an application says the path of a screen once and each entry draws it
 * in its own type.
 */
export interface Crumb {
  readonly to: string
  readonly label: string
}
