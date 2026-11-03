import { describe, expect, it } from 'vitest';
import type { MetricsResponse } from '../../shared/api';
import { describeComparison } from './comparison';

/**
 * Les tendances ne comparent pas deux périodes entières : la période en cours, pas finie, est comptée de son début à
 * maintenant (`asOf`) et mise en face de la précédente jusqu'à l'instant correspondant (`previousAsOf`), à durée
 * écoulée égale. Sans cette explication, « 64 contre 9 » paraîtrait compter 30 jours contre 30 jours.
 */

type Windows = Pick<MetricsResponse, 'period' | 'previousPeriod' | 'asOf' | 'previousAsOf' | 'timeZone'>;

/** Le relevé réel du 2 novembre 2026, 20:00 à Paris : les 30 derniers jours, aujourd'hui compris. */
const RUNNING: Windows = {
  timeZone: 'Europe/Paris',
  period: { from: '2026-10-04', to: '2026-11-02', days: 30, start: '2026-10-03T22:00:00.000Z', end: '2026-11-02T23:00:00.000Z' },
  previousPeriod: { from: '2026-09-04', to: '2026-10-03', days: 30, start: '2026-09-03T22:00:00.000Z', end: '2026-10-03T22:00:00.000Z' },
  asOf: '2026-11-02T19:00:17.660Z',
  previousAsOf: '2026-10-03T19:00:17.660Z',
};

/** Une plage personnalisée finie : du 1er au 15 octobre, mesurée à sa fin. */
const FINISHED: Windows = {
  timeZone: 'Europe/Paris',
  period: { from: '2026-10-01', to: '2026-10-15', days: 15, start: '2026-09-30T22:00:00.000Z', end: '2026-10-15T22:00:00.000Z' },
  previousPeriod: { from: '2026-09-16', to: '2026-09-30', days: 15, start: '2026-09-15T22:00:00.000Z', end: '2026-09-30T22:00:00.000Z' },
  asOf: '2026-10-15T22:00:00.000Z',
  previousAsOf: '2026-09-30T22:00:00.000Z',
};

describe('describeComparison : période en cours', () => {
  const comparison = describeComparison(RUNNING);

  it('reconnaît une période qui court encore : `asOf` précède sa fin', () => {
    expect(comparison.running).toBe(true);
    expect(comparison.asOfTime).toBe('20:00');
  });

  it('nomme les deux périodes et les deux instants de mesure, dans le fuseau de l’utilisateur', () => {
    expect(comparison).toMatchObject({
      current: '4 oct. – 2 nov. 2026',
      previous: '4 sept. – 3 oct. 2026',
      currentUntil: '2 nov. à 20:00',
      previousUntil: '3 oct. à 21:00',
    });
  });

  it('écrit la phrase visible sous les tuiles', () => {
    expect(comparison.summary).toBe(
      'Période en cours (4 oct. – 2 nov. 2026), comptée jusqu’au 2 nov. à 20:00. ' +
        'Les tendances la comparent à la période précédente (4 sept. – 3 oct. 2026) à durée écoulée égale, ' +
        'c’est-à-dire jusqu’au 3 oct. à 21:00.',
    );
  });

  it('écrit l’infobulle d’une tendance, plus courte', () => {
    expect(comparison.tooltip).toBe(
      'Comparé à la période précédente à durée écoulée égale, jusqu’au 3 oct. à 21:00. ' +
        'La période en cours n’est pas finie : elle est comptée jusqu’au 2 nov. à 20:00.',
    );
  });
});

describe('describeComparison : période terminée', () => {
  const comparison = describeComparison(FINISHED);

  it('ne parle pas d’instant de mesure : la période est comptée en entier', () => {
    expect(comparison).toMatchObject({ running: false, currentUntil: null, previousUntil: null });
  });

  it('compare deux périodes entières de même durée', () => {
    expect(comparison.summary).toBe(
      'Période terminée (1 oct. – 15 oct. 2026). Les tendances la comparent à la période précédente de même durée (16 sept. – 30 sept. 2026).',
    );
    expect(comparison.tooltip).toBe('Comparé à la période précédente de même durée : 16 sept. – 30 sept. 2026.');
  });
});

describe('describeComparison : cas limites', () => {
  it('lit l’instant dans le fuseau de la réponse, pas celui du navigateur', () => {
    const tokyo = describeComparison({ ...RUNNING, timeZone: 'Asia/Tokyo' });
    expect(tokyo.asOfTime).toBe('04:00');
    expect(tokyo.currentUntil).toBe('3 nov. à 04:00');
  });

  it('une période d’un seul jour s’écrit sans plage', () => {
    const oneDay = describeComparison({
      ...RUNNING,
      period: { ...RUNNING.period, from: '2026-11-02', days: 1 },
      previousPeriod: { ...RUNNING.previousPeriod, from: '2026-11-01', to: '2026-11-01', days: 1 },
    });
    expect(oneDay.current).toBe('2 nov. 2026');
    expect(oneDay.previous).toBe('1 nov. 2026');
  });
});
