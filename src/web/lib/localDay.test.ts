import { describe, expect, it } from 'vitest';
import { withTimeZone } from '../test/timeZone';
import { calendarDaysAgo, localDateFormat, startOfLocalDay } from './localDay';

const instant = (text: string) => Date.parse(text);
const iso = (ms: number) => new Date(ms).toISOString();
/**
 * Créés ici, à l'import du test, donc dans le fuseau de la machine : c'est ce que font les modules qui gardent leur écrivain.
 * Les blocs `withTimeZone` ci-dessous changent le fuseau ensuite.
 */
const writeDay = localDateFormat({ year: 'numeric', month: '2-digit', day: '2-digit' });
const writeDateTime = localDateFormat({ dateStyle: 'long', timeStyle: 'short' });
/** « 13/10/2026 » → les jours écoulés depuis une origine commune, pour compter l'écart entre deux jours écrits. */
const dayNumber = (written: string): number => {
  const [day, month, year] = written.split('/').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day) / 86_400_000;
};
/** Un instant en heure locale, tel que le navigateur le lit : `local(2026, 10, 23, 12)` est le 23 octobre 2026 à midi. */
const local = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number =>
  new Date(year, month - 1, day, hour, minute, second, ms).getTime();

describe('startOfLocalDay : le premier instant d’un jour calendaire du navigateur', () => {
  describe('à Paris', () => {
    withTimeZone('Europe/Paris');

    it('est minuit, heure locale, du jour de l’instant donné, quelle que soit l’heure', () => {
      // Lundi 26 octobre 2026, 10:00 à Paris. Minuit local : 23:00 UTC la veille (heure d'hiver depuis le 25).
      expect(iso(startOfLocalDay(instant('2026-10-26T09:00:00Z')))).toBe('2026-10-25T23:00:00.000Z');
      expect(startOfLocalDay(local(2026, 10, 26, 0))).toBe(local(2026, 10, 26, 0));
      expect(startOfLocalDay(local(2026, 10, 26, 23, 59, 59, 999))).toBe(local(2026, 10, 26, 0));
    });

    it('se décale en jours calendaires : le 25 octobre dure 25 h, le début de la veille n’est pas 24 h plus tôt', () => {
      const now = instant('2026-10-26T09:00:00Z');
      // Le 25 octobre commence à minuit heure d'été (22:00 UTC le 24), soit 25 h avant minuit du 26.
      expect(iso(startOfLocalDay(now, -1))).toBe('2026-10-24T22:00:00.000Z');
      expect(iso(startOfLocalDay(now, -2))).toBe('2026-10-23T22:00:00.000Z');
      expect(iso(startOfLocalDay(now, 1))).toBe('2026-10-26T23:00:00.000Z');
    });

    it('se décale aussi sur le jour de 23 h du 29 mars', () => {
      const now = instant('2026-03-30T08:00:00Z');
      expect(iso(startOfLocalDay(now))).toBe('2026-03-29T22:00:00.000Z');
      // Le 29 mars commence à minuit heure d'hiver (23:00 UTC le 28), soit 23 h avant minuit du 30.
      expect(iso(startOfLocalDay(now, -1))).toBe('2026-03-28T23:00:00.000Z');
      expect(iso(startOfLocalDay(now, -2))).toBe('2026-03-27T23:00:00.000Z');
    });
  });

  describe('à La Havane, où le changement d’heure tombe à minuit', () => {
    withTimeZone('America/Havana');

    it('minuit n’existe pas (00:00 saute à 01:00) : le jour commence au saut', () => {
      // Le dimanche 8 mars 2026, l'horloge saute de 00:00 à 01:00 : 05:00 UTC.
      expect(iso(startOfLocalDay(instant('2026-03-09T14:00:00Z'), -1))).toBe('2026-03-08T05:00:00.000Z');
    });

    it('minuit se répète (01:00 revient à 00:00) : le jour commence au premier minuit', () => {
      // Le dimanche 1er novembre 2026, 00:00 vient deux fois : la première à 04:00 UTC.
      expect(iso(startOfLocalDay(instant('2026-11-02T15:00:00Z'), -1))).toBe('2026-11-01T04:00:00.000Z');
    });
  });
});

