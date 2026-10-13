// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { findingsAt } from './entry-check.js'

/**
 * What the check of the entries makes of what a browser was seen doing
 * (opengewerk-haustechnik#279). The browser itself is asked in the CI,
 * against the preview of an application.
 */

/** An entry that got over everything, as Chromium 153 was seen doing it on 13.10.2026. */
const good = {
  path: '/',
  guarded: true,
  entryOnce: { shown: 'stands', loads: 2, later: 2 },
  partOnce: { shown: 'stands', loads: 2, later: 2 },
  entryNever: { shown: 'says', loads: 2, later: 2, pressed: { shown: 'says', loads: 1 } },
}

describe('an entry whose script was cut off', () => {
  it('has nothing wrong with it where the page loaded itself anew once and stood, or said so', () => {
    expect(findingsAt(good)).toEqual([])
  })

  it('has nothing wrong with it either where it names no part, or got a part without loading anew', () => {
    expect(findingsAt({ ...good, partOnce: null })).toEqual([])
    expect(findingsAt({ ...good, partOnce: { shown: 'stands', loads: 1, later: 1 } })).toEqual([])
  })

  it('is a finding where the shell names no guard, and nothing else was asked', () => {
    expect(findingsAt({ path: '/', guarded: false })).toEqual([
      'die Seite nennt keine Wache vor ihrem Skript',
    ])
  })

  it('is a finding where the application does not stand after one failure', () => {
    expect(findingsAt({ ...good, entryOnce: { shown: null, loads: 1, later: 1 } })).toEqual([
      'das Skript des Einstiegs einmal nicht angekommen: die Anwendung steht danach nicht, die Seite bleibt leer',
    ])
    expect(findingsAt({ ...good, partOnce: { shown: 'says', loads: 2, later: 2 } })).toEqual([
      'ein Teil des Skripts einmal nicht angekommen: die Anwendung steht danach nicht, die Seite zeigt den Satz',
    ])
  })

  it('is a finding where the page loaded itself anew more than once, or again while it stood', () => {
    expect(findingsAt({ ...good, entryOnce: { shown: 'stands', loads: 3, later: 3 } })).toEqual([
      'das Skript des Einstiegs einmal nicht angekommen: die Seite lud 2 Mal von selbst neu statt höchstens einmal',
    ])
    expect(findingsAt({ ...good, entryOnce: { shown: 'stands', loads: 1, later: 2 } })).toEqual([
      'das Skript des Einstiegs einmal nicht angekommen: die Seite lud neu, obwohl sie schon stand',
    ])
  })

  it('is a finding where a script missing for good leaves the page empty', () => {
    expect(
      findingsAt({ ...good, entryNever: { shown: null, loads: 1, later: 1, pressed: null } }),
    ).toEqual([
      'das Skript des Einstiegs fehlt auf Dauer: die Seite zeigt den Satz nicht, sie bleibt leer',
    ])
  })

  it('is a finding where a script missing for good has the page load anew without end', () => {
    expect(
      findingsAt({
        ...good,
        entryNever: { shown: 'says', loads: 2, later: 9, pressed: { shown: 'says', loads: 1 } },
      }),
    ).toEqual([
      'das Skript des Einstiegs fehlt auf Dauer: die Seite lud 8 Mal von selbst neu statt einmal',
    ])
    expect(
      findingsAt({
        ...good,
        entryNever: { shown: 'says', loads: 1, later: 2, pressed: { shown: 'says', loads: 1 } },
      }),
    ).toEqual([
      'das Skript des Einstiegs fehlt auf Dauer: die Seite lud von selbst neu, nachdem sie den Satz schon zeigte',
    ])
    // Not once by itself either: the sentence at the first failure is a
    // reload a person has to do that the page could have done.
    expect(
      findingsAt({
        ...good,
        entryNever: { shown: 'says', loads: 1, later: 1, pressed: { shown: 'says', loads: 1 } },
      }),
    ).toEqual([
      'das Skript des Einstiegs fehlt auf Dauer: die Seite zeigt den Satz, ohne es einmal von selbst neu versucht zu haben',
    ])
  })

  it('is a finding where the button of the sentence does not load the page anew, once', () => {
    expect(
      findingsAt({
        ...good,
        entryNever: { shown: 'says', loads: 2, later: 2, pressed: { shown: 'says', loads: 0 } },
      }),
    ).toEqual([
      'das Skript des Einstiegs fehlt auf Dauer: der Knopf des Satzes lädt die Seite nicht neu',
    ])
    expect(
      findingsAt({
        ...good,
        entryNever: { shown: 'says', loads: 2, later: 2, pressed: { shown: null, loads: 4 } },
      }),
    ).toEqual([
      'das Skript des Einstiegs fehlt auf Dauer: nach dem Knopf lud die Seite 4 Mal und zeigt den Satz nicht wieder',
    ])
  })
})
