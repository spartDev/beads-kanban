import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { compile } from 'tailwindcss';

/**
 * Ce que les classes d'un élément déclarent dans la feuille de style de l'application, lu règle par règle. jsdom ne met rien en page et ne mesure rien : la seule trace de ce que le navigateur fera d'une classe est la règle que Tailwind écrit
 * pour elle dans `styles.css`, la vraie, compilée ici et non recopiée dans un test (comme busyBar.test.ts lit `metrics.css`). Les tests de taille de cible (WCAG 2.5.8) s'en servent : le résumé « Données du graphique » (dataSummary.test.tsx,
 * bdesk-38k.82), le bouton « Masquer Terminé » (cfdButton.test.tsx, bdesk-38k.83) et le bouton du Projet de la barre du haut (TopBar.targetSize.test.tsx, bdesk-38k.84). Chacun dit en tête ce qu'il lit de ces règles et ce qu'il n'en voit pas ;
 * ce que Chromium en fait (la hauteur mesurée, ce qu'axe dit à chaque position du défilement) se mesure dans un vrai navigateur : voir leurs preuves.
 *
 * Ce module ne devine pas, mais il ne refuse que ce qu'on lui fait lire. `lengthOf` échoue sur une unité autre que `px` et `rem`, une fonction autre que `calc`, `min` et `max`, une variable CSS sans valeur ni valeur de repli, ou déclarée
 * plusieurs fois ou sous condition (hors le repli que la couche `properties` de Tailwind donne à ses `--tw-*`) ; `declared` échoue sur une condition autre qu'une largeur de fenêtre (une couche dans une couche en est une). Les règles
 * qu'un test ne lit pas passent sans bruit : chaque test dit, dans son en-tête, lesquelles il refuse et ce qui lui échappe.
 *
 * Tailwind lit aussi les fichiers de `src/web`, ce module comme les tests : un mot qui y est le nom d'une classe en ferait naître la règle dans la feuille de style de production. Ce qu'un test doit nommer sans la faire naître s'écrit en morceaux
 * ou en camelCase (`FLEX_SHRINK` dans TopBar.targetSize.test.tsx, `PLACE` dans cfdButton.test.tsx).
 */

const web = join(import.meta.dirname, '..');
const modules = join(import.meta.dirname, '../../../node_modules');

export interface Rule {
  selector: string;
  /** Les blocs conditionnels (`@media`, `@supports`, de conteneur, couche dans une couche…) qui l'enveloppent, du plus extérieur au plus intérieur. */
  within: string[];
  /** La couche (`@layer`) de premier niveau où elle est écrite : Tailwind range dans `utilities` ce que les classes demandent. */
  layer: string | undefined;
  declarations: Record<string, string>;
}

/**
 * Les règles d'une feuille de style, dans son ordre (celui de la cascade), chacune avec les conditions qui l'enveloppent : tout bloc `@…` en est une, sauf la couche de premier niveau, qui ne conditionne rien et nomme `layer`.
 * Une couche dans une couche (ou sans nom) en est une : ses règles ne s'appliquent que là où celles de la couche qui l'enveloppe ne posent pas la même propriété, ce que `holds` ne sait pas lire.
 */
function rulesOf(source: string, within: string[] = [], layer?: string): Rule[] {
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
    if (head.startsWith('@')) {
      const named = layer === undefined ? /^@layer\s+([\w-]+)$/.exec(head)?.[1] : undefined;
      rules.push(...rulesOf(body, named ? within : [...within, head], named ?? layer));
    } else {
      const declarations = Object.fromEntries([...body.matchAll(/([\w-]+):\s*([^;]+?)\s*(?:;|$)/g)].map(([, property, value]) => [property as string, value as string]));
      rules.push({ selector: head, within, layer, declarations });
    }
    from = close + 1;
  }
}

/** Les règles que Tailwind écrit, dans la feuille de style de l'application, pour ces classes seulement, variantes comprises (`md:hidden`) : dans l'ordre de la feuille. */
export async function rulesFor(classes: readonly string[]): Promise<Rule[]> {
  const compiler = await compile(readFileSync(join(web, 'styles.css'), 'utf8'), {
    base: web,
    loadStylesheet: async (id, base) => {
      const path = id === 'tailwindcss' ? join(modules, 'tailwindcss/index.css') : join(base, id);
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
    },
  });
  return rulesOf(compiler.build([...classes]));
}

/**
 * Une condition `@media (width >= 48rem)` ou `(width < 48rem)`, en `rem` ou en px (l'écriture de Tailwind 4), vraie à cette largeur de fenêtre. Le `rem` d'une requête de média vaut la taille de police par défaut du navigateur, 16 px ici, et non celle
 * d'un `html { font-size }` de feuille de style. Une autre écriture, ou une autre condition, fait échouer le test plutôt que passer en silence.
 */
