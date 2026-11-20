import { describe, expect, it } from 'vitest';
import { statusLabel } from '../design/issue-palette';
import { CATALOGS } from '../i18n/catalog';
import type { Language } from '../i18n/language';
import { formatAge } from '../lib/relativeTime';
import { FLEX_SHRINK, rulesFor, selectorOf, type Rule } from '../test/compiledCss';
import { MONO_FILE, SANS_FILE, textMeasurer } from '../test/fontMetrics';
import { COLUMN_IDS } from './columns';
import { boardLayout, NARROW_REM_PER_COLUMN, WIDE_REM_PER_COLUMN, type BoardLayout } from './layout';
import { columnMeta, daysLabel } from './meta';
import { doneDayChoices } from './params';

/**
 * La disposition du tableau selon son nombre de colonnes (bdesk-pz0.4) : cinq, comme avant, 12 rem par colonne ; six à huit avec les Statuts de
 * relais, 9 rem par colonne, pour que les huit tiennent côte à côte à 1 440 px. Ce test lit les règles que Tailwind écrit pour les classes de
 * `layout.ts` dans la feuille de style de l'application (`compiledCss.ts`), et les requêtes de conteneur qui les enveloppent ; il n'en lit que des
 * `@container (width >= …rem)` et échoue sur toute autre condition. jsdom ne met rien en page : la largeur des textes se mesure dans les fichiers de
 * police de l'application (`fontMetrics.ts`), et la mise en page d'un en-tête ou d'une carte se refait ici, à la main, d'après leurs classes
 * (`Column.tsx`, `Card.tsx`). Ce qu'il ne voit pas : le crénage, l'arrondi au pixel, la position de défilement du sélecteur (`ColumnSelector` la
 * ramène sur le bouton de la colonne affichée) ; un navigateur le dirait.
 */

const REM = 16;
/** L'écart entre deux colonnes côte à côte : le `gap-2` de la grille de `Board`. */
const GAP_PX = 8;

/** La largeur du panneau du tableau à une largeur de fenêtre de bureau : la barre latérale (`w-60`, Sidebar.tsx) et les marges de la page large (`md:px-5`, Page.tsx) en moins. */
const panelAt = (viewport: number) => viewport - 240 - 2 * 20;
/** La largeur d'une colonne côte à côte : le panneau, moins les écarts, partagé. */
const columnWidth = (panel: number, count: number) => (panel - (count - 1) * GAP_PX) / count;

const COUNTS = [5, 6, 7, 8] as const;
/** Le seuil où `count` colonnes passent côte à côte, en px. */
const thresholdPx = (count: number) => count * (count === 5 ? WIDE_REM_PER_COLUMN : NARROW_REM_PER_COLUMN) * REM;

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
  return [...new Set(rules.filter((rule) => selectors.has(rule.selector)).flatMap((rule) => rule.within.map(threshold)))].sort((a, b) => a - b);
}

async function compiled(layout: BoardLayout): Promise<Rule[]> {
  const all = [
    layout.grid,
    layout.column,
    layout.header,
    layout.headerRow,
    layout.title,
    layout.cards,
    layout.card,
    layout.selector,
    layout.selectorGroup,
    layout.selectorButton,
    layout.selectorLabel,
  ];
  return rulesFor(all.flatMap(classes));
}

