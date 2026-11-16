import { afterEach, describe, expect, it, vi } from 'vitest';
import { dayInZone, formatTime } from '../metrics/format';
import { withTimeZone } from '../test/timeZone';
import { browserTimeZone, formatInstant } from './instant';

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

describe('formatInstant', () => {
  withTimeZone('Europe/Paris');

  it('écrit l’instant dans le fuseau du navigateur, en français ou en anglais (heures sur 24 h)', () => {
    expect(formatInstant(NOON_UTC).replace(/[\u202f\u00a0]/g, ' ')).toBe('1 juil. 2026, 14:00');
    expect(formatInstant(NOON_UTC, 'en')).toBe('Jul 1, 2026, 14:00');
    expect(formatInstant('2026-03-01T22:05:00Z', 'en')).toBe('Mar 1, 2026, 23:05');
    // Le lendemain à Paris : le jour, le mois et l'heure sont ceux du calendrier local.
    expect(formatInstant('2026-10-05T22:05:00Z', 'en')).toBe('Oct 6, 2026, 00:05');
    expect(formatInstant('2026-12-31T23:30:00Z', 'en')).toBe('Jan 1, 2027, 00:30');
  });

  it('ne dit rien d’un instant illisible', () => {
    expect(formatInstant('n’importe quoi', 'en')).toBe('');
  });
});

describe('formatInstant en anglais, dans un fuseau décalé d’une demi-heure (Kolkata)', () => {
  withTimeZone('Asia/Kolkata');

  it('écrit les minutes du fuseau', () => {
    expect(formatInstant('2026-10-05T12:00:00Z', 'en')).toBe('Oct 5, 2026, 17:30');
  });
});
