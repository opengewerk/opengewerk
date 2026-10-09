import { uuidv7 } from 'uuidv7'

/**
 * The key of a block of a repeating group, drawn on the device when somebody
 * opens one. A UUID of version 7 begins with the time it was drawn, so the
 * blocks of a group, which stand in the order of their keys, stand in the
 * order they were opened, on every device and on the server.
 */
export function newBlockKey(): string {
  return uuidv7()
}