describe('boardLayout : cinq colonnes, comme avant', () => {
  it('garde les classes et le seuil d’avant les Statuts de relais', () => {
    expect(boardLayout(5)).toEqual({
      grid: '@min-[60rem]:grid @min-[60rem]:grid-cols-5',
      column: '@min-[60rem]:flex',
      header: '@min-[60rem]:sticky @min-[60rem]:top-11',
      headerRow: '',
      title: '',
      cards: '@min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-1',
      card: '',
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

describe('les seuils : 12 rem par colonne à cinq, 9 rem de six à huit', () => {
  it('donne 60 rem à cinq colonnes, puis 54, 63 et 72 rem', () => {
    expect(COUNTS.map((count) => thresholdPx(count) / REM)).toEqual([60, 54, 63, 72]);
  });

  it('fait tenir les huit colonnes côte à côte à 1 440 px : un panneau de 1 160 px, pour 1 152 px', () => {
    expect(panelAt(1440)).toBe(1160);
    expect(thresholdPx(8)).toBe(1152);
    for (const count of COUNTS) expect(panelAt(1440) >= thresholdPx(count), `${count} colonnes`).toBe(true);
  });

  it('montre encore une colonne à la fois à 1 100 px (un panneau de 820 px), avec ou sans colonnes de relais, comme avant', () => {
    expect(panelAt(1100)).toBe(820);
    for (const count of COUNTS) expect(panelAt(1100) >= thresholdPx(count), `${count} colonnes`).toBe(false);
  });

  it('donne au seuil 185,6 px à une colonne parmi cinq, et au moins 137 px parmi six à huit (136 + 8 / N)', () => {
    expect(columnWidth(thresholdPx(5), 5)).toBeCloseTo(185.6);
    for (const count of [6, 7, 8]) {
      expect(columnWidth(thresholdPx(count), count)).toBeCloseTo(136 + 8 / count);
      expect(columnWidth(thresholdPx(count), count)).toBeGreaterThanOrEqual(137);
    }
  });
});

describe.each(COUNTS)('boardLayout : %i colonnes', (count) => {
  const layout = boardLayout(count);
  const wide = thresholdPx(count);

  it('passe toutes les colonnes côte à côte à un seul seuil : la grille, les colonnes, leurs en-têtes, les cartes et le sélecteur', async () => {
    const rules = await compiled(layout);

    for (const part of [layout.grid, layout.column, layout.header, layout.headerRow, layout.title, layout.card, layout.selector]) {
      expect(thresholdsOf(rules, part), part).toEqual(part === '' ? [] : [wide]);
    }
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

  it('range les cartes d’une colonne seule sur plusieurs lignes quand elle a la place, et une par ligne côte à côte, à toute largeur', async () => {
    const rules = await compiled(layout);
    const cardColumns = (width: number) => valueAt(rules, layout.cards, 'grid-template-columns', width);

    expect(cardColumns(375)).toBeUndefined();
    expect(cardColumns(36 * REM)).toBe('repeat(2, minmax(0, 1fr))');
    // Trois cartes par ligne dès 60 rem, tant que les colonnes ne sont pas côte à côte : à sept et huit, pas à six (côte à côte dès 54 rem).
    if (count === 7 || count === 8) expect(cardColumns(60 * REM)).toBe('repeat(3, minmax(0, 1fr))');
    for (const width of [wide, wide + 200, 2560]) expect(cardColumns(width), `${width} px`).toBe('repeat(1, minmax(0, 1fr))');
  });

  if (count > 5) {
    it('resserre côte à côte l’en-tête et les cartes : marges de 8 px, écarts de 6 px, l’en-tête passe à la ligne et le libellé prend la place', async () => {
      const rules = await compiled(layout);

      expect(valueAt(rules, layout.header, 'padding-inline', wide)).toBe('calc(var(--spacing) * 2)');
      expect(valueAt(rules, layout.headerRow, 'flex-wrap', wide)).toBe('wrap');
      expect(valueAt(rules, layout.headerRow, 'column-gap', wide)).toBe('calc(var(--spacing) * 1.5)');
      expect(valueAt(rules, layout.title, 'flex-basis', wide)).toBe('0px');
      expect(valueAt(rules, layout.title, 'flex-grow', wide)).toBe('1');
      expect(valueAt(rules, layout.cards, 'padding-inline', wide)).toBe('var(--spacing)');
      expect(valueAt(rules, layout.card, 'padding-inline', wide)).toBe('calc(var(--spacing) * 2)');
      // En deçà, une colonne seule garde l'en-tête et les cartes d'avant.
      for (const part of [layout.header, layout.cards, layout.card]) expect(valueAt(rules, part, 'padding-inline', wide - 1), part).toBeUndefined();
      expect(valueAt(rules, layout.headerRow, 'flex-wrap', wide - 1)).toBeUndefined();
    });
  }
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

/**
 * Une colonne étroite, au seuil de huit colonnes (la plus étroite : 137 px), lue avec les polices de l'application. Les tailles sont celles des
 * classes : libellé `text-ui` (14 px) `font-semibold` (600), compte `text-xs` (12 px) en chiffres tabulaires, pastilles `text-micro` (12 px)
 * `font-medium` (500), âge et pastille de statut `text-xs`, identifiant `font-mono text-xs`.
 */
describe('une colonne étroite reste lisible : chaque texte tient, en français et en anglais', () => {
  const sans = textMeasurer(SANS_FILE);
  const mono = textMeasurer(MONO_FILE);
  const column = columnWidth(thresholdPx(8), 8);
  /** L'en-tête : bordure de la colonne (1 px de chaque côté) et marges resserrées (`px-2`). */
  const header = column - 2 - 2 * 8;
  /** Une carte : bordure de la colonne, marges de la liste (`px-1`), bordure de la carte et ses marges (`px-2`). */
  const card = column - 2 - 2 * 4 - 2 - 2 * 8;
  const ICON = 14;
  const ROW_GAP = 6;
  /** Un compte de trois chiffres : chiffres tabulaires, chacun de la largeur du plus large. */
  const digit = Math.max(...[...'0123456789'].map((d) => sans(d, { size: 12 })));
  const LANGUAGES: Language[] = ['fr', 'en'];

  it('lit bien la police : un mot gras est plus large que maigre, « i » plus étroit que « M »', () => {
    expect(sans('intégration', { size: 14, weight: 600 })).toBeGreaterThan(sans('intégration', { size: 14 }));
    expect(sans('i', { size: 14 })).toBeLessThan(sans('M', { size: 14 }) / 2);
    expect(mono('i', { size: 12 })).toBeCloseTo(mono('M', { size: 12 }));
    expect([column, header, card].map(Math.round)).toEqual([137, 119, 109]);
  });

  /**
   * L'en-tête comme le navigateur le range (`Column.tsx`, `layout.headerRow`, `layout.title`) : le pictogramme, le libellé (base nulle : il ne pèse
   * que son plus long mot), le compte. Si le compte ne tient pas sur la ligne, il passe dessous ; le libellé prend alors toute la place qui reste à
   * côté du pictogramme, et ses mots vont à la ligne un à un.
   */
  function headerLines(label: string, countWidth: number) {
    const space = sans(' ', { size: 14, weight: 600 });
    const words = label.split(' ').map((word) => sans(word, { size: 14, weight: 600 }));
    const longest = Math.max(...words);
    const countBeside = ICON + ROW_GAP + longest + ROW_GAP + countWidth <= header;
    const titleWidth = header - ICON - ROW_GAP - (countBeside ? ROW_GAP + countWidth : 0);
    let lines = 1;
    let line = 0;
    for (const word of words) {
      if (line > 0 && line + space + word > titleWidth) {
        lines++;
        line = word;
      } else line = line === 0 ? word : line + space + word;
    }
    return { lines: lines + (countBeside ? 0 : 1), longest, titleWidth };
  }

  it.each(LANGUAGES)('en %s, chaque en-tête tient sur une ou deux lignes, sans couper un mot, jusqu’à 999 cartes', (language) => {
    const failures: string[] = [];
    for (const id of COLUMN_IDS) {
      const { label } = columnMeta(language)[id];
      for (const digits of [1, 2, 3]) {
        const { lines, longest, titleWidth } = headerLines(label, digits * digit);
        if (longest > titleWidth || lines > 2) failures.push(`${label}, ${digits} chiffres : ${lines} lignes, mot de ${longest.toFixed(1)} px pour ${titleWidth.toFixed(1)} px`);
      }
    }
    expect(failures).toEqual([]);
  });

  it.each(LANGUAGES)('en %s, aucun mot d’un en-tête ne déborde, même à 9 999 cartes, ni de sa règle en une ligne', (language) => {
    const failures: string[] = [];
    for (const id of COLUMN_IDS) {
      const meta = columnMeta(language)[id];
      const { longest, titleWidth } = headerLines(meta.label, 4 * digit);
      if (longest > titleWidth) failures.push(`${meta.label} : ${longest.toFixed(1)} px pour ${titleWidth.toFixed(1)} px`);
      for (const word of meta.hint(7).split(' ')) if (sans(word, { size: 12 }) > header) failures.push(`règle de ${meta.label} : « ${word} »`);
    }
    // Terminé : son choix de fenêtre passe sous le libellé quand il ne tient pas à côté ; seul sur sa ligne, il tient (marges, bordure, flèche de 20 px).
    for (const days of doneDayChoices(7)) {
      const width = sans(daysLabel(days, language), { size: 12 }) + 6 + 2 + 2 + 20;
      if (width > header) failures.push(`fenêtre de Terminé « ${daysLabel(days, language)} » : ${width.toFixed(1)} px`);
    }
    expect(failures).toEqual([]);
  });

  it.each(LANGUAGES)('en %s, chaque pastille d’une carte tient sur sa largeur : agent, Signaux, Abandon, Renoncement, statut', (language) => {
    const { kanban, shell } = CATALOGS[language];
    // Pictogramme de 11 px, écart de 4 px (`gap-1`), marges (`px-1.5`) et bordure (pointillée pour Abandon et Renoncement).
    const badge = (text: string) => sans(text, { size: 12, weight: 500 }) + 11 + 4 + 2 * 6 + 2;
    const failures: string[] = [];
    // Les Signaux sont nommés en français sur les cartes (`SIGNAL_KINDS`) : les deux langues sont mesurées.
    const words = [kanban.card.agent, shell.signals.kinds.drift, shell.signals.kinds.longBlockage, shell.badges.abandon, shell.badges.decline];
    const signalsFr = [CATALOGS.fr.shell.signals.kinds.drift, CATALOGS.fr.shell.signals.kinds.longBlockage];
    for (const text of [...words, ...signalsFr]) if (badge(text) > card) failures.push(`« ${text} » : ${badge(text).toFixed(1)} px pour ${card.toFixed(1)} px`);
    // La pastille de statut passe à la ligne entre deux mots (un bloc aligné à gauche) : chaque mot y tient, marges (`px-1.5`) et bordure comprises.
    for (const status of ['open', 'in_progress', 'hooked', 'blocked', 'in_review', 'in_integration', 'awaiting_human', 'deferred', 'pinned', 'closed']) {
      for (const word of statusLabel(status, language).split(' ')) {
        const width = sans(word, { size: 12 }) + 2 * 6 + 2;
        if (width > card) failures.push(`statut ${status}, « ${word} » : ${width.toFixed(1)} px`);
      }
    }
    expect(failures).toEqual([]);
  });

  it.each(LANGUAGES)('en %s, l’âge d’une carte tient sur sa ligne, et l’identifiant garde de la place à côté de la priorité', (language) => {
    const now = Date.parse('2026-11-20T12:00:00Z');
    const ago = [0, 59 * 60_000, 23 * 3_600_000, ...[1, 2, 3, 13, 20, 27, 40, 400].map((days) => days * 86_400_000)];
    const failures: string[] = [];
    for (const offset of ago) {
      const age = formatAge(new Date(now - offset).toISOString(), now, language);
      // Horloge de 11 px et écart de 4 px ; l'âge ne passe jamais à la ligne (`whitespace-nowrap`).
      const width = 11 + 4 + sans(age, { size: 12 });
      if (width > card) failures.push(`« ${age} » : ${width.toFixed(1)} px`);
    }
    // Ligne de l'identifiant : pictogramme de type (14 px), écarts de 6 px, priorité (barres de 14 px, écart de 6 px, « P4 ») ; l'identifiant se coupe
    // n'importe où (`wrap-anywhere`) et garde au moins six caractères par ligne.
    const priority = 14 + 6 + sans('P4', { size: 12 });
    const idWidth = card - 14 - 6 - 6 - priority;
    expect(idWidth).toBeGreaterThanOrEqual(mono('bdesk-', { size: 12 }));
    expect(failures).toEqual([]);
  });
});
