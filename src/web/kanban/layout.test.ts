import { describe, expect, it } from 'vitest';
import { FLEX_SHRINK, rulesFor, selectorOf, type Rule } from '../test/compiledCss';
import { boardLayout, WIDE_REM_PER_COLUMN, type BoardLayout } from './layout';

/**
 * La disposition du tableau selon son nombre de colonnes (bdesk-pz0.4) : de cinq, comme avant, à huit avec les trois Statuts de relais. Ce test lit
 * les règles que Tailwind écrit pour les classes de `layout.ts` dans la feuille de style de l'application (`compiledCss.ts`), et les requêtes de
 * conteneur qui les enveloppent ; jsdom ne met rien en page. Ce qu'il en tire : à quelle largeur du panneau les colonnes passent côte à côte, la largeur
 * de chacune alors, et que le sélecteur de plus de cinq colonnes défile en lui-même au lieu de faire défiler la page. Il ne lit que des requêtes
 * `@container (width >= …rem)` et échoue sur toute autre condition. Il ne voit pas ce que Chromium fait de la rangée qui défile (la position de
 * défilement, ce qu'axe en dit) : `ColumnSelector` la ramène sur le bouton de la colonne affichée.
 */

const REM = 16;
/** L'écart entre deux colonnes côte à côte : le `gap-2` de la grille de `Board`. */
const GAP_PX = 8;

/** La largeur du panneau du tableau à une largeur de fenêtre de bureau : la barre latérale (`w-60`, Sidebar.tsx) et les marges de la page large (`md:px-5`, Page.tsx) en moins. */
const panelAt = (viewport: number) => viewport - 240 - 2 * 20;

const classes = (value: string) => value.split(/\s+/).filter(Boolean);

/** Le seuil d'une requête de conteneur, en px ; toute autre condition fait échouer le test. */
function threshold(condition: string): number {
  const match = /^@container\s*\(width\s*>=\s*([\d.]+)rem\)$/.exec(condition);
  if (!match) throw new Error(`Condition que ce test ne sait pas lire : ${condition}`);
  return Number(match[1]) * REM;
}

/** Ce que les classes `value` déclarent pour `property` dans un panneau de `width` px : la dernière règle qui s'applique, dans l'ordre de la feuille. */
function valueAt(rules: readonly Rule[], value: string, property: string, width: number): string | undefined {
  const selectors = new Set(classes(value).map(selectorOf));
  let found: string | undefined;
  for (const rule of rules) {
    if (!selectors.has(rule.selector) || !(property in rule.declarations)) continue;
    if (rule.within.every((condition) => threshold(condition) <= width)) found = rule.declarations[property];
  }
  return found;
}

/** Les seuils de toutes les requêtes de conteneur des classes `value`. */
function thresholdsOf(rules: readonly Rule[], value: string): number[] {
  const selectors = new Set(classes(value).map(selectorOf));
  return [...new Set(rules.filter((rule) => selectors.has(rule.selector)).flatMap((rule) => rule.within.map(threshold)))];
}

const COUNTS = [5, 6, 7, 8] as const;

async function compiled(layout: BoardLayout): Promise<Rule[]> {
  const all = [layout.grid, layout.column, layout.header, layout.cards, layout.selector, layout.selectorGroup, layout.selectorButton, layout.selectorLabel];
  return rulesFor(all.flatMap(classes));
}

describe('boardLayout : cinq colonnes, comme avant', () => {
  it('garde les classes d’avant les Statuts de relais', () => {
    expect(boardLayout(5)).toEqual({
      grid: '@min-[60rem]:grid @min-[60rem]:grid-cols-5',
      column: '@min-[60rem]:flex',
      header: '@min-[60rem]:sticky @min-[60rem]:top-11',
      cards: '@min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-1',
      selector: '@min-[60rem]:hidden',
      selectorGroup: 'grid grid-cols-5 gap-0.5 rounded-lg border border-line bg-well p-0.5',
      selectorButton: 'flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-md px-0.5 py-1.5 text-micro font-medium transition-colors',
      selectorLabel: 'text-center wrap-anywhere',
      scrolls: false,
    });
  });

  it('borne le nombre de colonnes entre cinq et huit', () => {
    expect(boardLayout(3)).toBe(boardLayout(5));
    expect(boardLayout(9)).toBe(boardLayout(8));
  });
});

