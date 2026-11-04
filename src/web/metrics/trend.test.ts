import { describe, expect, it } from 'vitest';
import type { MetricsTrend } from '../../shared/api';
import { describeTrend, formatEfficiency, MEASURES } from './trend';

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

describe('Efficacité du flux : plus haute, c’est mieux, en points', () => {
  it('une hausse est bonne, une baisse est mauvaise', () => {
    expect(describeTrend(trend(0.95, 0.9), MEASURES.efficiency)).toMatchObject({ direction: 'up', tone: 'good', delta: `+5${NBSP}pts`, previous: `90${NBSP}%` });
    expect(describeTrend(trend(0.8, 0.9), MEASURES.efficiency)).toMatchObject({ direction: 'down', tone: 'bad', delta: `−10${NBSP}pts` });
  });

  it('dit sa phrase en points, sans variation relative', () => {
    const view = describeTrend(trend(0.92, 0.97), MEASURES.efficiency);
    expect(view.ratio).toBeNull();
    expect(view.sentence).toBe(`En baisse de 5 points : 92${NBSP}% contre 97${NBSP}% sur la période précédente.`);
  });

  it('dit « stable » sous 0,05 point', () => {
    expect(describeTrend(trend(1, 0.9999), MEASURES.efficiency).direction).toBe('flat');
  });
});

describe('Efficacité du flux : « 100 % » seulement quand il n’y a aucun Blocage', () => {
  it('écrit « 100 % » pour une efficacité exactement égale à 1, et « > 99,9 % » pour une part qui arrondirait à 100 % sans l’être', () => {
    expect(formatEfficiency(1)).toBe(`100${NBSP}%`);
    expect(formatEfficiency(1 - 3516 / 10_723_598_096)).toBe(`> 99,9${NBSP}%`); // 3,5 s de Blocage pour 124 j de Cycle Time
    expect(formatEfficiency(0.9995)).toBe(`> 99,9${NBSP}%`); // 99,95 % arrondirait à « 100 % »
    expect(formatEfficiency(0.99999999)).toBe(`> 99,9${NBSP}%`);
  });

  it('écrit les autres parts comme les taux, à une décimale : 99,9 %, 91,9 %, 0 %', () => {
    expect(formatEfficiency(0.99949)).toBe(`99,9${NBSP}%`);
    expect(formatEfficiency(0.919)).toBe(`91,9${NBSP}%`);
    expect(formatEfficiency(0)).toBe(`0${NBSP}%`);
  });

  it('n’a pas de valeur sans mesure', () => {
    expect(formatEfficiency(null)).toBe('—');
  });

  it('écrit la valeur, la précédente et la phrase de la tendance avec la même règle', () => {
    // Courante : 99,99997 % (du Blocage) ; précédente : exactement 100 % (aucun Blocage).
    const view = describeTrend(trend(1 - 3516 / 10_723_598_096, 1), MEASURES.efficiency);
    expect(view.direction).toBe('flat');
    expect(view.previous).toBe(`100${NBSP}%`);
    expect(view.sentence).toBe(`Stable : > 99,9${NBSP}% comme sur la période précédente.`);
    // Une baisse sensible : 100 % puis 99,7 %, on lit la baisse en points, et jamais « 100 % » pour la valeur courante.
    expect(describeTrend(trend(0.997, 1), MEASURES.efficiency).sentence).toBe(`En baisse de 0,3 point : 99,7${NBSP}% contre 100${NBSP}% sur la période précédente.`);
  });
});

describe('Taux d’abandon : une part dont la hausse n’est ni bonne ni mauvaise', () => {
  it('ne colore ni la hausse ni la baisse : fermer des doublons relève de la bonne hygiène', () => {
    expect(describeTrend(trend(0.1, 0.05), MEASURES.abandonment)).toMatchObject({ direction: 'up', tone: 'neutral', delta: `+5${NBSP}pts`, previous: `5${NBSP}%` });
    expect(describeTrend(trend(0.02, 0.1), MEASURES.abandonment)).toMatchObject({ direction: 'down', tone: 'neutral', delta: `−8${NBSP}pts` });
  });

  it('se lit comme un taux : en points, à une décimale, sans variation relative', () => {
    const view = describeTrend(trend(0.105, 0.05), MEASURES.abandonment);
    expect(view.ratio).toBeNull();
    expect(view.sentence).toBe(`En hausse de 5,5 points : 10,5${NBSP}% contre 5${NBSP}% sur la période précédente.`);
  });

  it('dit « stable » sous 0,05 point, comme les autres taux', () => {
    expect(describeTrend(trend(0.1, 0.10001), MEASURES.abandonment).direction).toBe('flat');
  });

  it('laisse aux autres taux leur sens : une hausse du Taux de Réouverture reste mauvaise', () => {
    expect(describeTrend(trend(0.1, 0.05), MEASURES.rate)).toMatchObject({ direction: 'up', tone: 'bad' });
  });
});

describe('Écart Arrivées–Débit : un nombre signé, sans bon ni mauvais sens', () => {
  it('ne colore ni la hausse ni la baisse, et signe les valeurs', () => {
    const up = describeTrend(trend(2, -6), MEASURES.balance);
    expect(up).toMatchObject({ direction: 'up', tone: 'neutral', delta: '+8', previous: '−6', ratio: null });
    expect(describeTrend(trend(-3, 4), MEASURES.balance)).toMatchObject({ direction: 'down', tone: 'neutral', delta: '−7', previous: '+4' });
  });

  it('dit sa phrase avec les valeurs signées', () => {
    expect(describeTrend(trend(2, -6), MEASURES.balance).sentence).toBe('En hausse de 8 : +2 contre −6 sur la période précédente.');
  });

  it('dit « stable » quand l’écart ne bouge pas', () => {
    expect(describeTrend(trend(0, 0), MEASURES.balance)).toMatchObject({ direction: 'flat', tone: 'neutral' });
  });
});

describe('Prêts qui stagnent : un nombre de tickets, moins, c’est mieux', () => {
  it('une hausse est mauvaise, une baisse est bonne', () => {
    expect(describeTrend(trend(3, 2), MEASURES.fewer)).toMatchObject({ direction: 'up', tone: 'bad', delta: '+1', previous: '2', ratio: `+50${NBSP}%` });
    expect(describeTrend(trend(1, 4), MEASURES.fewer)).toMatchObject({ direction: 'down', tone: 'good', delta: '−3' });
  });

  it('n’a pas de variation relative à partir de zéro', () => {
    expect(describeTrend(trend(2, 0), MEASURES.fewer)).toMatchObject({ direction: 'up', tone: 'bad', ratio: null });
  });
});
