import { describe, expect, it } from 'vitest';
import type { MetricsCfdPoint } from '../../shared/api';
import { cfdMax, cfdSummary, cfdTotal, FLOW_SERIES, flowColumns, flowSeries, stackKeys, TABLE_COLUMNS, toCfdRows } from './cfd';

/**
 * Le CFD empile les colonnes du kanban : les cinq de tout Projet, et celles des Statuts de relais quand un Projet mesuré les a (bdesk-pz0.4). Terminé
 * est en bas : c'est lui qui monte sans cesse, et l'écart entre les courbes qui le surplombent est le travail en cours. Les noms sont ceux du kanban.
 */

const point = (date: string, backlog: number, ready: number, inProgress: number, blocked: number, done: number): MetricsCfdPoint => ({
  date,
  backlog,
  ready,
  inProgress,
  blocked,
  done,
});

const POINTS = [
  point('2026-10-31', 5, 37, 9, 0, 154),
  point('2026-11-01', 5, 35, 10, 1, 160),
  point('2026-11-02', 5, 33, 11, 0, 170),
];

describe('FLOW_SERIES', () => {
  it('range les colonnes de bas en haut : Terminé, En cours, les relais dans l’ordre du kanban, Bloqué, Prêt, Backlog', () => {
    expect(FLOW_SERIES.map((series) => series.key)).toEqual(['done', 'inProgress', 'inReview', 'inIntegration', 'awaitingHuman', 'blocked', 'ready', 'backlog']);
    expect(flowSeries('fr').map((series) => series.label)).toEqual([
      'Terminé',
      'En cours',
      'En relecture',
      'En intégration',
      'À valider',
      'Bloqué',
      'Prêt',
      'Backlog',
    ]);
  });

  it('colore chaque colonne avec son jeton de styles', () => {
    expect(FLOW_SERIES.map((series) => series.color)).toEqual([
      'var(--flow-done)',
      'var(--flow-progress)',
      'var(--flow-review)',
      'var(--flow-integration)',
      'var(--flow-awaiting)',
      'var(--flow-blocked)',
      'var(--flow-ready)',
      'var(--flow-backlog)',
    ]);
  });

  it('range le tableau des valeurs comme le kanban, de gauche à droite', () => {
    expect([...TABLE_COLUMNS]).toEqual(['backlog', 'ready', 'inProgress', 'inReview', 'inIntegration', 'awaitingHuman', 'blocked', 'done']);
  });
});

describe('cfdTotal et toCfdRows', () => {
  it('additionne les cinq colonnes', () => {
    expect(cfdTotal(POINTS[2]!)).toBe(5 + 33 + 11 + 0 + 170);
  });

  it('date chaque point à minuit UTC de son jour : l’axe du temps ne dépend pas du fuseau du navigateur', () => {
    const rows = toCfdRows(POINTS);
    expect(rows.map((row) => new Date(row.time).toISOString())).toEqual([
      '2026-10-31T00:00:00.000Z',
      '2026-11-01T00:00:00.000Z',
      '2026-11-02T00:00:00.000Z',
    ]);
    expect(rows[1]).toMatchObject({ date: '2026-11-01', total: 5 + 35 + 10 + 1 + 160, done: 160, blocked: 1 });
  });
});

describe('stackKeys et cfdMax', () => {
  const columns = flowColumns(POINTS);

  it('empile les cinq colonnes, ou quatre sans Terminé', () => {
    expect(stackKeys(columns, false)).toEqual(['done', 'inProgress', 'blocked', 'ready', 'backlog']);
    expect(stackKeys(columns, true)).toEqual(['inProgress', 'blocked', 'ready', 'backlog']);
  });

  it('prend la hauteur de la plus haute pile', () => {
    expect(cfdMax(POINTS, stackKeys(columns, false))).toBe(219);
    // Sans Terminé, les piles les plus hautes sont celles du 31 octobre (5 + 37 + 9) et du 1er novembre (5 + 35 + 10 + 1) : 51.
    expect(cfdMax(POINTS, stackKeys(columns, true))).toBe(51);
  });

  it('vaut 0 sans point', () => {
    expect(cfdMax([], stackKeys(flowColumns([]), false))).toBe(0);
  });
});

