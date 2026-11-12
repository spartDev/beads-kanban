import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { screen, within } from '@testing-library/react';
import { compile } from 'tailwindcss';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { bdeskIssues } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

/**
 * La zone libre que la barre du haut laisse à côté de son bouton de Projet, sur mobile (bdesk-38k.84). La barre est collante : les cibles de la page qui défilent dessous, les résumés « Données du graphique » par exemple
 * (bdesk-38k.82), n'y sont recouvertes que par ses boutons, et `target-size` d'axe (WCAG 2.5.8, « Taille de la cible (minimum) ») veut qu'il en reste une zone libre de 24 px sur 24 : à côté du bouton du Projet, entre lui et
 * la recherche. Or le bouton du Projet prend toute la place que la recherche lui laisse (il rétrécit et tronque son nom) : plus le nom est long, plus il s'étend vers elle, jusqu'à 8 px, l'écart de la barre. À 375 px, un nom de
 * 21 caractères (`my-prompt-manager-app`) n'en laisse déjà que 23 : les sept résumés sont en violation (« partiallyObscured »), 14 positions de défilement chacun. La marge à droite du bouton réserve la zone, en la prenant sur
 * le nom ; mais le bouton ne rétrécit pas sous son rembourrage : plus étroite que 11 rem, la barre n'a plus de place pour la marge, qui y pousserait la recherche et le thème hors de la fenêtre.
 *
 * jsdom ne mesure rien. Ce test lit donc ce que les classes de la barre déclarent dans la feuille de style de l'application, compilée par Tailwind (la vraie, `styles.css`), à la largeur de fenêtre et à la taille de police racine
 * voulues : les conditions `@media` qui les enveloppent sont appliquées à la main, comme le fait le navigateur (technique de dataSummary.test.tsx pour le résumé). La zone libre du pire cas, un bouton qui remplit sa ligne, est l'écart
 * de la barre plus la marge à droite du bouton. Ce que Chromium en fait (où finit le bouton, ce qu'axe dit à chaque position du défilement, la barre de bureau qui ne bouge pas à 1280 px) se mesure en vrai navigateur : voir la
 * preuve de bdesk-38k.84.
 *
 * Ce que ce test ne voit pas, et qu'il ne prétend donc pas garantir : il ne lit que les règles dont le sélecteur est une classe de l'élément, seule, et les conditions `@media` de largeur. Toute autre règle qui déclare une des
 * propriétés qu'il lit (un bloc `@supports` ou de conteneur, un sélecteur qui nomme une classe de l'élément sans être elle seule) et toute variable déclarée plusieurs fois ou sous condition le font échouer, au lieu de passer
 * en silence ; mais les règles de `styles.css` écrites par nom d'élément (`header > button`), la position ou la largeur du bouton, et le voisin de droite lui échappent.
 */

withAsyncTimeout(5_000);
afterEach(() => vi.unstubAllGlobals());

const web = join(import.meta.dirname, '..');
const modules = join(import.meta.dirname, '../../../node_modules');

/** La taille minimale d'une cible, en px (WCAG 2.5.8), et la tolérance d'axe sur elle. */
const TARGET = 24;
const TOLERANCE = 0.05;

/** Les polices racine que le test passe en revue, en px : de la plus petite (12) à « très grande » (24). Les 24 px de WCAG, eux, ne grandissent pas avec le texte ; l'écart de la barre (en `rem`), si. */
const ROOTS = [12, 14, 16, 20, 24];

/**
 * La largeur de fenêtre, en px, à partir de laquelle la barre a la place de la marge : 11 rem. Le bouton du Projet ne descend pas sous son rembourrage (12 px) : avec la marge (16 px), la recherche et le thème tiennent, rembourrage
 * de la barre compris, à partir de 173 px (mesuré en navigateur) ; 11 rem, un compte rond, laisse 3 px de plus. Plus étroite, la marge les pousserait hors de la fenêtre. Les requêtes de média comptent le `rem` à la taille de police par défaut du
 * navigateur (16 px, sauf réglage) : le seuil suit ce réglage, avec la barre, mais pas un `html { font-size }` posé par une feuille de style (feuille utilisateur, extension), qui grossit la barre sans le déplacer.
 */
const ROOM = 176;

