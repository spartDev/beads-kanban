import { describe, expect, it } from 'vitest';
import { canonicalTimeZone, FALLBACK_TIME_ZONE, isKnownTimeZone } from './time-zone';

describe('isKnownTimeZone', () => {
  it.each(['UTC', 'Europe/Paris', 'America/New_York', 'Asia/Kolkata', 'Etc/UTC', 'europe/paris'])('reconnaît %s', (name) => {
    expect(isKnownTimeZone(name)).toBe(true);
  });

  // « Etc/Unknown » est ce que le moteur répond pour une variable TZ vide (Node 18 à 25) ; `Intl` refuse ce nom.
  it.each(['Etc/Unknown', 'Invalid/Zone', 'Europe/Pariss', '', ':', ':/etc/localtime', ' UTC'])('refuse %j', (name) => {
    expect(isKnownTimeZone(name)).toBe(false);
  });

  // `Intl.DateTimeFormat().resolvedOptions().timeZone` est typé `string` mais vaut `undefined` quand le moteur ne sait pas
  // nommer le fuseau (`TZ=Invalid/Zone`) : `new Intl.DateTimeFormat('en-US', { timeZone: undefined })` ne lève rien, et pourtant
  // `undefined` n'est pas un nom de fuseau.
  it.each([undefined, null, 0, 42, {}, ['UTC']])('refuse ce qui n’est pas un texte : %j', (value) => {
    expect(isKnownTimeZone(value)).toBe(false);
  });
});

/**
 * bdesk-38k.48, relecture : `Intl` accepte un nom quelle que soit sa casse, et en garde plusieurs pour un même fuseau (`utc`, `Etc/UTC`, `UTC`).
 * Qui s'en sert comme clé (les formateurs du domaine, la réponse de l'API) en aurait autant que de façons de l'écrire.
 */
describe('canonicalTimeZone : un fuseau, un seul nom', () => {
  it.each([
    ['Europe/Paris', 'Europe/Paris'],
    ['europe/paris', 'Europe/Paris'],
    ['EUROPE/PARIS', 'Europe/Paris'],
    ['eUrOpE/pArIs', 'Europe/Paris'],
    ['utc', 'UTC'],
    ['Etc/UTC', 'UTC'],
    ['etc/utc', 'UTC'],
  ])('%s devient %s', (name, canonical) => {
    expect(canonicalTimeZone(name)).toBe(canonical);
  });

  it('rend le même nom pour toutes les casses d’un fuseau, et ce nom est un fuseau que le moteur accepte tel quel', () => {
    const casings = ['Asia/Tokyo', 'asia/tokyo', 'ASIA/TOKYO', 'aSiA/tOkYo', 'asia/TOKYO'];
    const names = new Set(casings.map((name) => canonicalTimeZone(name)));

    expect(names.size).toBe(1);
    const [only] = [...names];
    expect(canonicalTimeZone(only)).toBe(only); // idempotent
    expect(isKnownTimeZone(only)).toBe(true);
  });

  it.each(['Etc/Unknown', 'Mars/Phobos', 'Europe/Pariss', '', ':', ' UTC', 'UTC '])('ne rend rien pour %j : le moteur ne le connaît pas', (name) => {
    expect(canonicalTimeZone(name)).toBeUndefined();
  });

  it.each([undefined, null, 0, 42, {}, ['UTC']])('ne rend rien pour ce qui n’est pas un texte : %j', (value) => {
    expect(canonicalTimeZone(value)).toBeUndefined();
  });
});

describe('FALLBACK_TIME_ZONE', () => {
  it('est UTC, un fuseau que tous les moteurs connaissent et qui ne change jamais d’heure', () => {
    expect(FALLBACK_TIME_ZONE).toBe('UTC');
    expect(isKnownTimeZone(FALLBACK_TIME_ZONE)).toBe(true);
  });
});