describe('cfdSummary : le texte qui remplace le dessin pour un lecteur d’écran', () => {
  it('dit la période et l’état du dernier jour', () => {
    expect(cfdSummary(POINTS, 'fr')).toBe(
      'Flux cumulé du 31 oct. au 2 nov. 2026. Dernier jour : 170 Terminé, 11 En cours, 0 Bloqué, 33 Prêt, 5 Backlog.',
    );
  });

  it('dit qu’il n’y a rien à montrer', () => {
    expect(cfdSummary([], 'fr')).toBe('Flux cumulé : aucun jour à montrer.');
  });
});

describe('en anglais', () => {
  it('nomme les colonnes et dit le résumé du dessin en anglais', () => {
    expect(flowSeries('en').map((series) => series.label)).toEqual([
      'Done',
      'In progress',
      'In review',
      'In integration',
      'Awaiting validation',
      'Blocked',
      'Ready',
      'Backlog',
    ]);
    expect(cfdSummary(POINTS, 'en')).toBe(
      'Cumulative flow from Oct 31 to Nov 2, 2026. Last day: 170 Done, 11 In progress, 0 Blocked, 33 Ready, 5 Backlog.',
    );
    expect(cfdSummary([], 'en')).toBe('Cumulative flow: no days to show.');
  });
});

describe('les bandes des Statuts de relais (bdesk-pz0.4)', () => {
  const relayed = (date: string, inReview: number, inIntegration: number, awaitingHuman: number): MetricsCfdPoint => ({
    ...point(date, 5, 33, 11, 1, 170),
    inReview,
    inIntegration,
    awaitingHuman,
  });
  const RELAYED = [relayed('2026-11-01', 1, 0, 2), relayed('2026-11-02', 2, 3, 4)];

  it('n’existent que si le CFD a leurs colonnes : un CFD sans relais garde ses cinq colonnes', () => {
    expect(flowColumns(POINTS)).toEqual(['done', 'inProgress', 'blocked', 'ready', 'backlog']);
    expect(flowColumns(RELAYED)).toEqual(['done', 'inProgress', 'inReview', 'inIntegration', 'awaitingHuman', 'blocked', 'ready', 'backlog']);
    // Une seule colonne de relais : la seule que le serveur a écrite.
    const onlyReview: MetricsCfdPoint = { ...point('2026-11-02', 5, 33, 11, 1, 170), inReview: 2 };
    expect(flowColumns([onlyReview])).toEqual(['done', 'inProgress', 'inReview', 'blocked', 'ready', 'backlog']);
  });

  it('s’empilent entre En cours et Bloqué, avec leurs tickets à part : ni En cours ni le total ne les mêlent', () => {
    const [, row] = toCfdRows(RELAYED);

    expect(row).toMatchObject({ inProgress: 11, inReview: 2, inIntegration: 3, awaitingHuman: 4, blocked: 1, total: 5 + 33 + 11 + 2 + 3 + 4 + 1 + 170 });
    expect(stackKeys(flowColumns(RELAYED), true)).toEqual(['inProgress', 'inReview', 'inIntegration', 'awaitingHuman', 'blocked', 'ready', 'backlog']);
    expect(cfdMax(RELAYED, stackKeys(flowColumns(RELAYED), true))).toBe(5 + 33 + 11 + 2 + 3 + 4 + 1);
  });

  it('se disent dans le résumé du dessin, dans l’ordre de la pile, en français et en anglais', () => {
    expect(cfdSummary(RELAYED, 'fr')).toBe(
      'Flux cumulé du 1 nov. au 2 nov. 2026. Dernier jour : 170 Terminé, 11 En cours, 2 En relecture, 3 En intégration, 4 À valider, 1 Bloqué, 33 Prêt, 5 Backlog.',
    );
    expect(cfdSummary(RELAYED, 'en')).toBe(
      'Cumulative flow from Nov 1 to Nov 2, 2026. Last day: 170 Done, 11 In progress, 2 In review, 3 In integration, 4 Awaiting validation, 1 Blocked, 33 Ready, 5 Backlog.',
    );
  });

  it('laissent tel quel un point sans colonne de relais', () => {
    expect(toCfdRows(POINTS)).toEqual(POINTS.map((p) => ({ ...p, time: expect.any(Number), total: cfdTotal(p) })));
    expect(Object.keys(toCfdRows(POINTS)[0] ?? {})).not.toContain('inReview');
  });
});
