import { describe, expect, it } from 'vitest';
import { withTimeZone } from '../test/timeZone';
import { formatAge, formatDateTime } from './relativeTime';

// Les libellés en jours suivent les jours calendaires du fuseau du navigateur : on choisit le fuseau, on ne le subit pas.
withTimeZone('Europe/Paris');

/** Midi UTC, soit 14:00 à Paris (l'heure d'été court jusqu'au 25) : l'absolu (« 5 sept. ») ne change pas de jour. */
const NOW = Date.parse('2026-10-23T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const before = (ms: number) => new Date(NOW - ms).toISOString();
/** Un instant en heure locale, tel que le navigateur le lit : `at(2026, 10, 23, 12)` est le 23 octobre 2026 à midi. */
const at = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0): string =>
  new Date(year, month - 1, day, hour, minute, second).toISOString();
/** ICU met une espace insécable fine entre le nombre et l'unité (« 3 j ») : on compare avec des espaces ordinaires. */
const clean = (text: string) => text.replace(/[\u202f\u00a0]/g, ' ');
const age = (iso: string, now = NOW) => clean(formatAge(iso, now));

describe('formatAge : l’âge d’un ticket, en français', () => {
  it('dit « à l’instant » sous la minute, et pour une date qui devance l’horloge', () => {
    expect(age(before(0))).toBe('à l’instant');
    expect(age(before(59_000))).toBe('à l’instant');
    expect(age(new Date(NOW + 5 * MIN).toISOString())).toBe('à l’instant');
  });

  it('compte en minutes puis en heures écoulées, tant que moins de 24 h ont passé', () => {
    expect(age(before(MIN))).toBe('il y a 1 min');
    expect(age(before(45 * MIN))).toBe('il y a 45 min');
    expect(age(before(HOUR))).toBe('il y a 1 h');
    expect(age(before(23 * HOUR + 59 * MIN))).toBe('il y a 23 h');
  });

  it('une clôture d’hier de moins de 24 h reste une durée (« il y a 11 h »), pas un jour', () => {
    // Le 23 octobre à 10:00 : une clôture du 22 à 23:00 date de 11 h.
    expect(age(at(2026, 10, 22, 23), Date.parse(at(2026, 10, 23, 10)))).toBe('il y a 11 h');
  });

  describe('au-delà de 24 h : les jours calendaires', () => {
    it('dit « hier » dès 24 h, et jusqu’à minuit de la veille', () => {
      expect(age(at(2026, 10, 22, 14))).toBe('hier'); // 24 h exactement
      expect(age(at(2026, 10, 22, 0))).toBe('hier'); // 38 h
    });

    it('dit « avant-hier » puis « il y a N j » quand le jour est celui-là, pas quand N × 24 h ont passé', () => {
      expect(age(at(2026, 10, 21, 23, 59))).toBe('avant-hier'); // 38 h 01 min : plus d'une tranche de 24 h, deux jours
      expect(age(at(2026, 10, 21, 0))).toBe('avant-hier');
      expect(age(at(2026, 10, 20, 23, 59))).toBe('il y a 3 j');
      expect(age(before(3 * DAY))).toBe('il y a 3 j');
      expect(age(at(2026, 10, 10, 0))).toBe('il y a 13 j'); // 13 j 14 h
    });

    it('une clôture d’avant-hier à 23:00, vue à 10:00, dit « avant-hier » : 35 h, mais deux jours', () => {
      const now = Date.parse(at(2026, 11, 4, 10));
      const closed = at(2026, 11, 2, 23);
      expect(now - Date.parse(closed)).toBe(35 * HOUR);
      expect(age(closed, now)).toBe('avant-hier');
    });

    it('le jour de 25 h (25 octobre 2026) : une clôture de 00:00:30 est « aujourd’hui » à 23:59, pas « hier »', () => {
      const now = Date.parse('2026-10-25T22:59:00Z'); // 23:59, heure d'hiver
      const closed = '2026-10-24T22:00:30Z'; // 00:00:30, heure d'été : le même 25 octobre
      expect(now - Date.parse(closed)).toBeGreaterThan(DAY); // 24 h 58 min 30 s
      expect(age(closed, now)).toBe('aujourd’hui');
    });

    it('autour du jour de 25 h, « hier » reste hier', () => {
      const now = Date.parse('2026-10-25T22:59:00Z'); // 25 octobre, 23:59
      expect(age('2026-10-24T21:59:00Z', now)).toBe('hier'); // 24 octobre, 23:59 : 25 h
      expect(age('2026-10-24T11:00:00Z', now)).toBe('hier'); // 24 octobre, 13:00
      expect(age('2026-10-23T21:59:00Z', now)).toBe('avant-hier'); // 23 octobre, 23:59
    });

    it('le week-end du changement d’heure : 47 h d’écart sont deux jours, pas un', () => {
      // Samedi 24 octobre à midi (heure d'été) vu le lundi 26 à 10:00 (heure d'hiver).
      const now = Date.parse(at(2026, 10, 26, 10));
      const closed = at(2026, 10, 24, 12);
      expect(now - Date.parse(closed)).toBe(47 * HOUR);
      expect(age(closed, now)).toBe('avant-hier');
    });

    it('le jour de 23 h (29 mars 2026) : 23 h 01 min restent une durée, 24 h et plus un jour du calendrier', () => {
      const now = Date.parse('2026-03-29T22:00:00Z'); // lundi 30 mars, 00:00 heure d'été
      expect(age('2026-03-28T22:59:00Z', now)).toBe('il y a 23 h'); // 28 mars, 23:59 : 23 h 01 min
      expect(age('2026-03-28T21:59:00Z', now)).toBe('avant-hier'); // 28 mars, 22:59 : 24 h 01 min
      expect(age('2026-03-29T21:59:00Z', now)).toBe('il y a 1 min'); // 29 mars, 23:59
    });

    it('ne dit jamais « hier » d’un événement d’aujourd’hui, à l’heure qu’il soit', () => {
      // Aujourd'hui = le 25 octobre 2026 (25 h). Toutes les clôtures de la journée, vues à 23:59 : jamais « hier ».
      const now = Date.parse('2026-10-25T22:59:00Z');
      for (let closed = Date.parse('2026-10-24T22:00:00Z'); closed <= now; closed += 7 * MIN) {
        expect(age(new Date(closed).toISOString(), now), new Date(closed).toISOString()).not.toBe('hier');
      }
    });
  });

  it('compte en semaines à partir de 14 jours calendaires, jusqu’à un mois', () => {
    expect(age(at(2026, 10, 9, 23, 59))).toBe('il y a 2 sem.'); // 13 j 14 h 01 min, mais 14 jours calendaires
    expect(age(before(14 * DAY))).toBe('il y a 2 sem.');
    expect(age(before(21 * DAY))).toBe('il y a 3 sem.');
    expect(age(before(29 * DAY))).toBe('il y a 4 sem.');
  });

  it('donne la date à partir de 30 jours calendaires, avec l’année si ce n’est pas la même', () => {
    expect(age(at(2026, 9, 24, 23, 59))).toBe('il y a 4 sem.');
    expect(age('2026-09-23T12:00:00Z')).toBe('23 sept.');
    expect(age('2026-09-05T12:00:00Z')).toBe('5 sept.');
    expect(age('2025-10-05T12:00:00Z')).toBe('5 oct. 2025');
  });

  it('ne dit rien d’une date illisible', () => {
    expect(age('n’importe quoi')).toBe('');
  });
});