/** Le Projet dont le ticket parle : 21 caractères, ce qui suffit, à 375 px, pour que la zone libre à côté de son bouton tombe sous 24 px (23,08 px, mesurés). */
const NAME = 'my-prompt-manager-app';
const project: Project = { id: 'bdesk', name: NAME, path: `/dev/${NAME}`, prefix: 'bdesk', mode: 'embedded', status: 'ok' };

/**
 * La propriété du rétrécissement d'un élément flex, écrite en morceaux : Tailwind lit aussi les fichiers de tests, et la propriété écrite d'un bloc, même dans un commentaire, y ferait naître la classe de même nom dans la
 * feuille de style de l'application.
 */
const FLEX_SHRINK = ['flex', 'sh' + 'rink'].join('-');

/** La feuille de style de l'application, compilée pour ces classes seulement, variantes comprises (`md:hidden`) : celles du bouton, de son nom et de tous les éléments qui les portent, jusqu'à `html`. */
async function stylesheetFor(classes: readonly string[]): Promise<string> {
  const compiler = await compile(readFileSync(join(web, 'styles.css'), 'utf8'), {
    base: web,
    loadStylesheet: async (id, base) => {
      const path = id === 'tailwindcss' ? join(modules, 'tailwindcss/index.css') : join(base, id);
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
    },
  });
  return compiler.build([...classes]);
}

interface Rule {
  selector: string;
  /** Les blocs conditionnels (`@media`, `@supports`, de conteneur…) qui l'enveloppent, du plus extérieur au plus intérieur. */
  within: string[];
  declarations: Record<string, string>;
}

