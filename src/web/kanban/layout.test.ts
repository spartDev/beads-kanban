import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { statusLabel } from '../design/issue-palette';
import { CATALOGS } from '../i18n/catalog';
import type { Language } from '../i18n/language';
import { formatAge } from '../lib/relativeTime';
import { FORMATS } from '../metrics/format';
import { FLEX_SHRINK, holds, lengthOf, names, resolved, rootFontSizeOf, rulesFor, selectorOf, type Rule } from '../test/compiledCss';
import { KERNING_ALLOWANCE, MONO_FILE, SANS_FILE, textMeasurer } from '../test/fontMetrics';
import { COLUMN_IDS } from './columns';
import { boardLayout, NARROW_COLUMN_REM, NARROW_REM_PER_COLUMN, WIDE_REM_PER_COLUMN, type BoardLayout } from './layout';
import { columnMeta, daysLabel } from './meta';
import { doneDayChoices } from './params';

/**
 * La disposition du tableau selon son nombre de colonnes (bdesk-pz0.4) : cinq, comme avant, 12 rem par colonne ; six à huit avec les Statuts de
 * relais, 7,7 rem par colonne, pour que les huit tiennent côte à côte à 1 440 px. Ce test lit les règles que Tailwind écrit pour les classes de
 * `layout.ts` dans la feuille de style de l'application (`compiledCss.ts`), et les requêtes de conteneur qui les enveloppent ; il n'en lit que des
 * `@container (width >= …rem)` et échoue sur toute autre condition.
 *
 * Tout ce qui se compte en rem se lit à la taille de la racine, lue dans styles.css (`html { font-size: 112,5 % }`, 18 px), et non à 16 px : une
 * requête de conteneur et une longueur en rem comptent en rem de la racine (seule une requête de média compte en rem du navigateur, 16 px). La
 * largeur du panneau se tire de la barre latérale (`<aside>` de Sidebar.tsx) et de la page large (Page.tsx), leurs classes lues dans leur source.
 *
 * jsdom ne met rien en page : la largeur des textes se mesure dans les fichiers de police de l'application (`fontMetrics.ts`, étalonné sur Chromium),
 * aux tailles que leurs classes donnent dans la feuille (15,75 px pour `text-ui`, 13,5 px pour `text-xs` et `text-micro`), plus la marge du crénage
 * (`KERNING_ALLOWANCE`) ; les pictogrammes et les bordures, eux, sont en px et ne grandissent pas avec la racine. La mise en page d'un en-tête ou
 * d'une carte se refait ici, à la main, d'après leurs classes (`Column.tsx`, `Card.tsx`). Ce qu'il ne voit pas : l'arrondi au pixel, la largeur
 * exacte de la flèche d'une liste native, la position de défilement du sélecteur (`ColumnSelector` la ramène sur le bouton de la colonne affichée).
 */

const source = (path: string) => readFileSync(join(import.meta.dirname, path), 'utf8');
const classes = (value: string) => value.split(/\s+/).filter(Boolean);
const matched = (match: RegExpExecArray | null, what: string): string => {
  if (!match?.[1]) throw new Error(`Introuvable dans la source : ${what}`);
  return match[1];
};

/** Une feuille compilée pour toutes les classes que ce test lit : celles de la page, du tableau, et des textes. */
async function sheetFor(values: readonly string[]): Promise<Rule[]> {
  return rulesFor(values.flatMap(classes));
}

/** Ce que les classes `value` déclarent pour `property` à cette largeur de fenêtre (requêtes de média seulement) : la dernière règle qui s'applique. */
function atViewport(sheet: readonly Rule[], value: string, property: string, viewport: number): string | undefined {
  const selectors = new Set(classes(value).map(selectorOf));
  let found: string | undefined;
  for (const rule of sheet) {
    if (!selectors.has(rule.selector) || !(property in rule.declarations)) continue;
    if (rule.within.every((condition) => holds(condition, viewport))) found = rule.declarations[property];
  }
  return found;
}

// Les classes lues dans la source des composants, et non recopiées : la barre latérale, la page large, la grille du tableau.
const SIDEBAR = matched(/<aside className="([^"]+)"/.exec(source('../shell/Sidebar.tsx')), 'la barre latérale (<aside className="…">)');
const PAGE = matched(/'(mx-auto flex w-full [^']+)'/.exec(source('../pages/Page.tsx')), 'les classes de la page');
const WIDE_PAGE = matched(/wide \? '([^']+)'/.exec(source('../pages/Page.tsx')), 'les classes de la page large');
const GRID = matched(/cx\('([^']+)', layout\.grid\)/.exec(source('./Board.tsx')), 'la grille du tableau');
// L'en-tête d'une colonne (ses marges, sa ligne de texte, la liste de Terminé) et la carte (sa marge de défilement, son anneau de focus).
const HEADER = matched(/<header className=\{cx\('([^']+)', layout\.header\)\}/.exec(source('./Column.tsx')), 'l’en-tête d’une colonne');
const HEADER_ROW = matched(/<div className=\{cx\('([^']+)', layout\.headerRow\)\}/.exec(source('./Column.tsx')), 'la ligne de l’en-tête');
const DONE_SELECT = matched(/className="(ml-auto h-6 [^"]+)"/.exec(source('./Column.tsx')), 'la liste de Terminé');
const CARD = matched(/'(relative flex scroll-mb-20 [^']+)'/.exec(source('./Card.tsx')), 'la carte');
// Le sélecteur de colonne, collant au-dessus d'une colonne seule, et le compte de chacun de ses boutons.
const SELECTOR = matched(/<div data-column-selector className=\{cx\('([^']+)', layout\.selector\)\}/.exec(source('./ColumnSelector.tsx')), 'le sélecteur de colonne');
const SELECTOR_COUNT = matched(/<span className="(tnum text-xs [^"]+)">/.exec(source('./ColumnSelector.tsx')), 'le compte d’un bouton du sélecteur');
const BODY_TEXT = 'body';

