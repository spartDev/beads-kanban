import { describe, expect, it } from 'vitest';
import type { MetricsTrend } from '../../shared/api';
import { describeTrend, MEASURES } from './trend';

const NBSP = ' ';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Une tendance comme l'API la donne : `delta` est la valeur courante moins la précédente, `ratio` est `delta / previous`. */
const trend = (current: number | null, previous: number | null): MetricsTrend => {
  if (current === null || previous === null) return { previous, delta: null, ratio: null };
  const delta = current - previous;
  return { previous, delta, ratio: previous === 0 ? null : delta / previous };
};

describe('Débit : plus de Livraisons, c’est mieux', () => {
  it('une hausse est bonne, une baisse est mauvaise', () => {
    const up = describeTrend(trend(64, 9), MEASURES.count);
    expect(up).toMatchObject({ direction: 'up', tone: 'good', delta: '+55', previous: '9' });
    const down = describeTrend(trend(5, 9), MEASURES.count);
    expect(down).toMatchObject({ direction: 'down', tone: 'bad', delta: '−4', previous: '9' });
  });

  it('écrit la variation relative quand elle existe', () => {
    expect(describeTrend(trend(64, 9), MEASURES.count).ratio).toBe(`+611${NBSP}%`);
    expect(describeTrend(trend(5, 9), MEASURES.count).ratio).toBe(`−44${NBSP}%`);
  });

  it('n’a pas de variation relative quand la période précédente est vide : on ne divise pas par zéro', () => {
    const view = describeTrend(trend(12, 0), MEASURES.count);
    expect(view).toMatchObject({ direction: 'up', tone: 'good', delta: '+12', previous: '0', ratio: null });
  });

  it('ne dit pas « 0 % » d’une hausse ou d’une baisse : sous 1 %, la variation relative se dit « moins de 1 % »', () => {
    // 1 Livraison de plus sur 300 : l'arrondi à l'entier ferait écrire « En hausse de 1 (0 %) », qui se contredit.
    const up = describeTrend(trend(301, 300), MEASURES.count);
    expect(up).toMatchObject({ direction: 'up', tone: 'good', delta: '+1', ratio: `moins de 1${NBSP}%` });
    expect(up.sentence).toBe(`En hausse de 1 (moins de 1${NBSP}%) : 301 contre 300 sur la période précédente.`);

    const down = describeTrend(trend(299, 300), MEASURES.count);
    expect(down).toMatchObject({ direction: 'down', tone: 'bad', delta: '−1', ratio: `moins de 1${NBSP}%` });
    expect(down.sentence).toBe(`En baisse de 1 (moins de 1${NBSP}%) : 299 contre 300 sur la période précédente.`);
  });

  it('écrit le pourcentage entier dès que l’arrondi ne l’efface plus', () => {
    expect(describeTrend(trend(1010, 1000), MEASURES.count).ratio).toBe(`+1${NBSP}%`);
    expect(describeTrend(trend(990, 1000), MEASURES.count).ratio).toBe(`−1${NBSP}%`);
  });

  it('dit « stable » quand rien ne change', () => {
    const view = describeTrend(trend(9, 9), MEASURES.count);
    expect(view).toMatchObject({ direction: 'flat', tone: 'neutral', delta: '0', ratio: `0${NBSP}%` });
  });

  it('explique en une phrase, pour l’infobulle et les lecteurs d’écran', () => {
    expect(describeTrend(trend(64, 9), MEASURES.count).sentence).toBe(
      `En hausse de 55 (+611${NBSP}%) : 64 contre 9 sur la période précédente.`,
    );
    expect(describeTrend(trend(5, 9), MEASURES.count).sentence).toBe(
      `En baisse de 4 (−44${NBSP}%) : 5 contre 9 sur la période précédente.`,
    );
    expect(describeTrend(trend(9, 9), MEASURES.count).sentence).toBe('Stable : 9 comme sur la période précédente.');
  });
});