/** Les règles d'une feuille de style, dans son ordre (celui de la cascade), chacune avec les conditions qui l'enveloppent : tout bloc `@…` en est une, sauf `@layer`, qui ne conditionne rien. */
function rulesOf(source: string, within: string[] = []): Rule[] {
  const rules: Rule[] = [];
  let from = 0;
  for (;;) {
    const open = source.indexOf('{', from);
    if (open < 0) return rules;
    let depth = 0;
    let close = open;
    for (; close < source.length; close++) {
      if (source[close] === '{') depth++;
      else if (source[close] === '}' && --depth === 0) break;
    }
    // Ce qui précède l'accolade, sans les instructions qui le précèdent (`@layer theme, base;`) ni les commentaires.
    const head = (source.slice(from, open).replace(/\/\*[\s\S]*?\*\//g, '').split(/[;}]/).pop() ?? '').trim();
    const body = source.slice(open + 1, close);
    if (head.startsWith('@')) rules.push(...rulesOf(body, head.startsWith('@layer') ? within : [...within, head]));
    else {
      const declarations = Object.fromEntries([...body.matchAll(/([\w-]+):\s*([^;]+?)\s*(?:;|$)/g)].map(([, property, value]) => [property as string, value as string]));
      rules.push({ selector: head, within, declarations });
    }
    from = close + 1;
  }
}

/**
 * Une condition `@media (width >= 48rem)` ou `(width < 48rem)`, en `rem` ou en px (l'écriture de Tailwind 4), vraie à cette largeur de fenêtre. Le `rem` d'une requête de média vaut la taille de police par défaut du navigateur, 16 px ici, et non celle
 * d'un `html { font-size }` de feuille de style. Une autre écriture, ou une autre condition, fait échouer le test plutôt que passer en silence.
 */
function holds(condition: string, viewport: number): boolean {
  const match = /^@media\s*\(width\s*(<|>=)\s*([\d.]+)(rem|px)\)$/.exec(condition);
  if (!match) throw new Error(`Condition que ce test ne sait pas lire : ${condition}`);
  const limit = Number(match[2]) * (match[3] === 'rem' ? 16 : 1);
  return match[1] === '<' ? viewport < limit : viewport >= limit;
}

/** Le sélecteur de la classe tel que Tailwind l'écrit : tout ce qui n'est ni lettre, ni chiffre, ni tiret y est échappé (`md:hidden` : `.md\:hidden`). */
const selectorOf = (name: string) => `.${name.replace(/[^\w-]/g, '\\$&')}`;
const classesOf = (element: Element) => element.className.split(/\s+/).filter(Boolean);

/** Une valeur déclarée, sans son `!important`, et si elle l'avait. */
const withoutImportant = (value: string) => ({ value: value.replace(/\s*!important\s*$/, ''), important: /!important\s*$/.test(value) });

/**
 * Ce que ces règles déclarent pour l'une de ces propriétés à cette largeur de fenêtre ; `undefined` : aucune. La dernière déclaration l'emporte (l'ordre de la feuille est celui de la cascade), sauf devant un `!important`, que seul
 * un autre `!important` plus loin remplace. Les conditions d'une règle ne sont lues que si elle déclare l'une de ces propriétés : une qu'il ne sait pas lire fait alors échouer le test. `pick` tire la valeur voulue de la déclaration
 * (la marge à droite, d'un raccourci).
 */
function declared(rules: readonly Rule[], properties: readonly string[], viewport: number, pick = (_property: string, value: string) => value): string | undefined {
  let value: string | undefined;
  let important = false;
  for (const rule of rules) {
    const touched = properties.filter((property) => rule.declarations[property] !== undefined);
    if (touched.length === 0 || !rule.within.every((condition) => holds(condition, viewport))) continue;
    for (const property of touched) {
      const declaration = withoutImportant(rule.declarations[property] as string);
      if (important && !declaration.important) continue;
      value = pick(property, declaration.value);
      important = declaration.important;
    }
  }
  return value;
}

/** Les valeurs d'une déclaration, séparées par des espaces hors des parenthèses (`calc(1px + 2px) 0` : deux valeurs). */
function wordsOf(value: string): string[] {
  const words: string[] = [];
  let depth = 0;
  let word = '';
  for (const char of value) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (/\s/.test(char) && depth === 0) {
      if (word) words.push(word);
      word = '';
    } else word += char;
  }
  return word ? [...words, word] : words;
}

/** Les déclarations qui posent la marge à droite : `margin-right`, `margin-inline-end` et les raccourcis `margin` et `margin-inline`, dont elle est la deuxième valeur, ou la seule. */
const MARGIN_RIGHT = ['margin', 'margin-inline', 'margin-right', 'margin-inline-end'];
const rightOf = (property: string, value: string) => (property === 'margin' || property === 'margin-inline' ? (wordsOf(value)[1] ?? wordsOf(value)[0] ?? value) : value);

/**
 * La valeur d'une variable CSS, lue dans les règles de la feuille de style compilée (`--spacing`, ou une propriété personnalisée que l'une des classes pose) ; à défaut, sa valeur de repli. Sans l'une ni l'autre, le test échoue : il
 * ne devine pas. Une variable déclarée plusieurs fois (`--spacing` surchargée sur la barre, sur le bouton ou sur un ancêtre) ou sous condition prend, selon l'élément et la largeur, des valeurs que ce test ne sait pas suivre : il échoue.
 */
function variableOf(sheet: readonly Rule[], name: string, fallback?: string): string {
  const declarations = sheet.filter((rule) => rule.declarations[name] !== undefined);
  if (declarations.length > 1 || declarations.some((rule) => rule.within.length > 0)) throw new Error(`Variable CSS que ce test ne sait pas résoudre : ${name} est déclarée plusieurs fois ou sous condition`);
  const value = declarations[0]?.declarations[name]?.trim() ?? fallback?.trim();
  if (value === undefined) throw new Error(`Variable CSS sans valeur : var(${name})`);
  return value;
}

/** Une valeur dont les `var(--…)` sont remplacés par ce qu'ils valent, de proche en proche. Un `var()` qu'elle ne sait pas résoudre fait échouer le test. */
function resolved(sheet: readonly Rule[], value: string, depth = 0): string {
  if (depth > 8) throw new Error(`Variables CSS qui se renvoient l'une à l'autre : ${value}`);
  const text = value.replace(/var\(\s*(--[\w-]+)\s*(?:,([^()]*))?\)/gi, (_, name: string, fallback?: string) => resolved(sheet, variableOf(sheet, name, fallback), depth + 1));
  if (/var\(/i.test(text)) throw new Error(`Variable CSS que ce test ne sait pas résoudre : ${value}`);
  return text;
}

/** Un nombre, ou une longueur (en px, la police racine connue) : `calc()` ne mélange pas les deux. */
interface Quantity {
  value: number;
  length: boolean;
}

/**
 * Une quantité CSS : `1rem`, `24px`, `calc(var(--spacing) * 4)`, `calc(24px - .5rem)`, `max(0px, …)`, la police racine valant `root` px. Les variables sont lues dans la feuille de style (`--spacing` y vaut 0,25 rem).
 * Elle ne connaît que les unités `px` et `rem` : toute autre écriture (`em`, `vw`, `Q`, `%`, une fonction inconnue) fait échouer le test, car un morceau ignoré en silence fausserait la somme. Elle vérifie aussi les types, comme le
 * navigateur, qui laisse tomber la déclaration : une longueur et un nombre sans unité ne s'additionnent pas, deux longueurs ne se multiplient pas.
 */
function quantityOf(sheet: readonly Rule[], value: string, root: number): Quantity {
  const unreadable = (detail = '') => new Error(`Longueur que ce test ne sait pas lire${detail ? ` (${detail})` : ''} : ${value}`);
  // Les jetons : toute la valeur y passe, et ce qui ne ressemble à aucun d'eux (l'unité d'`1em`, d'`1vw`, de `16Q`, le `%`) est refusé.
  const tokens: string[] = [];
  const pattern = /\s*(var\(--[\w-]+(?:\s*,[^()]*)?\)|[a-z]+\(|\d*\.?\d+(?:px|rem)?|[()+\-*/,])/iy;
  let end = 0;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    tokens.push(match[1] as string);
    end = pattern.lastIndex;
  }
  const rest = value.slice(end).trim();
  if (rest) throw unreadable(`unité inconnue : « ${rest.split(/[\s)]/)[0]} », seuls px et rem sont connus`);

  let at = 0;
  const eat = (token: string) => {
    if (tokens[at++] !== token) throw unreadable();
  };
  const sameKind = (a: Quantity, b: Quantity) => {
    if (a.length !== b.length) throw unreadable('une longueur et un nombre sans unité ne s’additionnent pas');
  };
  const factor = (): Quantity => {
    const token = tokens[at++];
    if (token === undefined) throw unreadable();
    if (token === '-') {
      const inner = factor();
      return { ...inner, value: -inner.value };
    }
    if (token === '(') {
      const inner = sum();
      eat(')');
      return inner;
    }
    const variable = /^var\((--[\w-]+)(?:\s*,\s*(.+))?\)$/i.exec(token);
    if (variable) return quantityOf(sheet, resolved(sheet, variableOf(sheet, variable[1] as string, variable[2])), root);
    const call = /^(calc|max|min)\($/i.exec(token);
    if (call) {
      const args = [sum()];
      while (tokens[at] === ',') {
        at++;
        args.push(sum());
      }
      eat(')');
      const first = args[0] as Quantity;
      const name = (call[1] as string).toLowerCase();
      if (name === 'calc') {
        if (args.length !== 1) throw unreadable();
        return first;
      }
      args.forEach((arg) => sameKind(first, arg));
      const values = args.map((arg) => arg.value);
      return { value: name === 'max' ? Math.max(...values) : Math.min(...values), length: first.length };
    }
    const amount = /^(\d*\.?\d+)(px|rem)?$/.exec(token);
    if (amount) return amount[2] ? { value: Number(amount[1]) * (amount[2] === 'rem' ? root : 1), length: true } : { value: Number(amount[1]), length: false };
    throw unreadable();
  };
  const product = (): Quantity => {
    let result = factor();
    while (tokens[at] === '*' || tokens[at] === '/') {
      const times = tokens[at++] === '*';
      const right = factor();
      if (times) {
        if (result.length && right.length) throw unreadable('deux longueurs ne se multiplient pas');
        result = { value: result.value * right.value, length: result.length || right.length };
      } else {
        if (right.length) throw unreadable('on ne divise pas par une longueur');
        result = { value: result.value / right.value, length: result.length };
      }
    }
    return result;
  };
  const sum = (): Quantity => {
    let result = product();
    while (tokens[at] === '+' || tokens[at] === '-') {
      const plus = tokens[at++] === '+';
      const right = product();
      sameKind(result, right);
      result = { value: plus ? result.value + right.value : result.value - right.value, length: result.length };
    }
    return result;
  };
  const result = sum();
  if (at !== tokens.length) throw unreadable();
  return result;
}

/** Une longueur en px : `0`, le seul nombre sans unité que CSS accepte pour une longueur, ou une quantité qui en est une. */
function lengthOf(sheet: readonly Rule[], value: string, root: number): number {
  const quantity = quantityOf(sheet, value, root);
  if (!quantity.length && quantity.value !== 0) throw new Error(`Longueur que ce test ne sait pas lire (un nombre sans unité) : ${value}`);
  return quantity.value;
}

/**
 * Le facteur de rétrécissement d'une boîte flex à cette largeur de fenêtre (1, la valeur initiale, tant que rien ne le change), lu dans `flex` et dans sa propriété seule : le dernier des deux déclarés l'emporte. `flex: none`
 * (`0 0 auto`) et un facteur nul empêchent le bouton de rétrécir ; un nom long le ferait alors déborder, la recherche et le thème avec lui, hors de la fenêtre. Les `var(--…)` sont résolus ; une valeur qu'il ne sait pas lire
 * fait échouer le test plutôt que de passer pour un facteur de 1.
 */
function shrinkOf(sheet: readonly Rule[], rules: readonly Rule[], viewport: number): number {
  const unreadable = (value: string) => new Error(`Valeur de flex que ce test ne sait pas lire : ${value}`);
  const isNumber = (token: string) => /^\d*\.?\d+$/.test(token);
  let rate = 1;
  let important = false;
  for (const rule of rules) {
    const touched = Object.entries(rule.declarations).filter(([property]) => property === 'flex' || property === FLEX_SHRINK);
    if (touched.length === 0 || !rule.within.every((condition) => holds(condition, viewport))) continue;
    for (const [property, raw] of touched) {
      const declaration = withoutImportant(raw);
      if (important && !declaration.important) continue;
      important = declaration.important;
      const value = resolved(sheet, declaration.value).trim();
      if (value === 'initial' || (property === 'flex' && value === 'auto')) rate = 1;
      else if (property === FLEX_SHRINK) {
        if (!isNumber(value)) throw unreadable(value);
        rate = Number(value);
      } else if (value === 'none') rate = 0;
      else {
        if (/^(inherit|unset|revert|revert-layer)$/i.test(value)) throw unreadable(value);
        const numbers = value.split(/\s+/).filter(isNumber);
        rate = numbers.length >= 2 ? Number(numbers[1]) : 1;
      }
    }
  }
  return rate;
}

/** Les propriétés que ce test lit : une règle qui en déclare une doit être lue en entier, ou le test échoue. */
const READ = [...MARGIN_RIGHT, 'column-gap', 'gap', 'min-width', 'display', 'flex', FLEX_SHRINK, 'overflow', 'text-overflow', 'white-space'];
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * La vraie barre du haut, dans la vraie application, avec le Projet de la page : ce que ses classes déclarent (la barre, le bouton du Projet, son nom). La feuille compilée porte aussi les classes de tous leurs ancêtres : une variable
 * qu'ils redéclarent y paraît, et fait échouer `variableOf`. Une règle qui déclare une propriété lue et nomme une classe de l'élément autrement que seule (`header .classe`, `.classe:where(*)`) fait échouer le test.
 */
async function topBar() {
  stubApi({ projects: { projects: [project], ignored: [] }, issues: { bdesk: bdeskIssues } });
  renderApp('/p/bdesk/kanban');
  const switcher = await screen.findByRole('button', { name: `${NAME}, changer de Projet` });
  const header = switcher.closest('header');
  if (!header) throw new Error('Le bouton du Projet n’est pas dans la barre du haut.');
  const label = within(switcher).getByText(NAME);

  const chain: Element[] = [];
  for (let element: Element | null = switcher; element; element = element.parentElement) chain.push(element);
  const all = rulesOf(await stylesheetFor([label, ...chain].flatMap(classesOf)));
  const declaredBy = (element: Element) => {
    const own = classesOf(element).map(selectorOf);
    return all.filter((rule) => {
      if (own.includes(rule.selector)) return true;
      const property = READ.find((read) => rule.declarations[read] !== undefined);
      if (property && own.some((selector) => new RegExp(`(?<!\\\\)${escapeRegExp(selector)}(?![\\w\\\\-])`).test(rule.selector))) {
        throw new Error(`Règle que ce test ne sait pas lire : « ${rule.selector} » déclare ${property} et nomme une classe de l'élément sans en être seule`);
      }
      return false;
    });
  };
  return { all, header: declaredBy(header), switcher: declaredBy(switcher), label: declaredBy(label) };
}

/** La marge à droite du bouton, en px, à cette largeur de fenêtre et à cette taille de police racine : `0` quand aucune règle n'en pose. */
const rightMargin = (bar: Awaited<ReturnType<typeof topBar>>, viewport: number, root: number) => lengthOf(bar.all, declared(bar.switcher, MARGIN_RIGHT, viewport, rightOf) ?? '0px', root);

describe('la barre du haut, sur mobile : la zone libre à côté du bouton du Projet', () => {
  // Le bouton du Projet remplit sa ligne quand le nom est long : ce qui sépare alors son bord droit du bouton de la recherche est l'écart de la barre (`gap`) et la marge à droite du bouton. Plus court, le nom laisse plus.
  it.each([ROOM, 188, 320, 375, 767])('fait 24 px au moins, à %i px de large et à toute taille de texte, même quand le nom du Projet remplit le bouton', async (viewport) => {
    const bar = await topBar();

    for (const root of ROOTS) {
      const gap = lengthOf(bar.all, declared(bar.header, ['column-gap', 'gap'], viewport) ?? '0px', root);
      const margin = rightMargin(bar, viewport, root);

      expect(
        gap + margin + TOLERANCE,
        `police racine de ${root} px : l'écart de la barre (${gap} px) et la marge à droite du bouton du Projet (${margin} px) laissent ${gap + margin} px libres entre lui et la recherche : il en faut ${TARGET}`,
      ).toBeGreaterThanOrEqual(TARGET);
    }
  });

  // Plus étroite que `ROOM`, la barre n'a plus la place de la marge : le bouton ne rétrécit plus sous son rembourrage, la marge pousserait la recherche et le thème hors de la fenêtre (à 160 px, un zoom de 200 % sur 320 px).
  it.each([120, 160, ROOM - 1])("ne pose pas de marge à %i px de large, où la barre n'a plus la place : elle pousserait la recherche et le thème hors de la fenêtre", async (viewport) => {
    const bar = await topBar();

    for (const root of ROOTS) {
      const margin = rightMargin(bar, viewport, root);

      expect(margin, `police racine de ${root} px : la marge à droite du bouton du Projet vaut ${margin} px à ${viewport} px de large : sous ${ROOM} px (11 rem), la barre n'a plus la place de la marge`).toBe(0);
    }
  });

  // La marge ne réserve rien à un bouton qui ne rétrécit pas : un nom long le ferait déborder, la recherche et le thème avec lui, hors de la fenêtre (à 320 px, avec 68 caractères, il s'étend alors jusqu'à 471 px). Il rétrécit
  // (largeur minimale nulle, facteur de rétrécissement non nul) et le nom se tronque.
  it('laisse le bouton rétrécir et son nom se tronquer : la place réservée à droite se prend sur le nom', async () => {
    const bar = await topBar();

    for (const viewport of [120, 160, ROOM, 320, 375, 767]) {
      const minWidth = declared(bar.switcher, ['min-width'], viewport);
      expect(minWidth === undefined || minWidth === 'auto' ? 'auto' : lengthOf(bar.all, minWidth, 16), `largeur minimale du bouton à ${viewport} px : « auto » l'empêche de rétrécir sous son nom`).toBe(0);
      expect(shrinkOf(bar.all, bar.switcher, viewport), `facteur de rétrécissement du bouton à ${viewport} px : nul, il ne rétrécit plus et déborde sur la recherche`).toBeGreaterThan(0);
    }
    expect(Object.fromEntries(['overflow', 'text-overflow', 'white-space'].map((property) => [property, declared(bar.label, [property], 375)]))).toEqual({
      overflow: 'hidden',
      'text-overflow': 'ellipsis',
      'white-space': 'nowrap',
    });
  });

  // Dès 768 px la barre est celle du bureau (le fil d'Ariane) : le bouton n'y est pas, sa marge ne déplace donc rien à 1280 px.
  it('disparaît dès 768 px, où la barre de bureau prend le relais : sa marge ne change rien à la barre de 1280 px', async () => {
    const bar = await topBar();

    expect(declared(bar.switcher, ['display'], 767)).toBe('flex');
    expect(declared(bar.switcher, ['display'], 768)).toBe('none');
  });
});
