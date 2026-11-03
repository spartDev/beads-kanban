import { describe, expect, it } from 'vitest';
import type { MetricsCfdPoint } from '../../shared/api';
import { cfdMax, cfdSummary, cfdTotal, FLOW_SERIES, stackKeys, toCfdRows } from './cfd';

/**
 * Le CFD empile les cinq colonnes du kanban. Terminé est en bas : c'est lui qui monte sans cesse, et l'écart entre
 * les courbes qui le surplombent est le travail en cours. Les noms sont ceux du kanban.
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
  it('range les colonnes de bas en haut : Terminé, En cours, Bloqué, Prêt, Backlog', () => {
    expect(FLOW_SERIES.map((series) => series.key)).toEqual(['done', 'inProgress', 'blocked', 'ready', 'backlog']);
    expect(FLOW_SERIES.map((series) => series.label)).toEqual(['Terminé', 'En cours', 'Bloqué', 'Prêt', 'Backlog']);
  });

  it('colore chaque colonne avec son jeton de styles', () => {
    expect(FLOW_SERIES.map((series) => series.color)).toEqual([
      'var(--flow-done)',
      'var(--flow-progress)',
      'var(--flow-blocked)',
      'var(--flow-ready)',
      'var(--flow-backlog)',
    ]);
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
  it('empile les cinq colonnes, ou quatre sans Terminé', () => {
    expect(stackKeys(false)).toEqual(['done', 'inProgress', 'blocked', 'ready', 'backlog']);
    expect(stackKeys(true)).toEqual(['inProgress', 'blocked', 'ready', 'backlog']);
  });

  it('prend la hauteur de la plus haute pile', () => {
    expect(cfdMax(POINTS, stackKeys(false))).toBe(219);
    // Sans Terminé, les piles les plus hautes sont celles du 31 octobre (5 + 37 + 9) et du 1er novembre (5 + 35 + 10 + 1) : 51.
    expect(cfdMax(POINTS, stackKeys(true))).toBe(51);
  });

  it('vaut 0 sans point', () => {
    expect(cfdMax([], stackKeys(false))).toBe(0);
  });
});

describe('cfdSummary : le texte qui remplace le dessin pour un lecteur d’écran', () => {
  it('dit la période et l’état du dernier jour', () => {
    expect(cfdSummary(POINTS)).toBe(
      'Flux cumulé du 31 oct. au 2 nov. 2026. Dernier jour : 170 Terminé, 11 En cours, 0 Bloqué, 33 Prêt, 5 Backlog.',
    );
  });

  it('dit qu’il n’y a rien à montrer', () => {
    expect(cfdSummary([])).toBe('Flux cumulé : aucun jour à montrer.');
  });
});
