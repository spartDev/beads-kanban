import { describe, expect, it } from 'vitest';
import { dayInZone } from './format';
import {
  addDays,
  bandIndexAt,
  dayTicks,
  DURATION_STEPS,
  indexAt,
  integerTicks,
  logDomain,
  nearestPoint,
  pickTicks,
  placeTooltip,
  thinLabels,
} from './scales';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('integerTicks : des graduations entières pour des comptes de tickets', () => {
  it('pousse le haut de l’axe au prochain pas rond, sans dépasser le nombre de graduations demandé', () => {
    expect(integerTicks(7, 5)).toEqual([0, 2, 4, 6, 8]);
    expect(integerTicks(12, 5)).toEqual([0, 5, 10, 15]);
    expect(integerTicks(170, 6)).toEqual([0, 50, 100, 150, 200]);
    expect(integerTicks(219, 6)).toEqual([0, 50, 100, 150, 200, 250]);
  });

  it('garde un pas de 1 tant que les comptes sont petits', () => {
    expect(integerTicks(1, 5)).toEqual([0, 1]);
    expect(integerTicks(3, 5)).toEqual([0, 1, 2, 3]);
  });

  it('montre toujours un axe, même quand tout vaut 0', () => {
    expect(integerTicks(0, 5)).toEqual([0, 1]);
  });
});

describe('logDomain : le domaine d’un axe logarithmique de durées', () => {
  it('va de la graduation ronde qui précède la plus petite durée à celle qui suit la plus grande', () => {
    expect(logDomain([76_218, 5 * HOUR, 1_138_052_662])).toEqual([MIN, 14 * DAY]);
  });

  it('ne descend jamais sous la minute : une durée nulle ne se dessine pas sur une échelle logarithmique', () => {
    expect(logDomain([0, 2 * HOUR])[0]).toBe(MIN);
  });

  it('s’élargit autour d’une durée unique, pour que l’axe ait une étendue', () => {
    expect(logDomain([2 * HOUR])).toEqual([HOUR, 4 * HOUR]);
  });

  it('prend un domaine par défaut sans durée', () => {
    expect(logDomain([])).toEqual([MIN, DAY]);
  });

  it('suit une durée plus longue que la plus grande graduation', () => {
    expect(logDomain([500 * DAY])).toEqual([365 * DAY, 500 * DAY]);
  });

  it('a des graduations croissantes', () => {
    expect([...DURATION_STEPS].sort((a, b) => a - b)).toEqual([...DURATION_STEPS]);
  });
});

describe('pickTicks : des graduations assez espacées', () => {
  const position = (value: number) => Math.log(value / MIN) * 30; // 30 px par unité logarithmique

  it('garde celles du domaine, espacées d’au moins `gap` pixels', () => {
    const ticks = pickTicks(DURATION_STEPS, [MIN, 14 * DAY], position, 40);
    expect(ticks[0]).toBe(MIN);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(position(ticks[i]!) - position(ticks[i - 1]!)).toBeGreaterThanOrEqual(40);
    }
    expect(ticks.every((tick) => tick >= MIN && tick <= 14 * DAY)).toBe(true);
  });

  it('garde toutes les graduations du domaine quand la place ne manque pas', () => {
    expect(pickTicks([MIN, HOUR, DAY], [MIN, DAY], position, 10)).toEqual([MIN, HOUR, DAY]);
  });
});

describe('thinLabels : une étiquette sur n, régulièrement', () => {
  it('étiquette toutes les tranches quand la place suffit', () => {
    expect(thinLabels(3, 6)).toEqual([0, 1, 2]);
  });

  it('en saute régulièrement quand il y en a trop', () => {
    expect(thinLabels(30, 6)).toEqual([0, 5, 10, 15, 20, 25]);
    expect(thinLabels(7, 3)).toEqual([0, 3, 6]);
  });

  it('ne donne rien sans tranche, ni sans place', () => {
    expect(thinLabels(0, 6)).toEqual([]);
    expect(thinLabels(10, 0)).toEqual([]);
  });
});

