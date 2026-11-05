import { afterEach, describe, expect, it, vi } from 'vitest';
import { dayInZone, formatTime } from '../metrics/format';
import { withTimeZone } from '../test/timeZone';
import { browserTimeZone } from './instant';

/** Un oracle indépendant du code testé : un nom est un fuseau si `Intl` en construit un. */
function isZone(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** Midi UTC un jour d'été : 14 h à Paris, 21 h à Tokyo, midi pour `Date` quand elle compte en UTC. */
const NOON_UTC = '2026-07-01T12:00:00.000Z';

/**
 * bdesk-38k.48 : le moteur nomme « Etc/Unknown » le fuseau d'un navigateur lancé avec TZ vide, et `Intl` refuse ce nom ; quand il ne sait pas
 * nommer le fuseau (`Invalid/Zone`), il ne rend aucun nom, alors que le type dit `string`. La page donne ce nom au domaine et au serveur :
 * il doit toujours être un fuseau que `Intl` construit.
 */
describe('browserTimeZone', () => {
  describe('un fuseau que le moteur nomme', () => {
    withTimeZone('Asia/Tokyo');

    it('le rend tel quel', () => {
      expect(browserTimeZone()).toBe('Asia/Tokyo');
    });
  });

  describe.each(['', ':', 'Etc/Unknown'])('TZ=%j : le moteur nomme le fuseau « Etc/Unknown », que Intl refuse', (tz) => {
    withTimeZone(tz);

    it('rend UTC, un fuseau que Intl construit', () => {
      expect(isZone(Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(false); // la panne de départ
      expect(browserTimeZone()).toBe('UTC');
    });

    it('compte comme Date, qui est en UTC quand TZ est vide ou inconnu', () => {
      expect(new Date(NOON_UTC).getHours()).toBe(12);
      expect(formatTime(NOON_UTC, browserTimeZone())).toBe('12:00');
      expect(dayInZone(NOON_UTC, browserTimeZone())).toBe('2026-07-01');
    });
  });

  describe('TZ=Invalid/Zone : un fuseau que le moteur ne sait pas nommer', () => {
    withTimeZone('Invalid/Zone');

    it('rend un fuseau que Intl construit, et où il est la même heure que pour Date', () => {
      expect(isZone(browserTimeZone())).toBe(true);
      expect(formatTime(NOON_UTC, browserTimeZone())).toBe(`${new Date(NOON_UTC).getHours()}:00`);
    });
  });

  describe('un moteur qui ne rend aucun nom (il rend undefined, et non « Etc/Unknown »)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('rend UTC, jamais undefined', () => {
      vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: undefined } as unknown as Intl.ResolvedDateTimeFormatOptions);

      expect(browserTimeZone()).toBe('UTC');
    });
  });
});