describe('formatDateTime : la date complète, pour une infobulle', () => {
  it('écrit le jour en toutes lettres, avec l’heure', () => {
    expect(formatDateTime('2026-10-05T12:00:00Z')).toMatch(/^5 octobre 2026 à \d{2}:\d{2}$/);
  });

  it('ne dit rien d’une date illisible', () => {
    expect(formatDateTime('n’importe quoi')).toBe('');
  });
});

describe('les dates écrites suivent le fuseau courant, pas celui du chargement du module', () => {
  // Chaque ligne dit ce qu'écrit un navigateur réglé sur ce fuseau. Attendus de `zoneinfo` (Python), pas du code testé.
  // L'année de la date courte est celle de ce fuseau aussi : le 31 décembre à 23:30Z est déjà le 1er janvier à Paris et à Tokyo.
  const WRITTEN: Array<[zone: string, dateTime: string, shortDate: string, newYear: string]> = [
    ['UTC', '5 octobre 2026 à 12:00', '5 sept.', '31 déc. 2025'],
    ['Europe/Paris', '5 octobre 2026 à 14:00', '6 sept.', '1 janv.'],
    ['Asia/Tokyo', '5 octobre 2026 à 21:00', '6 sept.', '1 janv.'],
    ['America/Los_Angeles', '5 octobre 2026 à 05:00', '5 sept.', '31 déc. 2025'],
    ['Pacific/Chatham', '6 octobre 2026 à 01:45', '6 sept.', '1 janv.'], // UTC+13:45 : le lendemain
  ];

  describe.each(WRITTEN)('dans le fuseau %s', (zone, dateTime, shortDate, newYear) => {
    withTimeZone(zone);

    it('écrit la date complète de l’infobulle dans ce fuseau', () => {
      expect(formatDateTime('2026-10-05T12:00:00Z')).toBe(dateTime);
    });

    it('écrit la date de l’âge dans ce fuseau, avec l’année quand ce n’est pas celle de l’horloge', () => {
      expect(age('2026-09-05T23:30:00Z')).toBe(shortDate);
      expect(age('2025-12-31T23:30:00Z')).toBe(newYear);
    });
  });
});