describe('placeTooltip : une infobulle qui reste dans le graphique', () => {
  const bounds = { width: 300, height: 200 };
  const tooltip = { width: 80, height: 40 };

  it('se pose à droite du pointeur, centrée sur sa hauteur', () => {
    expect(placeTooltip({ pointer: { x: 100, y: 100 }, tooltip, bounds })).toEqual({ left: 112, top: 80 });
  });

  it('passe à gauche du pointeur quand la droite manque de place', () => {
    expect(placeTooltip({ pointer: { x: 280, y: 100 }, tooltip, bounds })).toEqual({ left: 188, top: 80 });
  });

  it('reste entre le haut et le bas', () => {
    expect(placeTooltip({ pointer: { x: 100, y: 5 }, tooltip, bounds }).top).toBe(0);
    expect(placeTooltip({ pointer: { x: 100, y: 199 }, tooltip, bounds }).top).toBe(160);
  });

  it('reste à gauche du bord quand elle ne tient d’aucun côté', () => {
    expect(placeTooltip({ pointer: { x: 40, y: 100 }, tooltip: { width: 280, height: 40 }, bounds }).left).toBe(0);
  });
});

describe('addDays : de l\u2019arithmétique de calendrier, sans fuseau', () => {
  it('passe les fins de mois, d\u2019année et les années bissextiles', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-27', 0)).toBe('2026-10-27');
    expect(addDays('2026-11-02', -6)).toBe('2026-10-27');
  });
});

describe('dayTicks : les graduations de l\u2019axe du temps d\u2019une période', () => {
  const period = { from: '2026-10-27', days: 7, timeZone: 'Europe/Paris' };
  const start = Date.UTC(2026, 9, 26, 23); // minuit à Paris le 27 octobre, heure d'hiver

  it('place une graduation par jour quand la place suffit, au début de chaque jour', () => {
    const ticks = dayTicks(period, 10);
    expect(ticks.map((tick) => tick.label)).toEqual(['27 oct.', '28 oct.', '29 oct.', '30 oct.', '31 oct.', '1 nov.', '2 nov.']);
    expect(ticks[0]).toMatchObject({ index: 0, time: start });
    expect(ticks[1]?.time).toBe(start + DAY);
  });

  it('saute des jours, régulièrement, quand la place manque', () => {
    expect(dayTicks(period, 4).map((tick) => tick.label)).toEqual(['27 oct.', '29 oct.', '31 oct.', '2 nov.']);
  });

  it('après le passage à l\u2019heure d\u2019hiver (25 octobre 2026), place chaque jour à son vrai minuit : un jour de 25 h ne décale pas les suivants d\u2019une heure', () => {
    const ticks = dayTicks({ from: '2026-10-22', days: 7, timeZone: 'Europe/Paris' }, 10);
    expect(ticks.map((tick) => new Date(tick.time).toISOString())).toEqual([
      '2026-10-21T22:00:00.000Z', // 22 oct., minuit heure d'été (UTC+2)
      '2026-10-22T22:00:00.000Z',
      '2026-10-23T22:00:00.000Z',
      '2026-10-24T22:00:00.000Z', // 25 oct., dernier minuit d'été : le jour dure 25 h
      '2026-10-25T23:00:00.000Z', // 26 oct., minuit heure d'hiver (UTC+1) : 24 h plus tard serait 22:00
      '2026-10-26T23:00:00.000Z',
      '2026-10-27T23:00:00.000Z',
    ]);
  });

  it('après le passage à l\u2019heure d\u2019été (29 mars 2026), de même : un jour de 23 h ne décale pas les suivants d\u2019une heure', () => {
    const ticks = dayTicks({ from: '2026-03-26', days: 7, timeZone: 'Europe/Paris' }, 10);
    expect(ticks.map((tick) => new Date(tick.time).toISOString())).toEqual([
      '2026-03-25T23:00:00.000Z', // 26 mars, minuit heure d'hiver (UTC+1)
      '2026-03-26T23:00:00.000Z',
      '2026-03-27T23:00:00.000Z',
      '2026-03-28T23:00:00.000Z', // 29 mars : le jour dure 23 h
      '2026-03-29T22:00:00.000Z', // 30 mars, minuit heure d'été (UTC+2) : 24 h plus tard serait 23:00
      '2026-03-30T22:00:00.000Z',
      '2026-03-31T22:00:00.000Z',
    ]);
  });

  it('lit le fuseau des métriques, pas celui du navigateur : à Los Angeles, un minuit tombe à 07:00 ou 08:00 UTC', () => {
    const ticks = dayTicks({ from: '2026-10-30', days: 5, timeZone: 'America/Los_Angeles' }, 10);
    expect(ticks.map((tick) => new Date(tick.time).toISOString())).toEqual([
      '2026-10-30T07:00:00.000Z', // heure d'été (UTC−7)
      '2026-10-31T07:00:00.000Z',
      '2026-11-01T07:00:00.000Z', // le 1er novembre, retour à l'heure d'hiver à 02:00 : le jour dure 25 h
      '2026-11-02T08:00:00.000Z', // UTC−8
      '2026-11-03T08:00:00.000Z',
    ]);
  });

  describe('chaque graduation est la première minute de son jour, dans le fuseau, changement d\u2019heure ou non', () => {
    // Un jour de changement d'heure au milieu de la période, y compris quand l'horloge change à minuit (La Havane) ou d'une
    // demi-heure (Lord Howe). `dayInZone` est l'oracle : il lit les jours autrement que `startOfDay`.
    const cases: [zone: string, from: string, days: number][] = [
      ['UTC', '2026-10-20', 14],
      ['Europe/Paris', '2026-10-20', 14],
      ['Europe/Paris', '2026-03-24', 14],
      ['America/Los_Angeles', '2026-10-28', 10],
      ['America/Los_Angeles', '2026-03-05', 10],
      ['America/Havana', '2020-03-05', 8], // minuit saute le 8 mars : le jour commence à 01:00
      ['America/Havana', '2020-10-29', 8], // minuit se répète le 1er novembre : le jour commence au premier minuit
      ['Australia/Lord_Howe', '2026-04-02', 8],
      ['Asia/Tokyo', '2026-10-20', 14],
    ];

    it.each(cases)('%s, %s, %i jours', (timeZone, from, days) => {
      const ticks = dayTicks({ from, days, timeZone }, days);
      expect(ticks).toHaveLength(days);
      for (const tick of ticks) {
        const day = addDays(from, tick.index);
        expect(dayInZone(new Date(tick.time).toISOString(), timeZone)).toBe(day);
        expect(dayInZone(new Date(tick.time - 1).toISOString(), timeZone)).toBe(addDays(day, -1));
      }
    });
  });
});