describe('durées : plus court, c’est mieux', () => {
  it('une hausse du Lead Time est mauvaise, une baisse est bonne', () => {
    const slower = describeTrend(trend(296_930_437, 8_749_941), MEASURES.duration);
    expect(slower).toMatchObject({
      direction: 'up',
      tone: 'bad',
      delta: `+3,3${NBSP}j`,
      previous: `2${NBSP}h${NBSP}26`,
    });
    const faster = describeTrend(trend(2 * HOUR, 5 * HOUR), MEASURES.duration);
    expect(faster).toMatchObject({ direction: 'down', tone: 'good', delta: `−3${NBSP}h`, previous: `5${NBSP}h` });
  });

  it('dit les durées en toutes lettres dans la phrase', () => {
    expect(describeTrend(trend(3 * DAY, 2 * DAY), MEASURES.duration).sentence).toBe(
      `En hausse de 1 jour (+50${NBSP}%) : 3 jours contre 2 jours sur la période précédente.`,
    );
  });

  it('dit « stable » sous la minute : l’arrondi de l’affichage l’effacerait', () => {
    const view = describeTrend(trend(HOUR + 20_000, HOUR), MEASURES.duration);
    expect(view).toMatchObject({ direction: 'flat', tone: 'neutral' });
    expect(describeTrend(trend(HOUR + 30_000, HOUR), MEASURES.duration).direction).toBe('up');
  });
});

describe('Taux d’échec : plus bas, c’est mieux, en points', () => {
  it('écrit l’écart en points de pourcentage', () => {
    const view = describeTrend(trend(0.015625, 0.111111), MEASURES.rate);
    expect(view).toMatchObject({
      direction: 'down',
      tone: 'good',
      delta: `−9,5${NBSP}pts`,
      previous: `11,1${NBSP}%`,
    });
    expect(describeTrend(trend(0.3, 0.1), MEASURES.rate)).toMatchObject({ direction: 'up', tone: 'bad', delta: `+20${NBSP}pts` });
  });

  it('dit sa phrase en points', () => {
    expect(describeTrend(trend(0.3, 0.1), MEASURES.rate).sentence).toBe(
      `En hausse de 20 points : 30${NBSP}% contre 10${NBSP}% sur la période précédente.`,
    );
  });

  it('dit « stable » sous 0,05 point', () => {
    expect(describeTrend(trend(0.1002, 0.1), MEASURES.rate).direction).toBe('flat');
  });
});

describe('WIP : une moyenne, sans bon ni mauvais sens', () => {
  it('ne colore ni la hausse ni la baisse', () => {
    const up = describeTrend(trend(9.917, 4.571), MEASURES.average);
    expect(up).toMatchObject({ direction: 'up', tone: 'neutral', delta: '+5,3', previous: '4,6' });
    expect(describeTrend(trend(2, 4), MEASURES.average)).toMatchObject({ direction: 'down', tone: 'neutral', delta: '−2' });
  });

  it('dit « stable » sous 0,05', () => {
    expect(describeTrend(trend(4.58, 4.571), MEASURES.average).direction).toBe('flat');
  });
});

describe('rien à comparer', () => {
  it('sans valeur précédente, ou sans valeur courante, la tendance n’a pas de sens', () => {
    const noPrevious = describeTrend(trend(12, null), MEASURES.count);
    expect(noPrevious).toMatchObject({ direction: 'none', tone: 'neutral', delta: null, previous: null, ratio: null });
    expect(noPrevious.sentence).toBe('Pas de comparaison : la période précédente n’a pas de valeur.');
  });

  it('garde la valeur précédente quand c’est la période courante qui n’a rien', () => {
    const noCurrent = describeTrend(trend(null, 8_749_941), MEASURES.duration);
    expect(noCurrent).toMatchObject({ direction: 'none', delta: null, previous: `2${NBSP}h${NBSP}26` });
    expect(noCurrent.sentence).toBe('Pas de comparaison : la période courante n’a pas de valeur (précédente : 2 heures 26 minutes).');
  });
});