describe('calendarDaysAgo : combien de jours calendaires séparent un instant de maintenant', () => {
  withTimeZone('Europe/Paris');

  it('vaut 0 le même jour, 1 la veille, 2 l’avant-veille, quelle que soit l’heure', () => {
    const now = local(2026, 10, 23, 14);
    expect(calendarDaysAgo(local(2026, 10, 23, 0), now)).toBe(0);
    expect(calendarDaysAgo(local(2026, 10, 23, 13, 59), now)).toBe(0);
    expect(calendarDaysAgo(local(2026, 10, 22, 23, 59), now)).toBe(1);
    expect(calendarDaysAgo(local(2026, 10, 22, 0), now)).toBe(1);
    expect(calendarDaysAgo(local(2026, 10, 21, 23, 59), now)).toBe(2);
    expect(calendarDaysAgo(local(2026, 10, 10, 0), now)).toBe(13);
  });

  it('ne compte pas en tranches de 24 h : 35 h plus tôt, ce peut être avant-hier', () => {
    // Le 4 novembre à 10:00, une clôture du 2 à 23:00 date de 35 h (une seule tranche de 24 h) mais de deux jours.
    expect(calendarDaysAgo(local(2026, 11, 2, 23), local(2026, 11, 4, 10))).toBe(2);
    // Deux minutes d'écart de part et d'autre de minuit : un jour.
    expect(calendarDaysAgo(local(2026, 11, 3, 23, 59), local(2026, 11, 4, 0, 1))).toBe(1);
  });

  it('le jour de 25 h (25 octobre 2026) reste un seul jour : 24 h 58 min entre 00:00:30 et 23:59', () => {
    const now = instant('2026-10-25T22:59:00Z'); // 23:59 heure d'hiver
    const then = instant('2026-10-24T22:00:30Z'); // 00:00:30 heure d'été, le même 25 octobre
    expect(now - then).toBeGreaterThan(24 * 3_600_000);
    expect(calendarDaysAgo(then, now)).toBe(0);
  });

  it('le jour de 23 h (29 mars 2026) compte pour un jour entier : 23 h 01 min peuvent séparer deux jours', () => {
    const now = instant('2026-03-29T22:00:00Z'); // 30 mars 00:00 heure d'été
    const then = instant('2026-03-28T22:59:00Z'); // 28 mars 23:59 heure d'hiver
    expect(now - then).toBeLessThan(24 * 3_600_000);
    expect(calendarDaysAgo(then, now)).toBe(2);
  });

  it('est négatif pour un jour à venir', () => {
    expect(calendarDaysAgo(local(2026, 10, 24, 1), local(2026, 10, 23, 23))).toBe(-1);
  });
});

describe('localDateFormat : écrire un instant comme le calendrier local le lit', () => {
  // Minuit de Paris, le 13 octobre, puis le 31 décembre à 23:30 UTC : le jour, l'année et l'heure qu'écrit un navigateur
  // dépendent de son fuseau. Attendus de `zoneinfo` (Python), pas du code testé.
  const midnightInParis = instant('2026-10-12T22:00:00Z');
  const newYearEve = instant('2025-12-31T23:30:00Z');
  const WRITTEN: Array<[zone: string, midnight: string, newYear: string]> = [
    ['UTC', '12 octobre 2026 à 22:00', '31 décembre 2025 à 23:30'],
    ['Europe/Paris', '13 octobre 2026 à 00:00', '1 janvier 2026 à 00:30'],
    ['Asia/Tokyo', '13 octobre 2026 à 07:00', '1 janvier 2026 à 08:30'],
    ['America/Los_Angeles', '12 octobre 2026 à 15:00', '31 décembre 2025 à 15:30'],
    ['Pacific/Chatham', '13 octobre 2026 à 11:45', '1 janvier 2026 à 13:15'], // UTC+13:45
  ];

  describe.each(WRITTEN)('dans le fuseau %s', (zone, midnight, newYear) => {
    withTimeZone(zone);

    it('écrit l’heure de ce fuseau, même si l’écrivain a été créé dans un autre', () => {
      expect(writeDateTime(midnightInParis)).toBe(midnight);
    });

    it('écrit aussi l’année de ce fuseau, au passage du nouvel an', () => {
      expect(writeDateTime(newYearEve)).toBe(newYear);
    });
  });

  describe('à Paris', () => {
    withTimeZone('Europe/Paris');

    it('accepte un instant en millisecondes ou une Date', () => {
      expect(writeDateTime(midnightInParis)).toBe('13 octobre 2026 à 00:00');
      expect(writeDateTime(new Date(midnightInParis))).toBe('13 octobre 2026 à 00:00');
    });

    it('écrit le dernier instant d’un jour et le premier du suivant', () => {
      expect(writeDay(local(2026, 10, 13, 23, 59, 59, 999))).toBe('13/10/2026');
      expect(writeDay(local(2026, 10, 14, 0))).toBe('14/10/2026');
    });

    it('lève comme Intl sur une date illisible : c’est à l’appelant de la tester avant', () => {
      expect(() => writeDay(Number.NaN)).toThrow(RangeError);
    });
  });
});

