import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { statusLabel } from '../design/issue-palette';
import { CATALOGS } from '../i18n/catalog';
import type { Language } from '../i18n/language';
import { formatAge } from '../lib/relativeTime';
import { FLEX_SHRINK, holds, lengthOf, names, resolved, rootFontSizeOf, rulesFor, selectorOf, type Rule } from '../test/compiledCss';
import { KERNING_ALLOWANCE, MONO_FILE, SANS_FILE, textMeasurer } from '../test/fontMetrics';
import { COLUMN_IDS } from './columns';
import { boardLayout, NARROW_REM_PER_COLUMN, WIDE_REM_PER_COLUMN, type BoardLayout } from './layout';
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
const BODY_TEXT = 'body';

const TEXT = { ui: 'text-ui', xs: 'text-xs', micro: 'text-micro', semibold: 'font-semibold', medium: 'font-medium' } as const;
const LAYOUT_PARTS = (layout: BoardLayout) => [
  layout.grid,
  layout.column,
  layout.header,
  layout.headerRow,
  layout.headerIcon,
  layout.title,
  layout.cards,
  layout.card.item,
  layout.card.badges,
  layout.card.priorityCode,
  layout.selector,
  layout.selectorGroup,
  layout.selectorButton,
  layout.selectorLabel,
];
const COUNTS = [5, 6, 7, 8] as const;
const sheet = await sheetFor([SIDEBAR, PAGE, WIDE_PAGE, GRID, ...Object.values(TEXT), ...COUNTS.flatMap((count) => LAYOUT_PARTS(boardLayout(count)))]);
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

/** Le seuil d'une requête de conteneur, en px ; toute autre condition fait échouer le test. */
function threshold(condition: string): number {
  const match = /^@container\s*\(width\s*>=\s*([\d.]+)rem\)$/.exec(condition);
  if (!match) throw new Error(`Condition que ce test ne sait pas lire : ${condition}`);
  return Number(match[1]) * ROOT;
}

/** Ce que les classes `value` déclarent pour `property` dans un panneau de `width` px : la dernière règle qui s'applique, dans l'ordre de la feuille. */
function valueAt(value: string, property: string, width: number, rules: readonly Rule[] = sheet): string | undefined {
  const selectors = new Set(classes(value).map(selectorOf));
  let found: string | undefined;
  for (const rule of rules) {
    if (!selectors.has(rule.selector) || !(property in rule.declarations)) continue;
    if (rule.within.every((condition) => threshold(condition) <= width)) found = rule.declarations[property];
  }
  return found;
}

/** Les seuils de toutes les requêtes de conteneur des classes `value`, sélecteurs composés compris (`[&>span]:…`). */
function thresholdsOf(value: string): number[] {
  const selectors = classes(value).map(selectorOf);
  const own = sheet.filter((rule) => selectors.some((selector) => names(rule, selector)));
  return [...new Set(own.flatMap((rule) => rule.within.map(threshold)))].sort((a, b) => a - b);
}