const TEXT = { ui: 'text-ui', xs: 'text-xs', micro: 'text-micro', semibold: 'font-semibold', medium: 'font-medium' } as const;
const LAYOUT_PARTS = (layout: BoardLayout) => [
  layout.grid,
  layout.column,
  layout.body ?? '',
  layout.header,
  layout.headerRow,
  layout.headerIcon,
  layout.title,
  layout.cards,
  layout.card.item,
  layout.card.title,
  layout.card.badges,
  layout.card.priorityGlyph,
  layout.selector,
  layout.selectorGroup,
  layout.selectorButton,
  layout.selectorLabel,
];
const COUNTS = [5, 6, 7, 8] as const;
const sheet = await sheetFor([SIDEBAR, PAGE, WIDE_PAGE, GRID, HEADER, HEADER_ROW, DONE_SELECT, CARD, SELECTOR, SELECTOR_COUNT, ...Object.values(TEXT), ...COUNTS.flatMap((count) => LAYOUT_PARTS(boardLayout(count)))]);
const ROOT = rootFontSizeOf(sheet);
const px = (value: string) => lengthOf(sheet, value, ROOT);
/** `n` unités d'espacement de Tailwind (`px-1.5` : 1,5), lues dans la feuille (`--spacing`). */
const unit = (n: number) => px(`calc(var(--spacing) * ${n})`);

/** La largeur du panneau du tableau à une largeur de fenêtre de bureau : la barre latérale et les marges de la page large en moins. */
function panelAt(viewport: number): number {
  if (atViewport(sheet, SIDEBAR, 'display', viewport) !== 'flex') throw new Error(`Pas de barre latérale à ${viewport} px`);
  const sidebar = px(atViewport(sheet, SIDEBAR, 'width', viewport) ?? '0px');
  const padding = px(atViewport(sheet, `${PAGE} ${WIDE_PAGE}`, 'padding-inline', viewport) ?? '0px');
  return viewport - sidebar - 2 * padding;
}
/** L'écart entre deux colonnes côte à côte : celui de la grille de `Board`. */
const GAP = px(atViewport(sheet, GRID, 'gap', 1440) ?? '0px');
/** La largeur d'une colonne côte à côte : le panneau, moins les écarts, partagé. */
const columnWidth = (panel: number, count: number) => (panel - (count - 1) * GAP) / count;
/** Le seuil où `count` colonnes passent côte à côte, en px. */
const thresholdPx = (count: number) => count * (count === 5 ? WIDE_REM_PER_COLUMN : NARROW_REM_PER_COLUMN) * ROOT;

/**
 * Les tailles des conteneurs que les classes interrogent : le tableau (`board`, ou sans nom : le plus proche, le tableau hors d'une colonne), et le
 * contenu d'une colonne (`column`, de six à huit colonnes) ; sans `column`, les requêtes qui la visent ne valent rien.
 */
interface Sizes {
  board: number;
  column?: number;
}
const sizesOf = (sizes: number | Sizes): Sizes => (typeof sizes === 'number' ? { board: sizes } : sizes);

/** Une requête de conteneur : son nom, son sens et son seuil, en px ; toute autre condition fait échouer le test. */
function conditionOf(condition: string): { name: 'board' | 'column' | undefined; below: boolean; limit: number } {
  const match = /^@container(?:\s+(board|column))?\s*\(width\s*(>=|<)\s*([\d.]+)rem\)$/.exec(condition);
  if (!match) throw new Error(`Condition que ce test ne sait pas lire : ${condition}`);
  return { name: match[1] as 'board' | 'column' | undefined, below: match[2] === '<', limit: Number(match[3]) * ROOT };
}

/** La condition vaut-elle à ces tailles ? Une requête sans nom vise ici le tableau : ce test vérifie à part qu'aucune n'est dans une colonne-conteneur. */
function holdsIn(condition: string, sizes: Sizes): boolean {
  const { name, below, limit } = conditionOf(condition);
  const size = name === 'column' ? sizes.column : sizes.board;
  if (size === undefined) return false;
  return below ? size < limit : size >= limit;
}

/** Ce que les classes `value` déclarent pour `property` à ces tailles (un nombre : le tableau seul) : la dernière règle qui s'applique. */
function valueAt(value: string, property: string, sizes: number | Sizes): string | undefined {
  const at = sizesOf(sizes);
  const selectors = new Set(classes(value).map(selectorOf));
  let found: string | undefined;
  for (const rule of sheet) {
    if (!selectors.has(rule.selector) || !(property in rule.declarations)) continue;
    if (rule.within.every((condition) => holdsIn(condition, at))) found = rule.declarations[property];
  }
  return found;
}

/** Les requêtes de conteneur de toutes les classes `value`, sélecteurs composés compris (`[&>span]:…`), telles que la feuille les écrit. */
function conditionsOf(value: string): string[] {
  const selectors = classes(value).map(selectorOf);
  const own = sheet.filter((rule) => selectors.some((selector) => names(rule, selector)));
  return [...new Set(own.flatMap((rule) => rule.within))].sort();
}

/** Ce que la classe `name` déclare, à ces tailles, pour les descendants que son sélecteur vise (`[&>span>svg]:hidden` : `… > span > svg`). */
function descendantsAt(name: string, property: string, sizes: number | Sizes): { selector: string; value: string }[] {
  const at = sizesOf(sizes);
  return sheet
    .filter((rule) => names(rule, selectorOf(name)) && rule.selector !== selectorOf(name) && property in rule.declarations)
    .filter((rule) => rule.within.every((condition) => holdsIn(condition, at)))
    .map((rule) => ({ selector: rule.selector.slice(selectorOf(name).length).trim(), value: rule.declarations[property] as string }));
}

/** La bordure d'une colonne et d'une carte (`border`, 1 px). */
const BORDER = 1;
/** Le contenu d'une colonne côte à côte (le conteneur `column`) : sa largeur, sa bordure en moins. */
const columnContent = (panel: number, count: number) => columnWidth(panel, count) - 2 * BORDER;
/** Le seuil du contenu d'une colonne en deçà duquel la carte s'allège, en px. */
const NARROW_COLUMN = NARROW_COLUMN_REM * ROOT;