/**
 * Un jour est le même pour toute l'application : `then` est « n jours calendaires en arrière » exactement quand il tient
 * entre le minuit de ce jour-là et le suivant (`startOfLocalDay`, que la fenêtre de Terminé utilise). Rejoué dans des
 * fuseaux aux changements d'heure variés (minuit absent ou répété, demi-heure, UTC+14, UTC−11).
 */
describe.each([
  'UTC',
  'Europe/Paris',
  'America/Havana',
  'America/New_York',
  'Asia/Kolkata',
  'Australia/Lord_Howe',
  'Pacific/Auckland',
  'Pacific/Kiritimati',
  'Pacific/Pago_Pago',
])('à %s', (zone) => {
  withTimeZone(zone);

  // Des fenêtres qui contiennent un changement d'heure de ces fuseaux : fin octobre/début novembre, fin mars/début avril,
  // début mars et fin septembre/début octobre.
  const WINDOWS: [string, string][] = [
    ['2026-10-20T00:00:00Z', '2026-11-05T00:00:00Z'],
    ['2026-03-24T00:00:00Z', '2026-04-10T00:00:00Z'],
    ['2026-03-04T00:00:00Z', '2026-03-12T00:00:00Z'],
    ['2026-09-24T00:00:00Z', '2026-10-08T00:00:00Z'],
  ];
  const HOUR = 3_600_000;

  it('tient entre deux minuits locaux, au pas de 11 h pour maintenant et de 131 min pour l’instant', () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const [from, to] of WINDOWS) {
      for (let now = instant(from); now < instant(to); now += 11 * HOUR) {
        for (let then = now - 6.5 * 24 * HOUR; then <= now; then += 131 * 60_000) {
          const days = calendarDaysAgo(then, now);
          checked++;
          if (!(startOfLocalDay(now, -days) <= then && then < startOfLocalDay(now, -days + 1))) {
            wrong.push(`${iso(then)} vu de ${iso(now)} : ${days}`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(2_000);
    expect(wrong.slice(0, 5)).toEqual([]);
  });

  it('écrit le jour qui est compté : celui du minuit local de l’instant, et à l’écart `calendarDaysAgo` de maintenant', () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const [from, to] of WINDOWS) {
      for (let now = instant(from); now < instant(to); now += 11 * HOUR) {
        for (let then = now - 6.5 * 24 * HOUR; then <= now; then += 131 * 60_000) {
          checked++;
          const written = writeDay(then);
          if (written !== writeDay(startOfLocalDay(then))) wrong.push(`${iso(then)} : écrit ${written}, son minuit est ${writeDay(startOfLocalDay(then))}`);
          if (dayNumber(writeDay(now)) - dayNumber(written) !== calendarDaysAgo(then, now)) {
            wrong.push(`${iso(then)} vu de ${iso(now)} : écrit ${written}, compté ${calendarDaysAgo(then, now)} j`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(2_000);
    expect(wrong.slice(0, 5)).toEqual([]);
  });
});
