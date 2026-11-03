import { describe, expect, it } from 'vitest';
import type { ColumnId } from './columns';
import { adjacentColumn, type Lanes } from './useBoardShortcuts';

/** Des colonnes avec ou sans cartes ; le tiroir n'entre pas dans la navigation entre colonnes. */
const lanes = (filled: readonly ColumnId[]): Lanes => ({
  backlog: filled.includes('backlog') ? ['a'] : [],
  ready: filled.includes('ready') ? ['b'] : [],
  inProgress: filled.includes('inProgress') ? ['c'] : [],
  blocked: filled.includes('blocked') ? ['d'] : [],
  done: filled.includes('done') ? ['e'] : [],
  paused: ['p'],
});

describe('adjacentColumn : où va « h » ou « l »', () => {
  const all = lanes(['backlog', 'ready', 'inProgress', 'blocked', 'done']);

  it('va à la colonne voisine', () => {
    expect(adjacentColumn(all, 'ready', 1)).toBe('inProgress');
    expect(adjacentColumn(all, 'ready', -1)).toBe('backlog');
  });

  it('s’arrête aux bords du tableau', () => {
    expect(adjacentColumn(all, 'done', 1)).toBeUndefined();
    expect(adjacentColumn(all, 'backlog', -1)).toBeUndefined();
  });

  it('saute les colonnes vides, dans les deux sens', () => {
    const sparse = lanes(['ready', 'done']);
    expect(adjacentColumn(sparse, 'ready', 1)).toBe('done');
    expect(adjacentColumn(sparse, 'done', -1)).toBe('ready');
  });

  it('part d’une colonne vide sans s’y arrêter', () => {
    const sparse = lanes(['backlog', 'done']);
    expect(adjacentColumn(sparse, 'inProgress', 1)).toBe('done');
    expect(adjacentColumn(sparse, 'inProgress', -1)).toBe('backlog');
  });

  it('ne trouve rien quand les autres colonnes sont vides', () => {
    const lonely = lanes(['ready']);
    expect(adjacentColumn(lonely, 'ready', 1)).toBeUndefined();
    expect(adjacentColumn(lonely, 'ready', -1)).toBeUndefined();
  });
});

describe('adjacentColumn sans point de départ : le bord du tableau', () => {
  it('« suivante » prend la première colonne qui a des cartes, « précédente » la dernière', () => {
    const all = lanes(['backlog', 'ready', 'inProgress', 'blocked', 'done']);
    expect(adjacentColumn(all, null, 1)).toBe('backlog');
    expect(adjacentColumn(all, null, -1)).toBe('done');
  });

  it('saute les colonnes vides des bords, dans les deux sens', () => {
    const middle = lanes(['ready', 'inProgress']);
    expect(adjacentColumn(middle, null, 1)).toBe('ready');
    expect(adjacentColumn(middle, null, -1)).toBe('inProgress');
    expect(adjacentColumn(lanes(['blocked']), null, 1)).toBe('blocked');
    expect(adjacentColumn(lanes(['blocked']), null, -1)).toBe('blocked');
  });

  it('ne trouve rien quand aucune colonne n’a de carte : le tiroir « En pause » n’est pas une colonne', () => {
    const onlyPaused = lanes([]);
    expect(onlyPaused.paused).toHaveLength(1);
    expect(adjacentColumn(onlyPaused, null, 1)).toBeUndefined();
    expect(adjacentColumn(onlyPaused, null, -1)).toBeUndefined();
  });
});
