import { legalAddress } from './session.js'

/**
 * What a person reads before push is turned on (opengewerk-haustechnik#390).
 * A message goes through the push service of the maker of the browser, and
 * all four of them sit in the USA. Two of them are not certified under the
 * EU-US Data Privacy Framework, so for them turning push on is the consent of
 * Art. 49 Abs. 1 lit. a GDPR, and that holds only where the person was told of
 * the risk before. The content goes encrypted (RFC 8291); the service sees
 * when a message goes to the device, and not what it says.
 */
export const pushNotice =
  'Push-Nachrichten gehen über den Push-Dienst des Browser-Herstellers: Google bei Chrome und Android, Microsoft bei Edge, Apple bei Safari, Mozilla bei Firefox. Alle vier haben ihren Sitz in den USA. Den Inhalt kann der Dienst nicht lesen, er ist verschlüsselt; er sieht aber, wann eine Nachricht an dieses Gerät geht. Apple und Mozilla sind nicht nach dem EU-US Data Privacy Framework zertifiziert; bei ihnen können Behörden der USA zugreifen, ohne dass dieselben Rechtsbehelfe gelten wie in der EU. Mit dem Einschalten willigen Sie in diese Übermittlung ein.'

/** The notice on data protection of the instance, which the sentence points to. */
export const pushNoticeLink = {
  label: 'Datenschutzhinweise',
  href: legalAddress('privacy'),
} as const
