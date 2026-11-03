import { describe, expect, it } from 'vitest';
import { DIMENSION_LABELS, legendOf, projectColor, seriesOf, type SeriesContext } from './series';

/**
 * Le découpage choisi colore le nuage de points et les âges : un type, une priorité ou un Projet a la même couleur
 * partout (cartes du kanban, badges, graphiques). Les types et priorités viennent du code couleur fixe des tickets
 * (design/issue-palette.ts), les Projets de la teinte de leur pastille.
 */

const ctx: SeriesContext = {
  projectName: (id) => ({ bdesk: 'beads-desktop', mpm: 'My-Prompt-Manager' })[id] ?? id,
  projectHue: (id) => ({ bdesk: 200, mpm: 40 })[id] ?? 0,
};

const ticket = (overrides: Partial<{ type: string; priority: number; project: string }> = {}) => ({
  type: 'task',
  priority: 2,
  project: 'bdesk',
  ...overrides,
});

describe('seriesOf', () => {
  it('colore un type avec son code couleur et le nomme en français', () => {
    expect(seriesOf('type', ticket({ type: 'bug' }), ctx)).toEqual({ key: 'bug', label: 'Bug', color: 'var(--type-bug)' });
    expect(seriesOf('type', ticket({ type: 'feature' }), ctx)).toEqual({
      key: 'feature',
      label: 'Fonctionnalité',
      color: 'var(--type-feature)',
    });
  });

  it('donne la couleur neutre à un type personnalisé de beads, et garde son nom', () => {
    expect(seriesOf('type', ticket({ type: 'review' }), ctx)).toEqual({ key: 'review', label: 'review', color: 'var(--type-other)' });
  });

  it('colore une priorité avec son code couleur, du code et du libellé', () => {
    expect(seriesOf('priority', ticket({ priority: 1 }), ctx)).toEqual({ key: '1', label: 'P1 · Haute', color: 'var(--prio-1)' });
    expect(seriesOf('priority', ticket({ priority: 0 }), ctx).label).toBe('P0 · Critique');
  });

  it('colore un Projet de la teinte de sa pastille, et le nomme', () => {
    expect(seriesOf('project', ticket({ project: 'mpm' }), ctx)).toEqual({
      key: 'mpm',
      label: 'My-Prompt-Manager',
      color: 'oklch(var(--series-l) var(--series-c) 40)',
    });
    expect(projectColor(200)).toBe('oklch(var(--series-l) var(--series-c) 200)');
  });
});

describe('legendOf : ce qui est à l’écran, sans doublon, dans un ordre stable', () => {
  it('range les types dans l’ordre du code couleur, puis les types personnalisés par ordre alphabétique', () => {
    const subjects = ['task', 'zzz', 'bug', 'task', 'aaa', 'chore'].map((type) => ticket({ type }));
    expect(legendOf('type', subjects, ctx, []).map((entry) => entry.key)).toEqual(['bug', 'task', 'chore', 'aaa', 'zzz']);
  });

  it('range les priorités de P0 à P4', () => {
    const subjects = [3, 1, 4, 1, 0].map((priority) => ticket({ priority }));
    expect(legendOf('priority', subjects, ctx, []).map((entry) => entry.label)).toEqual([
      'P0 · Critique',
      'P1 · Haute',
      'P3 · Basse',
      'P4 · Minimale',
    ]);
  });

  it('range les Projets dans l’ordre de la réponse, puis les inconnus par ordre alphabétique', () => {
    const subjects = ['zed', 'mpm', 'bdesk', 'mpm', 'abc'].map((project) => ticket({ project }));
    expect(legendOf('project', subjects, ctx, ['bdesk', 'mpm']).map((entry) => entry.key)).toEqual(['bdesk', 'mpm', 'abc', 'zed']);
  });

  it('est vide sans ticket', () => {
    expect(legendOf('type', [], ctx, [])).toEqual([]);
  });
});

describe('DIMENSION_LABELS', () => {
  it('nomme chaque découpage', () => {
    expect(DIMENSION_LABELS).toEqual({ type: 'Type', priority: 'Priorité', project: 'Projet' });
  });
});
