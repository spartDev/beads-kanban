import { describe, expect, it } from 'vitest';
import type { MetricsActivity } from '../../shared/api';
import { describeActivity, slotLabel, WEEKDAYS } from './activity';
import { emptyHealthFixture, healthFixture } from './testing';

/**
 * Carte d'activité : l'API donne 7 × 24 comptes (lundi d'abord). La page en tire le niveau de chaque case, le pic, et
 * les totaux par jour et par heure du tableau.
 */

const NBSP = '\u00a0';

const zeros = () => Array.from({ length: 7 }, () => new Array<number>(24).fill(0));

function activityOf(entries: [weekday: number, hour: number, count: number][]): MetricsActivity {
  const cells = zeros();
  for (const [weekday, hour, count] of entries) cells[weekday]![hour] = count;
  return { cells, total: entries.reduce((sum, [, , count]) => sum + count, 0) };
}

describe('WEEKDAYS', () => {
  it('commence le lundi, comme l’API et les tranches hebdomadaires', () => {
    expect(WEEKDAYS.map((day) => day.name)).toEqual(['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']);
    expect(WEEKDAYS.map((day) => day.short)).toEqual(['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']);
  });
});

describe('slotLabel', () => {
  it('dit le jour et l’heure entière de la case', () => {
    expect(slotLabel(3, 14)).toBe(`jeudi, de 14${NBSP}h à 15${NBSP}h`);
    expect(slotLabel(0, 0)).toBe(`lundi, de 0${NBSP}h à 1${NBSP}h`);
    expect(slotLabel(6, 23)).toBe(`dimanche, de 23${NBSP}h à 24${NBSP}h`);
  });
});

describe('describeActivity', () => {
  it('aligne 168 cases, du lundi 0 h au dimanche 23 h', () => {
    const view = describeActivity(activityOf([[1, 9, 3]]));

    expect(view.cells).toHaveLength(168);
    expect(view.cells[0]).toMatchObject({ weekday: 0, hour: 0, count: 0, level: 0 });
    expect(view.cells[24 + 9]).toMatchObject({ weekday: 1, hour: 9, count: 3 });
    expect(view.cells[167]).toMatchObject({ weekday: 6, hour: 23 });
  });

  it('donne à chaque case non vide un niveau de 1 à 4 selon sa part du maximum, 0 pour une case vide', () => {
    const view = describeActivity(activityOf([[0, 8, 1], [0, 9, 3], [0, 10, 5], [0, 11, 8], [0, 12, 20]]));

    // Maximum 20 : 1/20 → 1 ; 3/20 → 1 ; 5/20 → 1 ; 8/20 → 2 ; 20/20 → 4. Un quart du maximum est le haut du niveau 1.
    expect(view.max).toBe(20);
    expect([8, 9, 10, 11, 12].map((hour) => view.cells[hour]?.level)).toEqual([1, 1, 1, 2, 4]);
    expect(view.cells[7]?.level).toBe(0);
  });

  it('range les niveaux 1 à 4 par quarts du maximum', () => {
    const view = describeActivity(activityOf([[0, 0, 4], [0, 1, 5], [0, 2, 8], [0, 3, 9], [0, 4, 12], [0, 5, 13], [0, 6, 16]]));

    expect([0, 1, 2, 3, 4, 5, 6].map((hour) => view.cells[hour]?.level)).toEqual([1, 2, 2, 3, 3, 4, 4]);
  });

  it('donne le niveau le plus haut à une case seule : tout est au maximum', () => {
    expect(describeActivity(activityOf([[2, 2, 1]])).cells[48 + 2]?.level).toBe(4);
  });

  it('trouve le pic : la première case au maximum, du lundi au dimanche, de 0 h à 23 h', () => {
    const view = describeActivity(activityOf([[3, 14, 6], [1, 9, 6], [1, 16, 6], [0, 3, 2]]));

    expect(view.peak).toEqual({ weekday: 1, hour: 9, count: 6 });
  });

  it('totalise par jour de la semaine et par heure, pour le tableau et les phrases', () => {
    const view = describeActivity(activityOf([[0, 9, 2], [0, 14, 3], [1, 9, 4], [6, 9, 1]]));

    expect(view.byWeekday).toEqual([5, 4, 0, 0, 0, 0, 1]);
    expect(view.byHour[9]).toBe(7);
    expect(view.byHour[14]).toBe(3);
    expect(view.total).toBe(10);
  });

  it('n’a ni pic ni niveau sans Transition', () => {
    const view = describeActivity(emptyHealthFixture().activity);

    expect(view.peak).toBeNull();
    expect(view.max).toBe(0);
    expect(view.empty).toBe(true);
    expect(view.cells.every((cell) => cell.level === 0)).toBe(true);
  });

  it('lit la fixture : le pic est jeudi à 9 h (6 Transitions), 100 au total', () => {
    const view = describeActivity(healthFixture().activity);

    expect(view.total).toBe(100);
    expect(view.peak).toEqual({ weekday: 3, hour: 9, count: 6 });
  });
});