describe('indexAt et bandIndexAt : quel jour, quelle tranche sous le pointeur', () => {
  it('indexAt : le point le plus proche, quand les points sont régulièrement espacés de bord à bord', () => {
    // 7 points sur 300 px : un tous les 50 px.
    expect(indexAt(0, 300, 7)).toBe(0);
    expect(indexAt(24, 300, 7)).toBe(0);
    expect(indexAt(26, 300, 7)).toBe(1);
    expect(indexAt(300, 300, 7)).toBe(6);
  });

  it('indexAt : reste dans les bornes, et gère un seul point ou aucune largeur', () => {
    expect(indexAt(-40, 300, 7)).toBe(0);
    expect(indexAt(900, 300, 7)).toBe(6);
    expect(indexAt(120, 300, 1)).toBe(0);
    expect(indexAt(120, 0, 7)).toBe(0);
  });

  it('bandIndexAt : la tranche qui contient le pointeur, quand elles se partagent la largeur', () => {
    // 4 tranches sur 200 px : 50 px chacune.
    expect(bandIndexAt(0, 200, 4)).toBe(0);
    expect(bandIndexAt(49, 200, 4)).toBe(0);
    expect(bandIndexAt(50, 200, 4)).toBe(1);
    expect(bandIndexAt(200, 200, 4)).toBe(3);
    expect(bandIndexAt(-5, 200, 4)).toBe(0);
  });
});

describe('nearestPoint : le point sous le doigt', () => {
  const points = [
    { x: 10, y: 10 },
    { x: 100, y: 50 },
    { x: 104, y: 52 },
  ];

  it('rend le plus proche dans le rayon', () => {
    expect(nearestPoint(points, { x: 12, y: 12 }, 20)).toBe(0);
    expect(nearestPoint(points, { x: 103, y: 52 }, 20)).toBe(2);
  });

  it('rend -1 quand rien n\u2019est assez près', () => {
    expect(nearestPoint(points, { x: 60, y: 200 }, 20)).toBe(-1);
    expect(nearestPoint([], { x: 0, y: 0 }, 20)).toBe(-1);
  });

  it('garde le premier en cas d\u2019égalité', () => {
    expect(nearestPoint([{ x: 0, y: 0 }, { x: 10, y: 0 }], { x: 5, y: 0 }, 20)).toBe(0);
  });
});