describe.each(COUNTS)('boardLayout : %i colonnes', (count) => {
  const layout = boardLayout(count);
  const wide = count * WIDE_REM_PER_COLUMN * REM;

  it('passe toutes les colonnes côte à côte à un seul seuil, 12 rem par colonne : la grille, les colonnes, leurs en-têtes et le sélecteur', async () => {
    const rules = await compiled(layout);

    for (const part of [layout.grid, layout.column, layout.header, layout.selector]) expect(thresholdsOf(rules, part), part).toEqual([wide]);
    // Juste en deçà : une colonne à la fois, avec le sélecteur.
    expect(valueAt(rules, layout.grid, 'display', wide - 1)).toBeUndefined();
    expect(valueAt(rules, layout.selector, 'display', wide - 1)).toBeUndefined();
    // Au seuil : une piste de grille par colonne, toutes affichées, en-têtes collants, sans sélecteur.
    expect(valueAt(rules, layout.grid, 'display', wide)).toBe('grid');
    expect(valueAt(rules, layout.grid, 'grid-template-columns', wide)).toBe(`repeat(${count}, minmax(0, 1fr))`);
    expect(valueAt(rules, layout.column, 'display', wide)).toBe('flex');
    expect(valueAt(rules, layout.header, 'position', wide)).toBe('sticky');
    expect(valueAt(rules, layout.selector, 'display', wide)).toBe('none');
  });

  it('ne donne jamais à une colonne côte à côte moins de largeur qu’à cinq, à un pixel près', () => {
    const column = (panel: number, n: number) => (panel - (n - 1) * GAP_PX) / n;
    const atFive = column(5 * WIDE_REM_PER_COLUMN * REM, 5);
    expect(column(wide, count)).toBeGreaterThanOrEqual(atFive - 1);
  });

  it('range les cartes d’une colonne seule sur plusieurs lignes quand elle a la place, et une par ligne côte à côte', async () => {
    const rules = await compiled(layout);
    const cardColumns = (width: number) => valueAt(rules, layout.cards, 'grid-template-columns', width);

    expect(cardColumns(375)).toBeUndefined();
    expect(cardColumns(36 * REM)).toBe('repeat(2, minmax(0, 1fr))');
    // Au-delà de cinq colonnes, une colonne seule passe à trois cartes par ligne dès 60 rem, jusqu'à ce que toutes tiennent côte à côte.
    if (count > 5) expect(cardColumns(60 * REM)).toBe('repeat(3, minmax(0, 1fr))');
    expect(cardColumns(wide)).toBe('repeat(1, minmax(0, 1fr))');
  });
});

describe('boardLayout : le sélecteur de plus de cinq colonnes, à 375 px', () => {
  it.each([6, 7, 8])('à %i colonnes, défile en lui-même : ses boutons gardent leur nom sur une ligne et ne rétrécissent pas', async (count) => {
    const layout = boardLayout(count);
    const rules = await compiled(layout);

    expect(layout.scrolls).toBe(true);
    expect(valueAt(rules, layout.selectorGroup, 'display', 375)).toBe('flex');
    expect(valueAt(rules, layout.selectorGroup, 'overflow-x', 375)).toBe('auto');
    // Sans largeur minimale, la rangée prend la largeur de la page et défile dedans : la page, elle, ne défile pas de côté.
    expect(valueAt(rules, layout.selectorGroup, 'min-width', 375)).toBeUndefined();
    expect(valueAt(rules, layout.selectorButton, FLEX_SHRINK, 375)).toBe('0');
    expect(valueAt(rules, layout.selectorButton, 'flex-grow', 375)).toBe('1');
    expect(valueAt(rules, layout.selectorLabel, 'white-space', 375)).toBe('nowrap');
  });

  it('à cinq colonnes, garde sa grille de cinq boutons, qui ne défile pas', async () => {
    const layout = boardLayout(5);
    const rules = await compiled(layout);

    expect(layout.scrolls).toBe(false);
    expect(valueAt(rules, layout.selectorGroup, 'grid-template-columns', 375)).toBe('repeat(5, minmax(0, 1fr))');
    expect(valueAt(rules, layout.selectorGroup, 'overflow-x', 375)).toBeUndefined();
  });
});

describe('boardLayout : sur un bureau', () => {
  const sideBySide = (count: number, viewport: number) => panelAt(viewport) >= count * WIDE_REM_PER_COLUMN * REM;

  it('à 1100 px, le panneau (820 px) montre une colonne à la fois, avec ou sans colonnes de relais, comme avant', () => {
    expect(panelAt(1100)).toBe(820);
    for (const count of COUNTS) expect(sideBySide(count, 1100), `${count} colonnes`).toBe(false);
  });

  it('à 1440 px, le panneau (1160 px) montre côte à côte cinq ou six colonnes ; sept ou huit, une à la fois plutôt qu’écrasées', () => {
    expect(panelAt(1440)).toBe(1160);
    expect(COUNTS.map((count) => sideBySide(count, 1440))).toEqual([true, true, false, false]);
  });
});