/** Ce que la classe `name` déclare, à `width` px, pour les descendants que son sélecteur vise (`[&>span>svg]:hidden` : `… > span > svg`). */
function descendantsAt(name: string, property: string, width: number): { selector: string; value: string }[] {
  return sheet
    .filter((rule) => names(rule, selectorOf(name)) && rule.selector !== selectorOf(name) && property in rule.declarations)
    .filter((rule) => rule.within.every((condition) => threshold(condition) <= width))
    .map((rule) => ({ selector: rule.selector.slice(selectorOf(name).length).trim(), value: rule.declarations[property] as string }));
}

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
      header: '@min-[60rem]:sticky @min-[60rem]:top-11',
      headerRow: '',
      headerIcon: '',
      title: '',
      inlineHeader: false,
      cards: '@min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-1',
      card: { item: '', badges: '', priorityCode: '' },
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

  it('passe toutes les colonnes côte à côte à un seul seuil : la grille, les colonnes, leurs en-têtes, les cartes et le sélecteur', () => {
    const parts = [layout.grid, layout.column, layout.header, layout.headerRow, layout.headerIcon, layout.title, layout.card.item, layout.card.badges, layout.card.priorityCode, layout.selector];
    for (const part of parts) expect(thresholdsOf(part), part).toEqual(part === '' ? [] : [wide]);
    // Juste en deçà : une colonne à la fois, avec le sélecteur.
    expect(valueAt(layout.grid, 'display', wide - 1)).toBeUndefined();
    expect(valueAt(layout.selector, 'display', wide - 1)).toBeUndefined();
    // Au seuil : une piste de grille par colonne, toutes affichées, en-têtes collants, sans sélecteur.
    expect(valueAt(layout.grid, 'display', wide)).toBe('grid');
    expect(valueAt(layout.grid, 'grid-template-columns', wide)).toBe(`repeat(${count}, minmax(0, 1fr))`);
    expect(valueAt(layout.column, 'display', wide)).toBe('flex');
    expect(valueAt(layout.header, 'position', wide)).toBe('sticky');
    expect(valueAt(layout.selector, 'display', wide)).toBe('none');
  });

  it('range les cartes d’une colonne seule sur deux par ligne quand elle a la place, et une par ligne côte à côte, à toute largeur', () => {
    const cardColumns = (width: number) => valueAt(layout.cards, 'grid-template-columns', width);

    expect(cardColumns(375)).toBeUndefined();
    expect(cardColumns(36 * ROOT)).toBe('repeat(2, minmax(0, 1fr))');
    for (const width of [wide, wide + 200, 2560]) expect(cardColumns(width), `${width} px`).toBe('repeat(1, minmax(0, 1fr))');
  });

  if (count > 5) {
    it('écrit côte à côte l’en-tête comme une ligne de texte, et allège la carte', () => {
      expect(layout.inlineHeader).toBe(true);
      expect(valueAt(layout.header, 'padding-inline', wide)).toBe('calc(var(--spacing) * 1.5)');
      expect(valueAt(layout.headerRow, 'display', wide)).toBe('block');
      expect(valueAt(layout.headerIcon, 'display', wide)).toBe('inline');
      expect(valueAt(layout.headerIcon, 'margin-right', wide)).toBe('calc(var(--spacing) * 1.5)');
      expect(valueAt(layout.title, 'display', wide)).toBe('inline');
      expect(valueAt(layout.cards, 'padding-inline', wide)).toBe('calc(var(--spacing) * 0.5)');
      expect(valueAt(layout.card.item, 'padding-inline', wide)).toBe('calc(var(--spacing) * 1.5)');
      expect(valueAt(layout.card.priorityCode, 'display', wide)).toBe('none');
      // Les pastilles : leur pictogramme masqué, et chacune peut rétrécir, donc passer elle-même à la ligne entre deux mots.
      const [shrinks, hidesIcon] = classes(layout.card.badges);
      expect(descendantsAt(shrinks as string, FLEX_SHRINK, wide)).toEqual([{ selector: '> span', value: '1' }]);
      expect(descendantsAt(hidesIcon as string, 'display', wide)).toEqual([{ selector: '> span > svg', value: 'none' }]);
      // En deçà, une colonne seule garde l'en-tête et les cartes d'avant.
      for (const part of [layout.header, layout.cards, layout.card.item]) expect(valueAt(part, 'padding-inline', wide - 1), part).toBeUndefined();
      for (const part of [layout.headerRow, layout.headerIcon, layout.title, layout.card.priorityCode]) expect(valueAt(part, 'display', wide - 1), part).toBeUndefined();
      expect(descendantsAt(hidesIcon as string, 'display', wide - 1)).toEqual([]);
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
  const spacing = (property: string, value: string) => px(valueAt(value, property, wide) as string);

  const BORDER = 1;
  const column = columnWidth(wide, count);
  /** L'en-tête : bordure de la colonne et ses marges resserrées (`layout.header`). */
  const header = column - 2 * BORDER - 2 * spacing('padding-inline', layout.header);
  /** Une carte : bordure de la colonne, marges de la liste (`layout.cards`), bordure de la carte et ses marges (`layout.card.item`). */
  const card = column - 2 * BORDER - 2 * spacing('padding-inline', layout.cards) - 2 * BORDER - 2 * spacing('padding-inline', layout.card.item);
  /** Le pictogramme d'une colonne (`size={14}`, Column.tsx), et sa marge à droite dans la ligne de texte. */
  const HEADER_ICON = 14 + spacing('margin-right', layout.headerIcon);
  /** Un compte : chiffres tabulaires, chacun de la largeur du plus large. */
  const digit = Math.max(...[...'0123456789'].map((d) => sans(d, { size: XS })));
  const LANGUAGES: Language[] = ['fr', 'en'];

  it('lit les tailles réelles : 15,75 px pour le libellé, 13,5 px pour le reste, et des colonnes d’au moins 130,7 px', () => {
    expect([UI, XS, MICRO, BODY, SEMIBOLD, MEDIUM]).toEqual([15.75, 13.5, 13.5, 15.75, 600, 500]);
    expect(column).toBeGreaterThanOrEqual(130.7);
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

  it.each(LANGUAGES)('en %s, l’âge d’une carte tient sur sa ligne, et l’identifiant garde de la place à côté de la priorité', (language) => {
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
    // Ligne de l'identifiant : pictogramme de type (14 px), écarts (`gap-1.5`), barres de la priorité (14 px), sans son code (`layout.card.priorityCode`).
    // L'identifiant se coupe n'importe où (`wrap-anywhere`), et garde au moins le préfixe du Projet et un caractère par ligne.
    const idWidth = card - 14 - 2 * unit(1.5) - 14;
    expect(idWidth).toBeGreaterThanOrEqual(mono('bdesk-1', { size: XS }));
  });
});
