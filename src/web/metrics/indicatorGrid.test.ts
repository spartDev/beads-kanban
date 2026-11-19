import { describe, expect, it } from 'vitest';
import { INDICATOR_GRID, INDICATOR_SPANS } from './indicatorGrid';

/**
 * La grille des tuiles des indicateurs : à chaque largeur, les rangées sont pleines (aucune case vide) et le Débit sain est sur la rangée du Débit, juste à
 * côté. Les largeurs sont celles des préfixes de conteneur de la grille ; une portée se lit au préfixe le plus large qui s'applique, à défaut une colonne.
 */

const PREFIXES = ['', '@min-[36rem]:', '@min-[68rem]:'] as const;

/** Le nombre que porte la classe `<nom><n>` de `classes`, au préfixe exact ; undefined sans elle. */
function numberOf(classes: string, name: string): number | undefined {
  const found = classes.split(' ').find((value) => value.startsWith(name) && /^\d+$/.test(value.slice(name.length)));
  return found === undefined ? undefined : Number(found.slice(name.length));
}

/** La valeur de la plus large des largeurs qui s'appliquent à la largeur `tier`. */
function atWidth(classes: string, name: string, tier: number): number | undefined {
  for (let index = tier; index >= 0; index--) {
    const value = numberOf(classes, `${PREFIXES[index]}${name}`);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Les rangées de la grille à la largeur `tier` : les indices des tuiles de chacune, dans l'ordre où la grille les place. */
function rowsAt(tier: number, columns: number): number[][] {
  const rows: number[][] = [];
  let filled = columns;
  INDICATOR_SPANS.forEach((classes, index) => {
    const span = atWidth(classes, 'col-span-', tier) ?? 1;
    if (filled + span > columns) {
      rows.push([]);
      filled = 0;
    }
    rows.at(-1)?.push(index);
    filled += span;
  });
  return rows;
}

describe('la grille des tuiles des indicateurs', () => {
  it('a une portée pour chacune des sept tuiles', () => {
    expect(INDICATOR_SPANS).toHaveLength(7);
  });

  it.each([0, 1, 2])('largeur %i : remplit chaque rangée, et met le Débit sain juste à côté du Débit', (tier) => {
    const columns = atWidth(INDICATOR_GRID, 'grid-cols-', tier) ?? 0;
    const rows = rowsAt(tier, columns);
    const width = (row: number[]) => row.reduce((sum, index) => sum + (atWidth(INDICATOR_SPANS[index] ?? '', 'col-span-', tier) ?? 1), 0);

    expect(columns).toBeGreaterThan(0);
    expect(rows.map(width)).toEqual(rows.map(() => columns));
    expect(rows[0]?.slice(0, 2)).toEqual([0, 1]);
  });
});
