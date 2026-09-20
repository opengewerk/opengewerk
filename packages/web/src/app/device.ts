import { uuidv7 } from 'uuidv7'

const deviceKey = 'opengewerk.device'

/**
 * The identity of this device, minted once and kept.
 *
 * Per browser profile and not per business, although the server lists devices
 * per business. The thing being identified is the phone in the van: somebody
 * who works for two companies from one device is one device twice, and giving
 * them two identities would put two entries in two device lists for one thing
 * they could lose.
 *
 * It is what turns a session into a long one, so it is also what the sign in
 * hands over, and that is before any business is chosen and therefore before
 * the local store for one exists. Hence `localStorage` and not the store.
 *
 * A browser that refuses storage gets a fresh identity on every start. That is
 * a longer device list and nothing worse; refusing to run would be worse.
 */
export function deviceIdentity(storage: Storage | undefined = globalThis.localStorage): string {
  try {
    const held = storage?.getItem(deviceKey)

    if (held) {
      return held
    }

    const minted = uuidv7()

    storage?.setItem(deviceKey, minted)

    return minted
  } catch {
    return uuidv7()
  }
}