describe('le modèle : la racine, le panneau, l’écart', () => {
  it('lit la racine à 112,5 % : 18 px le rem', () => {
    expect(ROOT).toBe(18);
  });

  it('tire le panneau de la barre latérale et de la page large : la fenêtre moins 17,5 rem, 1 125 px à 1 440 px', () => {
    expect(panelAt(1440)).toBe(1440 - 17.5 * ROOT);
    expect(panelAt(1440)).toBe(1125);
    expect(GAP).toBe(0.5 * ROOT);
  });
});

describe('boardLayout : cinq colonnes, comme avant', () => {
  it('garde les classes et le seuil d’avant les Statuts de relais', () => {
    expect(boardLayout(5)).toEqual({
      grid: '@min-[60rem]:grid @min-[60rem]:grid-cols-5',
      column: '@min-[60rem]:flex',
      body: null,
      header: '@min-[60rem]:sticky @min-[60rem]:top-11',
      headerRow: '',
      headerIcon: '',
      title: '',
      inlineHeader: false,
      cards: '@min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-1',
      card: { item: '', title: '', badges: '', priorityGlyph: '' },
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

describe('les seuils : 12 rem par colonne à cinq, 7,7 rem de six à huit', () => {
  it('donne 60 rem à cinq colonnes, puis 46,2, 53,9 et 61,6 rem', () => {
    expect(COUNTS.map((count) => Number((thresholdPx(count) / ROOT).toFixed(2)))).toEqual([60, 46.2, 53.9, 61.6]);
  });

  it('fait tenir les huit colonnes côte à côte à 1 440 px, avec la place d’une barre de défilement de 15 px : 1 108,8 px pour 1 125 px', () => {
    expect(thresholdPx(8)).toBeCloseTo(1108.8);
    for (const count of COUNTS) expect(panelAt(1440) - thresholdPx(count), `${count} colonnes`).toBeGreaterThanOrEqual(15);
  });

  it('donne à 1 440 px des colonnes d’environ 133 px à huit ; à cinq, 217,8 px, et 208,8 px au seuil', () => {
    expect(columnWidth(panelAt(1440), 8)).toBeCloseTo(132.75);
    expect(columnWidth(panelAt(1440), 5)).toBeCloseTo(217.8);
    expect(columnWidth(thresholdPx(5), 5)).toBeCloseTo(208.8);
  });

  it('montre une colonne à la fois à 1 100 px (un panneau de 785 px), avec ou sans colonnes de relais', () => {
    expect(panelAt(1100)).toBe(785);
    for (const count of COUNTS) expect(panelAt(1100) >= thresholdPx(count), `${count} colonnes`).toBe(false);
  });

  it('donne au seuil au moins 130,7 px à une colonne parmi six à huit, la plus étroite à huit', () => {
    const widths = [6, 7, 8].map((count) => columnWidth(thresholdPx(count), count));
    expect(Math.min(...widths)).toBeCloseTo(130.7, 1);
    expect(Math.min(...widths)).toBe(widths[2]);
  });
});

describe.each(COUNTS)('boardLayout : %i colonnes', (count) => {
  const layout = boardLayout(count);
  const wide = thresholdPx(count);
  const T = `${Number((wide / ROOT).toFixed(2))}rem`;
  /** Ce que contient une colonne : l'en-tête, la liste et la carte. */
  const inside = [layout.header, layout.headerRow, layout.headerIcon, layout.title, layout.cards, layout.card.item, layout.card.title, layout.card.badges, layout.card.priorityGlyph];

  it('passe toutes les colonnes côte à côte à un seul seuil du tableau : la grille, les colonnes, leurs en-têtes, et le sélecteur', () => {
    const side = count === 5 ? `@container (width >= ${T})` : `@container board (width >= ${T})`;
    for (const part of [layout.grid, layout.column, layout.selector]) expect(conditionsOf(part), part).toEqual([`@container (width >= ${T})`]);
    for (const part of [layout.header, layout.headerRow, layout.headerIcon, layout.title]) expect(conditionsOf(part), part).toEqual(part === '' ? [] : [side]);
    // Juste en deçà : une colonne à la fois, avec le sélecteur.
    expect(valueAt(layout.grid, 'display', wide - 1)).toBeUndefined();
    expect(valueAt(layout.selector, 'display', wide - 1)).toBeUndefined();
    // Au seuil : une piste de grille par colonne, toutes affichées, en-têtes collants, sans sélecteur.
    expect(valueAt(layout.grid, 'display', wide)).toBe('grid');
    expect(valueAt(layout.grid, 'grid-template-columns', wide)).toBe(`repeat(${count}, minmax(0, 1fr))`);
    expect(valueAt(layout.column, 'display', wide)).toBe(count === 5 ? 'flex' : 'grid');
    expect(valueAt(layout.header, 'position', wide)).toBe('sticky');
    expect(valueAt(layout.selector, 'display', wide)).toBe('none');
  });

  it('range les cartes d’une colonne seule sur deux par ligne quand elle a la place, et une par ligne côte à côte, à toute largeur', () => {
    const cardColumns = (width: number) => valueAt(layout.cards, 'grid-template-columns', width);

    expect(cardColumns(375)).toBeUndefined();
    expect(cardColumns(36 * ROOT)).toBe('repeat(2, minmax(0, 1fr))');
    for (const width of [wide, wide + 200, 2560]) expect(cardColumns(width), `${width} px`).toBe('repeat(1, minmax(0, 1fr))');
  });

  if (count === 5) {
    it('ne fait pas de la colonne un conteneur, ne réunit pas la liste dans un bloc, et n’allège jamais la carte', () => {
      expect(classes(layout.column).some((name) => name.startsWith('@container'))).toBe(false);
      expect(layout.body).toBeNull();
      expect(Object.values(layout.card).every((value) => value === '')).toBe(true);
    });
  } else {
    it('fait du bloc qui suit l’en-tête un conteneur nommé, pas de la colonne, et ce qu’il contient ne vise jamais un conteneur sans nom', () => {
      expect(layout.body).toBe('@container/column');
      expect(valueAt(layout.body as string, 'container-type', wide)).toBe('inline-size');
      expect(valueAt(layout.body as string, 'container-name', wide)).toBe('column');
      // Un conteneur a un confinement de mise en page, et un élément confiné n'est jamais une sous-grille : la colonne n'en est pas un.
      expect(classes(layout.column).some((name) => name.startsWith('@container'))).toBe(false);
      for (const part of inside) {
        for (const condition of conditionsOf(part)) expect(conditionOf(condition).name, `${part} : ${condition}`).toBeDefined();
      }
    });

    it('écrit côte à côte l’en-tête comme une ligne de texte, et aligne les en-têtes : chaque colonne est une sous-grille de deux rangées', () => {
      expect(layout.inlineHeader).toBe(true);
      expect(valueAt(layout.header, 'padding-inline', wide)).toBe('calc(var(--spacing) * 1.5)');
      expect(valueAt(layout.headerRow, 'display', wide)).toBe('block');
      expect(valueAt(layout.headerIcon, 'display', wide)).toBe('inline');
      expect(valueAt(layout.headerIcon, 'margin-right', wide)).toBe('calc(var(--spacing) * 1.5)');
      expect(valueAt(layout.title, 'display', wide)).toBe('inline');
      expect(valueAt(layout.grid, 'row-gap', wide)).toBe('0px');
      expect(valueAt(layout.column, 'grid-row', wide)).toBe('span 2 / span 2');
      expect(valueAt(layout.column, 'grid-template-rows', wide)).toBe('subgrid');
      // La colonne affichée (`data-[shown=true]:flex`, plus précise) est une sous-grille elle aussi.
      expect(classes(layout.column)).toContain(`@min-[${T}]:data-[shown=true]:grid`);
      // En deçà, une colonne seule garde l'en-tête d'avant.
      expect(valueAt(layout.header, 'padding-inline', wide - 1)).toBeUndefined();
      for (const part of [layout.headerRow, layout.headerIcon, layout.title, layout.column]) expect(valueAt(part, 'display', wide - 1), part).toBeUndefined();
      expect(valueAt(layout.grid, 'row-gap', wide - 1)).toBeUndefined();
    });

    it('allège la carte quand sa colonne a moins de 9,5 rem de contenu, et seulement alors, quel que soit le nombre de colonnes', () => {
      const narrow = { board: wide, column: NARROW_COLUMN - 1 };
      const roomy = { board: wide, column: NARROW_COLUMN };
      for (const part of [layout.cards, layout.card.item, layout.card.title, layout.card.badges, layout.card.priorityGlyph]) {
        expect(conditionsOf(part).filter((condition) => conditionOf(condition).name === 'column'), part).toEqual(['@container column (width < 9.5rem)']);
      }
      expect(valueAt(layout.cards, 'padding-inline', narrow)).toBe('calc(var(--spacing) * 0.5)');
      expect(valueAt(layout.card.item, 'padding-inline', narrow)).toBe('calc(var(--spacing) * 1.5)');
      expect(valueAt(layout.card.title, 'hyphens', narrow)).toBe('auto');
      expect(valueAt(layout.card.priorityGlyph, 'display', narrow)).toBe('none');
      // Les pastilles : leur pictogramme masqué, et chacune peut rétrécir, donc passer elle-même à la ligne entre deux mots.
      const [shrinks, hidesIcon] = classes(layout.card.badges);
      expect(descendantsAt(shrinks as string, FLEX_SHRINK, narrow)).toEqual([{ selector: '> span', value: '1' }]);
      expect(descendantsAt(hidesIcon as string, 'display', narrow)).toEqual([{ selector: '> span > svg', value: 'none' }]);
      // Une colonne de 9,5 rem ou plus garde la carte d'avant, à toute largeur du tableau.
      expect(valueAt(layout.cards, 'padding-inline', roomy)).toBeUndefined();
      for (const part of [layout.card.item, layout.card.title, layout.card.priorityGlyph]) expect(valueAt(part, 'padding-inline', roomy) ?? valueAt(part, 'display', roomy) ?? valueAt(part, 'hyphens', roomy), part).toBeUndefined();
      expect(descendantsAt(hidesIcon as string, 'display', roomy)).toEqual([]);
    });

    it('allège la carte au seuil ; à 1 440 px, à sept et huit colonnes, pas à six (178 px de contenu) ; ni à 2 560 px, ni à une colonne seule', () => {
      const lightened = (sizes: Sizes) => valueAt(layout.card.priorityGlyph, 'display', sizes) === 'none';
      expect(lightened({ board: wide, column: columnContent(wide, count) })).toBe(true);
      expect(columnContent(panelAt(1440), count)).toBeCloseTo({ 6: 178, 7: 151, 8: 130.75 }[count] as number, 1);
      expect(lightened({ board: panelAt(1440), column: columnContent(panelAt(1440), count) })).toBe(count > 6);
      // 2 560 px : des colonnes de 367 px à six, 274 px à huit.
      expect(columnContent(panelAt(2560), count)).toBeGreaterThan(NARROW_COLUMN);
      expect(lightened({ board: panelAt(2560), column: columnContent(panelAt(2560), count) })).toBe(false);
      // Une colonne seule prend la largeur du tableau (sa bordure en moins), 339 px à 375 px.
      expect(lightened({ board: 339, column: 337 })).toBe(false);
    });
  }
});

describe('boardLayout : le sélecteur de plus de cinq colonnes', () => {
  /** L'anneau de focus de l'application (styles.css) : son épaisseur et son décalage, qu'un groupe qui défile rognerait sans remplissage. */
  const ring = (() => {
    const rule = /:where\([^)]*\):focus-visible\s*\{([^}]*)\}/.exec(source('../styles.css'))?.[1] ?? '';
    const width = /outline:\s*([\d.]+)px solid/.exec(rule)?.[1];
    const offset = /outline-offset:\s*([\d.]+)px/.exec(rule)?.[1];
    if (!width || !offset) throw new Error('styles.css : anneau de focus introuvable');
    return Number(width) + Number(offset);
  })();

  it.each([6, 7, 8])('à %i colonnes, défile en lui-même à 375 px : ses boutons gardent leur nom sur une ligne et ne rétrécissent pas', (count) => {
    const layout = boardLayout(count);

    expect(layout.scrolls).toBe(true);
    expect(valueAt(layout.selectorGroup, 'display', 375)).toBe('flex');
    expect(valueAt(layout.selectorGroup, 'overflow-x', 375)).toBe('auto');
    // Sans largeur minimale, la rangée prend la largeur de la page et défile dedans : la page, elle, ne défile pas de côté.
    expect(valueAt(layout.selectorGroup, 'min-width', 375)).toBeUndefined();
    expect(valueAt(layout.selectorButton, FLEX_SHRINK, 375)).toBe('0');
    expect(valueAt(layout.selectorButton, 'flex-grow', 375)).toBe('1');
    expect(valueAt(layout.selectorLabel, 'white-space', 375)).toBe('nowrap');
  });

  it.each([6, 7, 8])('à %i colonnes, laisse dans la rangée qui défile la place de l’anneau de focus d’un bouton, de chaque côté', (count) => {
    const layout = boardLayout(count);
    const padding = px(valueAt(layout.selectorGroup, 'padding', 375) ?? '0px');

    expect(ring).toBe(4);
    expect(padding).toBeGreaterThanOrEqual(ring);
  });

  /** Une longueur que les classes `value` déclarent pour `property` à cette largeur de fenêtre ; un nombre sans unité compte en `font-size`. */
  const lengthAt = (value: string, property: string, viewport: number, fontSize?: () => number) =>
    lengthOf(sheet, resolved(sheet, atViewport(sheet, value, property, viewport) as string), ROOT, fontSize);

  /**
   * Le bas du sélecteur collant, à cette largeur de fenêtre, refait d'après ses classes : où il colle (`top-12`, `md:top-11`, sous la barre du
   * haut), ses marges (`py-1.5`), la bordure et le remplissage de sa rangée (`border`, `p-1`), et un bouton : ses marges (`py-1.5`), son nom sur
   * une ligne (`text-micro`), l'écart (`gap-0.5`), son compte (`text-xs`).
   */
  function selectorBottom(layout: BoardLayout, viewport: number): number {
    const font = (value: string) => () => lengthAt(value, 'font-size', viewport);
    const wrapper = lengthAt(SELECTOR, 'top', viewport) + 2 * lengthAt(SELECTOR, 'padding-block', viewport);
    const group = 2 * lengthAt(layout.selectorGroup, 'border-width', viewport) + 2 * lengthAt(layout.selectorGroup, 'padding', viewport);
    const button =
      2 * lengthAt(layout.selectorButton, 'padding-block', viewport) +
      lengthAt(layout.selectorButton, 'line-height', viewport, font(layout.selectorButton)) +
      lengthAt(layout.selectorButton, 'gap', viewport) +
      lengthAt(SELECTOR_COUNT, 'line-height', viewport, font(SELECTOR_COUNT));
    return wrapper + group + button;
  }

  it.each([6, 7, 8])('à %i colonnes, une colonne à la fois : la carte remontée au clavier s’arrête sous le sélecteur collant, anneau de focus compris', (count) => {
    const layout = boardLayout(count);
    // En deçà du seuil, les en-têtes ne collent pas : seul le sélecteur, sous la barre du haut, couvre le haut de la colonne affichée.
    const below = thresholdPx(count) - 1;
    expect(valueAt(layout.selector, 'display', below)).toBeUndefined();
    expect(valueAt(layout.header, 'position', { board: below, column: below - 2 * BORDER })).toBeUndefined();
    // L'anneau de focus de la carte (`ring-2`) déborde de 2 px au-dessus d'elle.
    const cardRing = Number(matched(/(?:^|:)ring-(\d+)(?:\s|$)/.exec(CARD), 'l’anneau de focus de la carte'));
    // Au téléphone, la barre du haut est plus haute (`top-12`) qu'à partir de `md` (`top-11`) : 134,5 px et 130 px.
    const needs = [375, 1440].map((viewport) => selectorBottom(layout, viewport) + cardRing);
    expect(needs).toEqual([134.5, 130]);
    const needed = Math.max(...needs);
    for (const board of [343, below]) {
      const margin = px(valueAt(`${CARD} ${layout.card.item}`, 'scroll-margin-top', { board, column: board - 2 * BORDER }) as string);
      expect(margin, `${margin} px pour ${needed} px, à ${board} px de tableau`).toBeGreaterThanOrEqual(needed);
      // Pas plus qu'il ne faut : une carte remontée au clavier ne s'éloigne pas du sélecteur de plus d'une demi-rem.
      expect(margin - needed).toBeLessThan(ROOT / 2);
    }
  });

  it('à cinq colonnes, ne change rien à la carte : elle garde la marge d’avant (`scroll-mt-28`, Card.tsx)', () => {
    expect(boardLayout(5).card.item).toBe('');
    expect(valueAt(CARD, 'scroll-margin-top', 0)).toBe('calc(var(--spacing) * 28)');
  });

  it('à cinq colonnes, garde sa grille de cinq boutons, qui ne défile pas : l’anneau en déborde sans être rogné', () => {
    const layout = boardLayout(5);

    expect(layout.scrolls).toBe(false);
    expect(valueAt(layout.selectorGroup, 'grid-template-columns', 375)).toBe('repeat(5, minmax(0, 1fr))');
    expect(valueAt(layout.selectorGroup, 'overflow-x', 375)).toBeUndefined();
  });
});

/**
 * Une colonne étroite, au seuil de six, sept et huit colonnes, lue avec les polices de l'application, aux tailles réelles : libellé `text-ui`
 * `font-semibold`, espaces de l'en-tête dans la police du corps, compte `text-xs` en chiffres tabulaires, pastilles `text-micro` `font-medium`, âge,
 * règle et pastille de statut `text-xs`, identifiant `font-mono text-xs`. Pictogrammes et bordures en px.
 */
describe.each([6, 7, 8])('à %i colonnes côte à côte, au seuil, une colonne étroite reste lisible : chaque texte tient, en français et en anglais', (count) => {
  const layout = boardLayout(count);
  const wide = thresholdPx(count);
  const sans = textMeasurer(SANS_FILE);
  const mono = textMeasurer(MONO_FILE);
  const font = (text: string) => px(atViewport(sheet, text, 'font-size', 1440) as string);
  const weight = (name: string) => Number(resolved(sheet, atViewport(sheet, name, 'font-weight', 1440) as string));
  const UI = font(TEXT.ui);
  const XS = font(TEXT.xs);
  const MICRO = font(TEXT.micro);
  const BODY = px(sheet.find((rule) => rule.selector === BODY_TEXT && 'font-size' in rule.declarations)?.declarations['font-size'] as string);
  const SEMIBOLD = weight(TEXT.semibold);
  const MEDIUM = weight(TEXT.medium);
  /** Une largeur de texte, crénage compris. */
  const text = (value: string, size: number, weightOf = 400) => sans(value, { size, weight: weightOf }) + KERNING_ALLOWANCE;
  const column = columnWidth(wide, count);
  /** Au seuil : le tableau, et le contenu de la colonne, sous les 9,5 rem où la carte s'allège. */
  const sizes = { board: wide, column: columnContent(wide, count) };
  const spacing = (property: string, value: string) => px(valueAt(value, property, sizes) as string);
  /** L'en-tête : bordure de la colonne et ses marges resserrées (`layout.header`). */
  const header = column - 2 * BORDER - 2 * spacing('padding-inline', layout.header);
  /** Une carte : bordure de la colonne, marges de la liste (`layout.cards`), bordure de la carte et ses marges (`layout.card.item`). */
  const card = column - 2 * BORDER - 2 * spacing('padding-inline', layout.cards) - 2 * BORDER - 2 * spacing('padding-inline', layout.card.item);
  /** Le pictogramme d'une colonne (`size={14}`, Column.tsx), et sa marge à droite dans la ligne de texte. */
  const HEADER_ICON = 14 + spacing('margin-right', layout.headerIcon);
  /** Un compte : chiffres tabulaires, chacun de la largeur du plus large. */
  const digit = Math.max(...[...'0123456789'].map((d) => sans(d, { size: XS })));
  const LANGUAGES: Language[] = ['fr', 'en'];

  it('lit les tailles réelles : 15,75 px pour le libellé, 13,5 px pour le reste, et des colonnes d’au moins 130,7 px, toutes étroites', () => {
    expect([UI, XS, MICRO, BODY, SEMIBOLD, MEDIUM]).toEqual([15.75, 13.5, 13.5, 15.75, 600, 500]);
    expect(column).toBeGreaterThanOrEqual(130.7);
    expect(sizes.column).toBeLessThan(NARROW_COLUMN);
    expect(header).toBeGreaterThanOrEqual(115.2);
    expect(card).toBeGreaterThanOrEqual(108.7);
  });

  /**
   * L'en-tête comme le navigateur le range dans une colonne étroite (`layout.inlineHeader`) : une ligne de texte où se suivent le pictogramme (une
   * boîte, après laquelle la ligne peut passer à la ligne), les mots du libellé, une espace, le compte, et pour Terminé une espace et sa liste. La
   * ligne passe à la ligne entre deux de ces morceaux, jamais dans l'un d'eux ; `over` : ce dont le plus large dépasse la ligne.
   */
  function headerLines(label: string, countWidth: number, select?: number) {
    const words = label.split(' ');
    const space = { label: sans(' ', { size: UI, weight: SEMIBOLD }), body: sans(' ', { size: BODY }) };
    const pieces: { gap: number; width: number }[] = [
      { gap: 0, width: HEADER_ICON },
      ...words.map((word, index) => ({ gap: index === 0 ? 0 : space.label, width: text(word, UI, SEMIBOLD) })),
      { gap: space.body, width: countWidth },
      ...(select === undefined ? [] : [{ gap: space.body, width: select }]),
    ];
    let lines = 1;
    let line = 0;
    let over = 0;
    for (const { gap, width } of pieces) {
      over = Math.max(over, width - header);
      if (line > 0 && line + gap + width > header) {
        lines++;
        line = width;
      } else line = line === 0 ? width : line + gap + width;
    }
    return { lines, over };
  }

  /** La liste de Terminé : son option la plus longue, ses marges (`pl-1.5 pr-0.5`), sa bordure, et la flèche native (24 px au plus). */
  const select = (language: Language) => Math.max(...doneDayChoices(7).map((days) => text(daysLabel(days, language), XS))) + unit(1.5) + unit(0.5) + 2 * BORDER + 24;

  it.each(LANGUAGES)('en %s, chaque en-tête tient sur une ou deux lignes, sans couper un mot, jusqu’à 999 cartes', (language) => {
    const failures: string[] = [];
    for (const id of COLUMN_IDS) {
      const { label } = columnMeta(language)[id];
      for (const digits of [1, 2, 3]) {
        const { lines, over } = headerLines(label, digits * digit + KERNING_ALLOWANCE);
        if (over > 0 || lines > 2) failures.push(`${label}, ${digits} chiffres : ${lines} lignes, ${over.toFixed(1)} px de trop`);
      }
    }
    expect(failures).toEqual([]);
  });

  it.each(LANGUAGES)('en %s, Terminé garde sa liste dans l’en-tête : sur la ligne, ou seule sur la suivante, sans déborder', (language) => {
    const { label } = columnMeta(language).done;
    const { lines, over } = headerLines(label, 3 * digit + KERNING_ALLOWANCE, select(language));
    expect(over).toBeLessThanOrEqual(0);
    expect(lines).toBeLessThanOrEqual(3);
  });

  it.each(LANGUAGES)('en %s, aucun mot d’un en-tête ne déborde, même à 9 999 cartes, ni de sa règle', (language) => {
    const failures: string[] = [];
    for (const id of COLUMN_IDS) {
      const meta = columnMeta(language)[id];
      const { over } = headerLines(meta.label, 4 * digit + KERNING_ALLOWANCE);
      if (over > 0) failures.push(`${meta.label} : ${over.toFixed(1)} px de trop`);
      for (const days of doneDayChoices(7)) {
        for (const word of meta.hint(days).split(' ')) if (text(word, XS) > header) failures.push(`règle de ${meta.label} : « ${word} »`);
      }
    }
    expect(failures).toEqual([]);
  });

  /** Combien de lignes il faut à `value`, en `text-xs`, sur une ligne de `width` px : il passe à la ligne entre deux mots. */
  function xsLines(value: string, width: number): number {
    const space = sans(' ', { size: XS });
    let lines = 1;
    let line = 0;
    for (const word of value.split(' ')) {
      const size = text(word, XS);
      if (line > 0 && line + space + size > width) {
        lines++;
        line = size;
      } else line = line === 0 ? size : line + space + size;
    }
    return lines;
  }

  /** La largeur d'un compte écrit dans `language` (« 1 067 », « 1,067 ») : chiffres tabulaires, séparateur de milliers compris. */
  const countWidth = (count: number, language: Language) =>
    [...FORMATS[language].formatCount(count)].reduce((width, char) => width + (/\d/.test(char) ? digit : sans(char, { size: XS })), 0) + KERNING_ALLOWANCE;

  /**
   * La hauteur d'un en-tête dans une colonne étroite, comme le navigateur le range : ses marges (`pt-2.5`, `pb-1.5`) ; sa ligne de texte
   * (`headerLines`), chaque ligne de la hauteur de ligne du corps, celle où tient la liste de Terminé de la hauteur de la liste (`h-6`), le tout
   * d'au moins `min-h-6` ; l'écart (`gap-0.5`) ; la règle (`text-xs`), en autant de lignes qu'il lui en faut.
   */
  function headerHeight(id: (typeof COLUMN_IDS)[number], count: number, days: number, language: Language): number {
    const meta = columnMeta(language)[id];
    const withSelect = id === 'done';
    const { lines } = headerLines(meta.label, countWidth(count, language), withSelect ? select(language) : undefined);
    const rowLine = px(sheet.find((rule) => rule.selector === BODY_TEXT && 'line-height' in rule.declarations)?.declarations['line-height'] as string);
    const selectHeight = px(atViewport(sheet, DONE_SELECT, 'height', 1440) as string);
    const lastLine = withSelect ? Math.max(rowLine, selectHeight) : rowLine;
    const row = Math.max(px(atViewport(sheet, HEADER_ROW, 'min-height', 1440) as string), (lines - 1) * rowLine + lastLine);
    const xsLine = lengthOf(sheet, resolved(sheet, atViewport(sheet, TEXT.xs, 'line-height', 1440) as string), ROOT, () => XS);
    const [top, bottom, gap] = (['padding-top', 'padding-bottom', 'gap'] as const).map((property) => px(atViewport(sheet, HEADER, property, 1440) as string));
    return (top as number) + row + (gap as number) + xsLines(meta.hint(days), header) * xsLine + (bottom as number);
  }

  it('garde au clavier une carte entière sous les en-têtes collants : sa marge de défilement couvre la barre du haut, l’en-tête le plus haut et l’anneau de focus', () => {
    // L'en-tête le plus haut au seuil, où les colonnes sont le plus étroites : dans les deux langues, jusqu'à 9 999 cartes, Terminé à chaque durée.
    // Côte à côte, tous les en-têtes ont sa hauteur (les colonnes sont des sous-grilles).
    let tallest = 0;
    for (const language of LANGUAGES) {
      for (const id of COLUMN_IDS) {
        for (const count of [9, 99, 999, 9_999]) {
          for (const days of id === 'done' ? doneDayChoices(7) : [14]) tallest = Math.max(tallest, headerHeight(id, count, days, language));
        }
      }
    }
    // Ce que mesure Chromium à 1 440 px, avec moins de 100 cartes par colonne : 108 px (bdesk-pz0.4, relecture 3) ; au seuil, avec 9 999 cartes, plus.
    expect(tallest).toBeGreaterThanOrEqual(108);
    // L'en-tête colle sous la barre du haut (`top-11`) ; l'anneau de focus (`ring-2`) déborde de la carte.
    const stuckAt = px(valueAt(layout.header, 'top', sizes) as string);
    const ring = Number(matched(/(?:^|:)ring-(\d+)(?:\s|$)/.exec(CARD), 'l’anneau de focus de la carte'));
    const needed = stuckAt + tallest + ring;
    const margin = px(valueAt(`${CARD} ${layout.card.item}`, 'scroll-margin-top', sizes) as string);
    expect(margin, `${margin} px pour ${needed.toFixed(2)} px`).toBeGreaterThanOrEqual(needed);
    // Pas plus qu'il ne faut : une carte remontée au clavier ne s'éloigne pas de son en-tête de plus d'une demi-rem.
    expect(margin - needed).toBeLessThan(ROOT / 2);
  });

  it.each(LANGUAGES)('en %s, chaque pastille d’une carte tient, sans pictogramme : agent, Signaux, Abandon, Renoncement, et chaque mot du statut', (language) => {
    const { kanban, shell } = CATALOGS[language];
    // Sans pictogramme (masqué), marges (`px-1.5`) et bordure (pointillée pour Abandon et Renoncement).
    const pad = 2 * unit(1.5) + 2 * BORDER;
    const badge = (value: string) => text(value, MICRO, MEDIUM) + pad;
    const failures: string[] = [];
    // Les Signaux sont nommés en français sur les cartes (`SIGNAL_KINDS`) : les deux langues sont mesurées.
    const words = [kanban.card.agent, shell.signals.kinds.drift, shell.signals.kinds.longBlockage, shell.badges.abandon, shell.badges.decline];
    const signalsFr = [CATALOGS.fr.shell.signals.kinds.drift, CATALOGS.fr.shell.signals.kinds.longBlockage];
    for (const value of [...words, ...signalsFr]) {
      // Sur une ligne de préférence ; sinon, chaque mot tient, et la pastille, qui peut rétrécir, passe à la ligne entre deux.
      for (const word of value.split(' ')) if (badge(word) > card) failures.push(`« ${word} » (${value}) : ${badge(word).toFixed(1)} px pour ${card.toFixed(1)} px`);
    }
    // La pastille de statut passe à la ligne entre deux mots (un bloc aligné à gauche) : chaque mot y tient, marges (`px-1.5`) et bordure comprises.
    for (const status of ['open', 'in_progress', 'hooked', 'blocked', 'in_review', 'in_integration', 'awaiting_human', 'deferred', 'pinned', 'closed']) {
      for (const word of statusLabel(status, language).split(' ')) {
        const width = text(word, XS) + pad;
        if (width > card) failures.push(`statut ${status}, « ${word} » : ${width.toFixed(1)} px`);
      }
    }
    // Ce qui retient la carte : un cadenas de 12 px, un écart (`gap-1`), puis les mots.
    for (const word of [...kanban.card.waitingOn.split(' '), ...kanban.card.blockedStatus.split(' ')]) {
      const width = 12 + unit(1) + text(word, XS);
      if (width > card) failures.push(`« ${word} » : ${width.toFixed(1)} px`);
    }
    expect(failures).toEqual([]);
  });

  it('garde chaque pastille d’un seul mot sur une ligne, et le Blocage long en entier dans les deux langues', () => {
    const pad = 2 * unit(1.5) + 2 * BORDER;
    for (const language of LANGUAGES) {
      const { kanban, shell } = CATALOGS[language];
      for (const value of [kanban.card.agent, shell.signals.kinds.drift, shell.signals.kinds.longBlockage, shell.badges.abandon, shell.badges.decline]) {
        expect(text(value, MICRO, MEDIUM) + pad, value).toBeLessThanOrEqual(card);
      }
    }
  });

  it.each(LANGUAGES)('en %s, l’âge d’une carte tient sur sa ligne, et l’identifiant garde de la place à côté du code de la priorité', (language) => {
    const now = Date.parse('2026-11-20T12:00:00Z');
    const ago = [0, 59 * 60_000, 23 * 3_600_000, ...[1, 2, 3, 13, 20, 27, 40, 400].map((days) => days * 86_400_000)];
    const failures: string[] = [];
    for (const offset of ago) {
      const age = formatAge(new Date(now - offset).toISOString(), now, language);
      // Horloge de 11 px et écart (`gap-1`) ; l'âge ne passe jamais à la ligne (`whitespace-nowrap`).
      const width = 11 + unit(1) + text(age, XS);
      if (width > card) failures.push(`« ${age} » : ${width.toFixed(1)} px pour ${card.toFixed(1)} px`);
    }
    expect(failures).toEqual([]);
    // Ligne de l'identifiant : pictogramme de type (14 px), écarts (`gap-1.5`), code de la priorité (le plus large de P0 à P4), sans ses barres
    // (`layout.card.priorityGlyph`). L'identifiant passe à la ligne après son tiret : le préfixe du Projet, puis le reste, tiennent chacun sur une ligne.
    const code = Math.max(...[0, 1, 2, 3, 4].map((priority) => text(`P${priority}`, XS)));
    const idWidth = card - 14 - 2 * unit(1.5) - code;
    for (const part of ['bdesk-', '38k.109']) expect(mono(part, { size: XS }), part).toBeLessThanOrEqual(idWidth);
    // Avec les barres (14 px, écart `gap-1.5`), il n'aurait que 43,2 px au seuil de huit colonnes : moins que « bdesk- », coupé en trois lignes.
    expect(idWidth - 14 - unit(1.5)).toBeLessThan(mono('bdesk-', { size: XS }));
  });
});

/**
 * Une colonne de 9,5 rem de contenu tout juste, où la carte cesse de s'alléger : la carte d'avant y tient, telle quelle. Marges de la liste (`px-1.5`)
 * et de la carte (`px-2.5`), pictogrammes des pastilles (11 px, écart `gap-1`), priorité en barres et en code, aux tailles réelles.
 */
describe('à 9,5 rem de contenu de colonne, la carte d’avant tient : c’est là que l’allègement s’arrête', () => {
  const sans = textMeasurer(SANS_FILE);
  const mono = textMeasurer(MONO_FILE);
  const XS = 0.75 * ROOT;
  const text = (value: string, size: number, weightOf = 400) => sans(value, { size, weight: weightOf }) + KERNING_ALLOWANCE;
  const card = NARROW_COLUMN - 2 * unit(1.5) - 2 * BORDER - 2 * unit(2.5);

  it('garde l’identifiant (« bdesk- », puis « 38k.109 ») à côté des barres et du code de la priorité', () => {
    const code = Math.max(...[0, 1, 2, 3, 4].map((priority) => text(`P${priority}`, XS)));
    const idWidth = card - 14 - 2 * unit(1.5) - (14 + unit(1.5) + code);
    for (const part of ['bdesk-', '38k.109']) expect(mono(part, { size: XS }), part).toBeLessThanOrEqual(idWidth);
  });

  it.each(['fr', 'en'] as const)('en %s, garde chaque pastille sur une ligne, avec son pictogramme', (language) => {
    const { kanban, shell } = CATALOGS[language];
    const badge = (value: string) => 11 + unit(1) + text(value, XS, 500) + 2 * unit(1.5) + 2 * BORDER;
    for (const value of [kanban.card.agent, shell.signals.kinds.drift, shell.signals.kinds.longBlockage, shell.badges.abandon, shell.badges.decline]) {
      expect(badge(value), value).toBeLessThanOrEqual(card);
    }
  });
});
