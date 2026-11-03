import { describe, expect, it } from 'vitest';
import { DEFAULT_DONE_DAYS } from './columns';
import { doneDayChoices, MAX_DONE_DAYS, parseColumn, parseDoneDays } from './params';

describe('parseDoneDays : ?done=<jours>', () => {
  it('lit un nombre entier de jours', () => {
    expect(parseDoneDays('7')).toBe(7);
    expect(parseDoneDays('30')).toBe(30);
    expect(parseDoneDays(String(MAX_DONE_DAYS))).toBe(MAX_DONE_DAYS);
  });

  it('retombe sur 14 jours pour tout le reste', () => {
    for (const value of [null, '', '0', '-3', '1.5', '2e1', 'abc', '14 jours', String(MAX_DONE_DAYS + 1), '99999999999']) {
      expect(parseDoneDays(value), String(value)).toBe(DEFAULT_DONE_DAYS);
    }
  });
});

describe('doneDayChoices : les durées proposées pour Terminé', () => {
  it('propose 7, 14, 30 et 90 jours', () => {
    expect(doneDayChoices(14)).toEqual([7, 14, 30, 90]);
  });

  it('ajoute à sa place la durée venue de l’adresse, pour que le réglage la montre', () => {
    expect(doneDayChoices(21)).toEqual([7, 14, 21, 30, 90]);
    expect(doneDayChoices(120)).toEqual([7, 14, 30, 90, 120]);
  });
});

describe('parseColumn : ?col=<colonne>', () => {
  it('reconnaît les cinq colonnes', () => {
    for (const column of ['backlog', 'ready', 'inProgress', 'blocked', 'done']) {
      expect(parseColumn(column)).toBe(column);
    }
  });

  it('ignore une colonne inconnue', () => {
    for (const value of [null, '', 'paused', 'Ready', 'en-cours', '__proto__', 'constructor']) {
      expect(parseColumn(value), String(value)).toBeNull();
    }
  });
});
