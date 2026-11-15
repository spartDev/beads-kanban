import { describe, expect, it } from 'vitest';
import { describeJourney } from './journey';
import { emptyHealthFixture, emptyMetricsFixture, healthFixture, metricsFixture } from './testing';

const DAY = 86_400_000;

/**
 * Le parcours d'un ticket tel que la page le dessine. Chiffres du fixture (Vue globale, 7 derniers jours) : 20 Arrivées et 18 Livraisons ; 120 j de Lead Time cumulé,
 * dont 21 j d'Attente de dépendance, 52 j d'Attente en Prêt, 16 j d'autre attente, 28,5 j de travail et 2,5 j de Blocage ; au dernier relevé du flux cumulé, 5 tickets
 * en Backlog, 33 Prêts (3 stagnent) et 11 en cours.
 */
describe('describeJourney : le parcours d’un ticket', () => {
  const journey = (data = metricsFixture()) => describeJourney({ tiles: data.tiles, health: data.health, cfd: data.cfd });

  it('donne ce qui entre et ce qui sort : les Arrivées et les Livraisons de la période', () => {
    expect(journey()).toMatchObject({ arrivals: 20, deliveries: 18 });
  });

  it('range les parts du Lead Time en trois états, dans l’ordre du parcours', () => {
    const { stages } = journey();

    expect(stages.map((stage) => [stage.key, stage.label, stage.duration / DAY])).toEqual([
      ['backlog', 'Backlog', 21],
      ['ready', 'Prêt', 52],
      // Le Blocage est dans le Cycle Time : il compte dans le tronçon En cours, avec le travail.
      ['work', 'En cours', 31],
    ]);
    expect(stages.map((stage) => stage.share)).toEqual([21 / 120, 52 / 120, 31 / 120]);
  });

  it('garde à l’autre attente sa longueur sur le fil, sans l’ajouter à la part écrite de Prêt', () => {
    const view = journey();

    // Les trois tronçons du fil s'additionnent au Lead Time cumulé : l'autre attente est dessinée entre Prêt et En cours.
    expect(view.widths.map((width) => width / DAY)).toEqual([21, 52 + 16, 31]);
    expect(view.widths.reduce((sum, width) => sum + width, 0)).toBe(view.total);
    expect(view.stages[1].share).toBe(52 / 120);
    expect(view.otherShare).toBe(16 / 120);
  });

  it('dit la part d’attente (dépendance, Prêt, autre attente) et celle du Blocage', () => {
    const view = journey();

    expect(view.waitShare).toBe((21 + 52 + 16) / 120);
    expect(view.blockedShare).toBe(2.5 / 120);
  });

  it('lit les tickets de chaque état dans le dernier relevé du flux cumulé', () => {
    const view = journey();

    expect(view.stages.map((stage) => stage.stock)).toEqual([5, 33, 11]);
    expect(view.blockedStock).toBe(0);
  });

  it('compte les tickets en Blocage avec ceux en cours, et les dit à part', () => {
    const data = metricsFixture();
    const cfd = [...data.cfd.slice(0, -1), { ...data.cfd.at(-1)!, inProgress: 8, blocked: 3 }];

    const view = describeJourney({ tiles: data.tiles, health: data.health, cfd });

    expect(view.stages[2].stock).toBe(11);
    expect(view.blockedStock).toBe(3);
  });

  it('donne les Prêts qui stagnent et l’âge au-delà duquel un Prêt stagne', () => {
    expect(journey()).toMatchObject({ stagnant: 3, stagnantAfter: 14 * DAY });
  });

  it('sans Livraison, ne donne aucune part et dessine trois tronçons égaux', () => {
    const view = journey(emptyMetricsFixture({ health: emptyHealthFixture() }));

    expect(view.empty).toBe(true);
    expect(view.stages.map((stage) => stage.share)).toEqual([null, null, null]);
    expect(view.widths).toEqual([1, 1, 1]);
    expect([view.waitShare, view.otherShare, view.blockedShare]).toEqual([null, null, null]);
  });

  it('avec des Livraisons sans durée (Lead Time cumulé nul), ne divise pas par zéro', () => {
    const health = healthFixture();
    const view = describeJourney({
      tiles: metricsFixture().tiles,
      health: { ...health, leadTimeBreakdown: { ...health.leadTimeBreakdown, total: 0, dependencyWait: 0, readyWait: 0, work: 0, blocked: 0, otherWait: 0 } },
      cfd: metricsFixture().cfd,
    });

    expect(view.empty).toBe(true);
    expect(view.stages.map((stage) => stage.share)).toEqual([null, null, null]);
  });

  it('sans relevé du flux cumulé, ne prétend pas savoir combien de tickets attendent', () => {
    const data = metricsFixture();
    const view = describeJourney({ tiles: data.tiles, health: data.health, cfd: [] });

    expect(view.stages.map((stage) => stage.stock)).toEqual([null, null, null]);
    expect(view.blockedStock).toBeNull();
  });
});