export function holds(condition: string, viewport: number): boolean {
  const match = /^@media\s*\(width\s*(<|>=)\s*([\d.]+)(rem|px)\)$/.exec(condition);
  if (!match) throw new Error(`Condition que ce test ne sait pas lire : ${condition}`);
  const limit = Number(match[2]) * (match[3] === 'rem' ? 16 : 1);
  return match[1] === '<' ? viewport < limit : viewport >= limit;
}

/** Le sélecteur de la classe tel que Tailwind l'écrit : tout ce qui n'est ni lettre, ni chiffre, ni tiret y est échappé (`md:hidden` : `.md\:hidden`). */
export const selectorOf = (name: string) => `.${name.replace(/[^\w-]/g, '\\$&')}`;
/** Les classes d'un élément, dans l'ordre où il les porte. */
export const classesOf = (element: Element) => (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Le sélecteur de cette règle nomme-t-il cette classe (`selector`, tel que `selectorOf` l'écrit) : seule, ou dans un sélecteur composé (`header .classe`, `.classe:hover`), mais pas comme début d'une autre classe (`.classe-plus-longue`). */
export const names = (rule: Rule, selector: string) => new RegExp(`(?<!\\\\)${escapeRegExp(selector)}(?![\\w\\\\-])`).test(rule.selector);

/** Les valeurs d'une déclaration, séparées par des espaces hors des parenthèses (`calc(1px + 2px) 0` : deux valeurs). */
export function wordsOf(value: string): string[] {
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

/** Une valeur déclarée, sans son `!important`, et si elle l'avait. */
export const withoutImportant = (value: string) => ({ value: value.replace(/\s*!important\s*$/, ''), important: /!important\s*$/.test(value) });

/**
 * Ce que ces règles déclarent pour l'une de ces propriétés à cette largeur de fenêtre ; `undefined` : aucune. La dernière déclaration l'emporte (l'ordre de la feuille est celui de la cascade), sauf devant un `!important`, que seul
 * un autre `!important` plus loin remplace. Les conditions d'une règle ne sont lues que si elle déclare l'une de ces propriétés : une qu'il ne sait pas lire fait alors échouer le test. `pick` tire la valeur voulue de la déclaration
 * (la marge à droite, d'un raccourci).
 */
export function declared(rules: readonly Rule[], properties: readonly string[], viewport: number, pick = (_property: string, value: string) => value): string | undefined {
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

/**
 * La valeur d'une variable CSS, lue dans les règles de la feuille de style compilée (`--spacing`, ou une propriété personnalisée que l'une des classes pose) ; à défaut, sa valeur de repli. Sans l'une ni l'autre, le test échoue : il
 * ne devine pas. Une variable déclarée plusieurs fois (`--spacing` surchargée sur l'élément ou sur un ancêtre) ou sous condition prend, selon l'élément et la largeur, des valeurs que ce test ne sait pas suivre : il échoue.
 * Seule exception : la couche `properties` de Tailwind, qui redit chaque `--tw-*` qu'un utilitaire pose (à `initial`, ou à la valeur initiale de son `@property`) pour les navigateurs qui ne l'enregistrent pas. C'est la couche la plus basse :
 * l'utilitaire qui pose la variable l'emporte toujours, et sans lui elle n'a pas de valeur ici. Elle ne compte pas parmi les déclarations ; aucune autre variable n'a cette exception.
 */
function variableOf(sheet: readonly Rule[], name: string, fallback?: string): string {
  const declarations = sheet.filter((rule) => rule.declarations[name] !== undefined && !(name.startsWith('--tw-') && rule.layer === 'properties'));
  if (declarations.length > 1 || declarations.some((rule) => rule.within.length > 0)) throw new Error(`Variable CSS que ce test ne sait pas résoudre : ${name} est déclarée plusieurs fois ou sous condition`);
  const value = declarations[0]?.declarations[name]?.trim() ?? fallback?.trim();
  if (value === undefined) throw new Error(`Variable CSS sans valeur : var(${name})`);
  return value;
}

/** Une valeur dont les `var(--…)` sont remplacés par ce qu'ils valent, de proche en proche. Un `var()` qu'elle ne sait pas résoudre fait échouer le test. */
export function resolved(sheet: readonly Rule[], value: string, depth = 0): string {
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

/** Une longueur en px : `0`, le seul nombre sans unité que CSS accepte pour une longueur, ou une quantité qui en est une, la police racine valant `root` px. */
export function lengthOf(sheet: readonly Rule[], value: string, root: number): number {
  const quantity = quantityOf(sheet, value, root);
  if (!quantity.length && quantity.value !== 0) throw new Error(`Longueur que ce test ne sait pas lire (un nombre sans unité) : ${value}`);
  return quantity.value;
}
