import { describe, expect, it } from 'vitest';
import { describeBreakdown } from './breakdown';
import { emptyHealthFixture, healthFixture } from './testing';

const DAY = 86_400_000;

/**
 * Décomposition du Lead Time : cinq parts qui s'additionnent, de la plus attentiste à la plus active. Ce que la page
 * ajoute à l'API, ce sont les parts du Lead Time cumulé, les libellés et les couleurs des colonnes du flux.
 */

describe('describeBreakdown', () => {
  const view = describeBreakdown(healthFixture().leadTimeBreakdown);

  it('range les parts dans l’ordre de la vie d’un ticket : Attente de dépendance, Attente en Prêt, autre attente, travail, Blocage', () => {
    expect(view.parts.map((part) => [part.key, part.label])).toEqual([
      ['dependencyWait', 'Attente de dépendance'],
      ['readyWait', 'Attente en Prêt'],
      ['otherWait', 'Autre attente'],
      ['work', 'Travail'],
      ['blocked', 'Blocage'],
    ]);
  });

  it('donne la durée cumulée de chaque part et sa part du Lead Time cumulé', () => {
    // Fixture : 120 j cumulés, dont 21 j d'Attente de dépendance, 52 j d'Attente en Prêt, 16 j d'autre attente, 28,5 j de travail, 2,5 j de Blocage.
    expect(view.total).toBe(120 * DAY);
    expect(view.parts.map((part) => part.duration)).toEqual([21 * DAY, 52 * DAY, 16 * DAY, 28.5 * DAY, 2.5 * DAY]);
    expect(view.parts.map((part) => part.share)).toEqual([21 / 120, 52 / 120, 16 / 120, 28.5 / 120, 2.5 / 120]);
    expect(view.parts.reduce((sum, part) => sum + (part.share ?? 0), 0)).toBeCloseTo(1, 12);
  });

  it('colore chaque part comme la colonne du flux qu’elle rappelle : Backlog, Prêt, Backlog (hachuré : le reste), En cours, Bloqué', () => {
    expect(view.parts.map((part) => part.color)).toEqual(['var(--flow-backlog)', 'var(--flow-ready)', 'var(--flow-backlog)', 'var(--flow-progress)', 'var(--flow-blocked)']);
    // L'autre attente reprend la couleur de l'Attente de dépendance : seules les hachures les distinguent, jamais la couleur seule.
    expect(view.parts.map((part) => part.hatched)).toEqual([false, false, true, false, false]);
  });

  it('explique chaque part en une phrase', () => {
    expect(view.parts.map((part) => part.description)).toEqual([
      'Le temps en Backlog avant le premier démarrage : le ticket dépendait d’un ticket non fermé.',
      'Le temps passé Prêt : le ticket pouvait être démarré et ne l’était pas.',
      'Le reste : Backlog après un premier démarrage, différé, ou fermé avant une Réouverture.',
      'Le Cycle Time hors Blocage.',
      'Le Cycle Time passé en Blocage : statut bloqué, ou dépendance non fermée pendant le travail.',
    ]);
  });

  it('écrit la durée de chaque part, et « Aucun » ou « Aucune » quand elle est exactement nulle : « < 1 min » ferait croire qu’elle a eu lieu', () => {
    expect(view.parts.map((part) => part.text.replaceAll('\u00a0', ' '))).toEqual(['21 j', '52 j', '16 j', '29 j', '2,5 j']);

    const base = healthFixture().leadTimeBreakdown;
    const zeros = describeBreakdown({ ...base, dependencyWait: 0, readyWait: 0, otherWait: 0, work: 0, blocked: 0, total: 1 });
    expect(zeros.parts.map((part) => part.text)).toEqual(['Aucune', 'Aucune', 'Aucune', 'Aucun', 'Aucun']); // féminin pour les attentes, masculin pour le travail et le Blocage
    // Trois secondes de Blocage ont bien eu lieu : « < 1 min », pas « Aucun ».
    expect(describeBreakdown({ ...base, blocked: 3000 }).parts[4]?.text.replaceAll('\u00a0', ' ')).toBe('< 1 min');
  });

  it('dit la durée de chaque part en toutes lettres, « moins d’une minute » là où elle s’écrit « < 1 min », « Aucun » ou « Aucune » quand elle est nulle', () => {
    expect(view.parts.map((part) => part.spoken)).toEqual(['21 jours', '52 jours', '16 jours', '29 jours', '2,5 jours']);

    const base = healthFixture().leadTimeBreakdown;
    const zeros = describeBreakdown({ ...base, dependencyWait: 0, readyWait: 0, otherWait: 0, work: 0, blocked: 0, total: 1 });
    expect(zeros.parts.map((part) => part.spoken)).toEqual(['Aucune', 'Aucune', 'Aucune', 'Aucun', 'Aucun']);
    expect(describeBreakdown({ ...base, blocked: 3000 }).parts[4]?.spoken).toBe('moins d’une minute');
  });

  it('reprend les Livraisons qui ont attendu une dépendance, avec la médiane et le P85 de leur attente', () => {
    expect(view).toMatchObject({ deliveries: 18, waited: 6, waits: { median: 2.1 * DAY, p85: 6 * DAY, n: 6 } });
  });

  it('n’a pas de part sans Livraison : rien à répartir, pas de pourcentage à partir de zéro', () => {
    const empty = describeBreakdown(emptyHealthFixture().leadTimeBreakdown);

    expect(empty.empty).toBe(true);
    expect(empty.parts.map((part) => part.share)).toEqual([null, null, null, null, null]);
    expect(view.empty).toBe(false);
  });

  it('distingue l’absence de Livraison d’un Lead Time cumulé nul : la raison de l’état vide', () => {
    const base = healthFixture().leadTimeBreakdown;

    expect(describeBreakdown(emptyHealthFixture().leadTimeBreakdown)).toMatchObject({ empty: true, deliveries: 0 });
    expect(describeBreakdown({ ...base, total: 0, deliveries: 3 })).toMatchObject({ empty: true, deliveries: 3, total: 0 });
  });
});
