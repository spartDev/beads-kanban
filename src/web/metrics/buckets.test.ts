import { describe, expect, it } from 'vitest';
import type { MetricsBucket } from '../../shared/api';
import { normalizeBuckets, totalDeliveries } from './buckets';

/**
 * L'histogramme du Débit montre des tranches que le contrat dit inégales : une semaine commencée avant la période ou
 * qui la dépasse compte moins de 7 jours, et la dernière tranche d'une période qui court encore n'est comptée que
 * jusqu'à maintenant. Comparées telles quelles à des semaines pleines, elles paraîtraient en recul.
 */

const bucket = (from: string, to: string, days: number, deliveries: number): MetricsBucket => ({ from, to, days, deliveries, arrivals: 0 });

/** Les 14 tranches hebdomadaires de la période de 90 jours du 5 août au 2 novembre 2026 (relevées de l'API). */
const WEEKS: MetricsBucket[] = [
  bucket('2026-08-05', '2026-08-09', 5, 0),
  bucket('2026-08-10', '2026-08-16', 7, 0),
  bucket('2026-08-17', '2026-08-23', 7, 4),
  bucket('2026-10-26', '2026-11-01', 7, 11),
  bucket('2026-11-02', '2026-11-02', 1, 12),
];

describe('normalizeBuckets : tranches hebdomadaires d’une période qui court encore', () => {
  const views = normalizeBuckets(WEEKS, { unit: 'week', running: true, asOfTime: '20:00' });

  it('garde les comptes bruts : leur somme est celle de la tuile Débit', () => {
    expect(views.map((view) => view.deliveries)).toEqual([0, 0, 4, 11, 12]);
    expect(totalDeliveries(views)).toBe(27);
  });

  it('signale la première semaine, tronquée au début de la période', () => {
    expect(views[0]).toMatchObject({
      days: 5,
      fullDays: 7,
      truncated: true,
      running: false,
      partial: true,
      note: 'Semaine incomplète : 5 jours sur 7 dans la période.',
    });
  });

  it('signale la dernière semaine, en cours : un jour sur sept, jusqu’à maintenant', () => {
    expect(views[4]).toMatchObject({
      days: 1,
      truncated: true,
      running: true,
      partial: true,
      note: 'Semaine en cours : 1 jour sur 7, jusqu’à 20:00.',
    });
  });

  it('ne signale pas les semaines pleines', () => {
    for (const view of views.slice(1, 4)) {
      expect(view).toMatchObject({ truncated: false, running: false, partial: false, note: null });
    }
  });

  it('donne le rythme par jour, pour comparer des tranches de longueurs différentes', () => {
    expect(views[0]?.perDay).toBe(0);
    expect(views[2]?.perDay).toBeCloseTo(4 / 7, 10);
    expect(views[4]?.perDay).toBe(12);
  });

  it('étiquette l’axe par le premier jour de la tranche, et titre l’infobulle de ses deux bornes', () => {
    expect(views[0]).toMatchObject({ label: '5 août', title: 'mer. 5 août – dim. 9 août 2026' });
    expect(views[4]).toMatchObject({ label: '2 nov.', title: 'lun. 2 nov. 2026' });
  });
});

describe('normalizeBuckets : tranches quotidiennes', () => {
  const days = [bucket('2026-11-01', '2026-11-01', 1, 0), bucket('2026-11-02', '2026-11-02', 1, 12)];

  it('ne signale que le jour en cours : un jour entier n’est pas tronqué', () => {
    const [yesterday, today] = normalizeBuckets(days, { unit: 'day', running: true, asOfTime: '20:00' });
    expect(yesterday).toMatchObject({ fullDays: 1, truncated: false, running: false, partial: false, note: null });
    expect(today).toMatchObject({
      truncated: false,
      running: true,
      partial: true,
      note: 'Jour en cours, jusqu’à 20:00.',
      label: '2 nov.',
      title: 'lun. 2 nov. 2026',
    });
  });

  it('ne signale rien quand la période est finie', () => {
    const views = normalizeBuckets(days, { unit: 'day', running: false, asOfTime: '00:00' });
    expect(views.every((view) => !view.partial && view.note === null)).toBe(true);
  });
});

describe('normalizeBuckets : cas limites', () => {
  it('dit « semaine en cours » sans compter les jours quand la semaine est pleine (aujourd’hui est dimanche)', () => {
    const [view] = normalizeBuckets([bucket('2026-10-26', '2026-11-01', 7, 3)], { unit: 'week', running: true, asOfTime: '18:30' });
    expect(view).toMatchObject({ truncated: false, running: true, partial: true, note: 'Semaine en cours, jusqu’à 18:30.' });
  });

  it('une période finie garde ses semaines tronquées, sans les dire « en cours »', () => {
    const views = normalizeBuckets([bucket('2026-09-30', '2026-10-04', 5, 2), bucket('2026-10-05', '2026-10-07', 3, 1)], {
      unit: 'week',
      running: false,
      asOfTime: '00:00',
    });
    expect(views[1]).toMatchObject({
      truncated: true,
      running: false,
      partial: true,
      note: 'Semaine incomplète : 3 jours sur 7 dans la période.',
    });
  });

  it('n’échoue pas sans tranche', () => {
    expect(normalizeBuckets([], { unit: 'day', running: true, asOfTime: '20:00' })).toEqual([]);
    expect(totalDeliveries([])).toBe(0);
  });
});
