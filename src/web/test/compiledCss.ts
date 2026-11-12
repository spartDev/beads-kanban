import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { compile } from 'tailwindcss';

/**
 * Ce que les classes d'un élément déclarent dans la feuille de style de l'application, lu règle par règle. jsdom ne met rien en page et ne mesure rien : la seule trace de ce que le navigateur fera d'une classe est la règle que Tailwind écrit
 * pour elle dans `styles.css`, la vraie, compilée ici et non recopiée dans un test (comme busyBar.test.ts lit `metrics.css`). Les tests de taille de cible (WCAG 2.5.8) s'en servent : le résumé « Données du graphique » (dataSummary.test.tsx,
 * bdesk-38k.82), le bouton « Masquer Terminé » (cfdButton.test.tsx, bdesk-38k.83), le bouton du Projet de la barre du haut (TopBar.targetSize.test.tsx, bdesk-38k.84) et les liens du haut de la page d'une Epic (EpicView.targetSize.test.tsx, bdesk-38k.85),
 * comme la mise en page des identifiants de ticket longs (idLayout.ts, bdesk-38k.90). Chacun dit en tête ce qu'il lit de ces règles et ce qu'il n'en voit pas ; ce que Chromium en fait (la hauteur mesurée, ce qu'axe dit à chaque position du défilement)
 * se mesure dans un vrai navigateur : voir leurs preuves. Ce qu'ils lisent de la même façon est ici : les règles qu'une classe de l'élément pose seule (`ownRules`) et le facteur de rétrécissement d'une boîte flex (`flexShrinkOf`).
 *
 * Ce module ne devine pas, mais il ne refuse que ce qu'on lui fait lire. `lengthOf` échoue sur une unité autre que `px` et `rem`, une fonction autre que `calc`, `min` et `max`, un nombre sans unité (sauf une hauteur de ligne, que l'appelant compte en
 * tailles de police), une variable CSS sans valeur ni valeur de repli (le repli peut être un autre `var()`), ou déclarée plusieurs fois ou sous condition (hors le repli que la couche `properties` de Tailwind donne à ses `--tw-*`) ; `declared`
 * échoue sur une condition autre qu'une largeur de fenêtre (une couche dans une couche en est une). Les règles qu'un test ne lit pas passent sans bruit : chaque test dit, dans son en-tête, lesquelles il refuse et ce qui lui échappe.
 *
 * Une variable CSS se lit dans la feuille de style qu'on donne à `lengthOf` et à `resolved` : il faut donc donner à chaque élément celle qu'il voit (`seenBy`), et non la feuille compilée pour les classes de plusieurs éléments à la fois, où
 * la variable que pose l'un servirait à l'autre. Une variable se lit sur l'élément et sur ses ancêtres (`details` pour son résumé), jamais sur un descendant ni sur un cousin ; sauf les `--tw-*` de Tailwind, enregistrées en `@property`
 * avec `inherits: false`, qui ne se lisent que sur l'élément qui les pose : le `leading-*` de `details` ne donne pas sa `--tw-leading` au `text-xs` du résumé, qui prend son repli.
 *
 * Tailwind lit aussi les fichiers de `src/web`, ce module comme les tests : un mot qui y est le nom d'une classe en ferait naître la règle dans la feuille de style de production. Ce qu'un test doit nommer sans la faire naître s'écrit en morceaux
 * ou en camelCase (`FLEX_SHRINK` ci-dessous, `PLACE` dans cfdButton.test.tsx).
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

/**
 * Le sélecteur de la classe tel que Tailwind l'écrit (`CSS.escape`) : tout ce qui n'est ni lettre, ni chiffre, ni `-`, ni `_`, ni un caractère hors ASCII y est échappé (`md:hidden` : `.md\:hidden`), et un chiffre en tête, derrière un `-`
 * s'il y en a un, s'écrit en hexadécimal : la variante `2xl` devient `.\32 xl\:`, suivie du reste du nom. Une classe cherchée sous un autre nom que celui de sa règle n'est lue par personne, et sans bruit.
 */
export const selectorOf = (name: string) =>
  `.${name.replace(/[^\w\u0080-\uFFFF-]/g, '\\$&').replace(/^(-?)(\d)/, (_, dash: string, digit: string) => `${dash}\\${digit.charCodeAt(0).toString(16)} `)}`;
/** Les classes d'un élément, dans l'ordre où il les porte. */
export const classesOf = (element: Element) => (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Le sélecteur de la règle nomme-t-il l'une de ces classes (`selectors`, tels que `selectorOf` les écrit) : seule, ou dans un sélecteur composé (`header .classe`, `.classe:hover`), mais pas comme début d'une autre classe (`.classe-plus-longue`). */
const naming = (selectors: readonly string[]) => {
  const pattern = new RegExp(selectors.map((selector) => `(?<!\\\\)${escapeRegExp(selector)}(?![\\w\\\\-])`).join('|'));
  return (rule: Rule) => selectors.length > 0 && pattern.test(rule.selector);
};
/** Le sélecteur de cette règle nomme-t-il cette classe (`selector`, tel que `selectorOf` l'écrit) : seule, ou dans un sélecteur composé (`header .classe`, `.classe:hover`), mais pas comme début d'une autre classe (`.classe-plus-longue`). */
export const names = (rule: Rule, selector: string) => naming([selector])(rule);

/** Les sélecteurs d'une liste (`a, b`), séparés par les virgules qui ne sont ni échappées ni dans des parenthèses ou des crochets (`:where(a, b)`). */
function selectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let at = 0; at < selector.length; at++) {
    const char = selector[at];
    if (char === '\\') at++;
    else if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(selector.slice(from, at));
      from = at + 1;
    }
  }
  return [...parts, selector.slice(from)];
}

/**
 * La règle ne vise-t-elle que des pseudo-éléments ? Tailwind écrit `::before`, `::after`, `::marker`, `::placeholder`… pour les variantes `before:`, `after:`, `marker:`, `placeholder:`, et, à l'ancienne, `:before`, `:after`, `:first-line` ou `:first-letter`
 * pour une variante arbitraire. Ses déclarations ne s'appliquent jamais à l'élément, ni sa boîte ni ses variables : la `--tw-leading` qu'une variante `before:` pose est celle de `::before`. Un deux-points échappé (`\:`, celui d'un nom de classe) n'en
 * est pas un ; une liste de sélecteurs dont l'un vise l'élément (une variante arbitraire à virgule) s'applique à lui.
 */
export const targetsPseudoElement = (rule: Rule) => selectorList(rule.selector).every((part) => /(?<!\\)(?:::|:(?:before|after|first-line|first-letter)(?![\w-]))/i.test(part));

/**
 * Les règles qu'un élément voit pour lire ses variables, parmi `rules`, compilées pour les classes de tous les `elements` (lui compris) : celles qu'aucune de ces classes ne nomme (le thème, `:root`, la base), les siennes, et celles de ses
 * ancêtres (`details` pour son résumé), réduites à leurs variables qui s'héritent. Un descendant ou un cousin ne donne rien à personne. Une variable qui s'hérite, comme `--spacing` ou celle qu'une propriété arbitraire pose sur l'élément, vient de lui ou d'un ancêtre ;
 * une `--tw-*` ne s'hérite pas : Tailwind enregistre chacune de celles qu'un utilitaire pose en `@property` avec `inherits: false`, et ne les redit sur `*` que pour les navigateurs qui n'enregistrent pas (couche `properties`). Elle ne vient que de
 * l'élément lui-même. Une règle de pseudo-élément n'est celle de personne, ni de l'élément ni d'un ancêtre : ses variables sont celles du pseudo-élément (`targetsPseudoElement`). Une règle dont le sélecteur n'est pas la classe seule (un état, une structure :
 * `open:`, `first:`, les enfants, les descendants) ne s'applique pas toujours à l'élément : ses variables sont refusées, comme celles d'une règle sous `@media`. Une variable que l'élément voit déclarée plusieurs fois (le thème et lui, ou un ancêtre) fait
 * échouer `lengthOf`, comme avant : le test ne sait pas laquelle l'emporte. `elements` doit citer tous ceux dont les classes ont servi à compiler `rules` : les règles d'un élément oublié passeraient pour celles du thème, que tout le monde voit.
 */
export function seenBy(rules: readonly Rule[], element: Element, elements: readonly Element[]): Rule[] {
  const selectorsOf = (list: readonly Element[]) => list.flatMap(classesOf).map(selectorOf);
  const own = selectorsOf([element]);
  const above = selectorsOf(elements.filter((other) => other !== element && other.contains(element)));
  const [ownNaming, aboveNaming, involved] = [naming(own), naming(above), naming(selectorsOf(elements))];
  // Une règle qui n'est pas la classe seule reçoit une condition de plus : `variableOf` refuse les variables d'une règle conditionnelle.
  const conditioned = (rule: Rule, selectors: readonly string[]): Rule => (selectors.includes(rule.selector) ? rule : { ...rule, within: [...rule.within, `sélecteur ${rule.selector}`] });
  return rules.flatMap((rule) => {
    if (!involved(rule)) return [rule];
    if (targetsPseudoElement(rule)) return [];
    if (ownNaming(rule)) return [conditioned(rule, own)];
    if (!aboveNaming(rule)) return [];
    return [{ ...conditioned(rule, above), declarations: Object.fromEntries(Object.entries(rule.declarations).filter(([property]) => !property.startsWith('--tw-'))) }];
  });
}

/**
 * Les règles qu'une classe de l'élément pose seule, parmi `rules`, pour l'une des propriétés que le test lit (`read`), dans l'ordre de la feuille (celui de la cascade) : de quoi les passer à `declared`. Ce que le test ne sait pas lire le fait échouer, au
 * lieu de passer en silence : une règle qui nomme une classe de l'élément sans en être seule (`.classe[attribut]`, `header .classe`, `.classe:hover`) et déclare une propriété lue, ou qui déclare l'une de celles qu'il dit ne pas lire (`unread` : un
 * raccourci, une écriture logique qu'il n'ouvre pas). Une règle de pseudo-élément (`targetsPseudoElement`) est écartée : elle ne dit rien de la boîte de l'élément. Les conditions qui enveloppent une règle, `declared` les lit, une largeur de fenêtre à la fois.
 */
export function ownRules(rules: readonly Rule[], element: Element, read: readonly string[], unread: readonly string[] = []): Rule[] {
  const own = classesOf(element).map(selectorOf);
  const ownNaming = naming(own);
  const where = (rule: Rule) => [...rule.within, rule.selector].join(' → ');
  return rules.filter((rule) => {
    if (!ownNaming(rule) || targetsPseudoElement(rule)) return false;
    const refused = unread.find((property) => rule.declarations[property] !== undefined);
    if (refused !== undefined) throw new Error(`Règle que ce test ne sait pas lire : « ${where(rule)} » déclare ${refused}, que ce test ne lit pas : il lit ${read.join(', ')}`);
    const property = read.find((name) => rule.declarations[name] !== undefined);
    if (property === undefined) return false;
    if (!own.includes(rule.selector)) throw new Error(`Règle que ce test ne sait pas lire : « ${where(rule)} » déclare ${property} et nomme une classe de l'élément sans en être seule`);
    return true;
  });
}

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
 * La propriété du rétrécissement d'un élément flex, écrite en morceaux : Tailwind lit aussi ce module et les tests, et la propriété écrite d'un bloc, même dans un commentaire, y ferait naître la classe de même nom dans la feuille de style de
 * l'application.
 */
export const FLEX_SHRINK = ['flex', 'sh' + 'rink'].join('-');

/**
 * Le facteur de rétrécissement d'une boîte flex à cette largeur de fenêtre (1, la valeur initiale, tant que rien ne le change), lu dans `flex` et dans sa propriété seule : le dernier des deux déclarés l'emporte. `rules` : celles que `ownRules`
 * rend pour l'élément ; `sheet` : la feuille qu'il voit (`seenBy`), où se résolvent les `var(--…)`. `flex: none` (`0 0 auto`) et un facteur nul empêchent l'élément de rétrécir. Une valeur qu'il ne sait pas lire (`inherit`, `unset`, `revert`, un
 * facteur qui n'est pas un nombre, une variable sans valeur) fait échouer le test plutôt que de passer pour un facteur de 1.
 */
export function flexShrinkOf(sheet: readonly Rule[], rules: readonly Rule[], viewport: number): number {
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

/**
 * La valeur d'une variable CSS, lue dans les règles de la feuille de style qu'on donne (celle que `seenBy` rend pour l'élément : `--spacing`, ou une propriété personnalisée que l'une de ses classes pose) ; à défaut, sa valeur de repli. Sans l'une ni l'autre, le test échoue : il
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

/** L'index de la parenthèse fermante qui répond à celle de `text[open]` ; `-1` si le texte s'arrête avant. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let at = open; at < text.length; at++) {
    if (text[at] === '(') depth++;
    else if (text[at] === ')' && --depth === 0) return at;
  }
  return -1;
}

/**
 * Une valeur dont les `var(--…)` sont remplacés par ce qu'ils valent, de proche en proche : la variable, ou à défaut son repli, qui peut contenir d'autres `var()` (`var(--tw-leading, var(--text-xs--line-height))`) et n'est lu que s'il
 * sert. Un `var()` qu'elle ne sait pas résoudre fait échouer le test.
 */
export function resolved(sheet: readonly Rule[], value: string, depth = 0): string {
  if (depth > 8) throw new Error(`Variables CSS qui se renvoient l'une à l'autre : ${value}`);
  let text = '';
  let from = 0;
  for (const call of value.matchAll(/var\(/gi)) {
    // Dans le repli d'un `var()` déjà traité : il se résout avec ce repli, s'il sert.
    if (call.index < from) continue;
    const close = closing(value, call.index + 3);
    const args = close < 0 ? '' : value.slice(call.index + 4, close);
    const comma = args.indexOf(',');
    const name = (comma < 0 ? args : args.slice(0, comma)).trim();
    if (!/^--[\w-]+$/.test(name)) throw new Error(`Variable CSS que ce test ne sait pas résoudre : ${value}`);
    text += value.slice(from, call.index) + resolved(sheet, variableOf(sheet, name, comma < 0 ? undefined : args.slice(comma + 1)), depth + 1);
    from = close + 1;
  }
  return text + value.slice(from);
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
  // Les variables d'abord, remplacées par leur valeur comme le fait le navigateur ; puis les jetons : toute la valeur y passe, et ce qui ne ressemble à aucun d'eux (l'unité d'`1em`, d'`1vw`, de `16Q`, le `%`) est refusé.
  const text = resolved(sheet, value);
  const tokens: string[] = [];
  const pattern = /\s*([a-z]+\(|\d*\.?\d+(?:px|rem)?|[()+\-*/,])/iy;
  let end = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    tokens.push(match[1] as string);
    end = pattern.lastIndex;
  }
  const rest = text.slice(end).trim();
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

/**
 * Une longueur en px : `0`, le seul nombre sans unité que CSS accepte pour une longueur, ou une quantité qui en est une, la police racine valant `root` px. Un autre nombre sans unité n'en est pas une, sauf pour une hauteur de ligne (`text-xs` :
 * `calc(1 / 0.75)`), que la police de l'élément multiplie : l'appelant qui lit une hauteur de ligne passe `fontSize`, sa taille en px, que l'on ne calcule que si la valeur est un nombre.
 */
export function lengthOf(sheet: readonly Rule[], value: string, root: number, fontSize?: () => number): number {
  const quantity = quantityOf(sheet, value, root);
  if (quantity.length || quantity.value === 0) return quantity.value;
  if (!fontSize) throw new Error(`Longueur que ce test ne sait pas lire (un nombre sans unité) : ${value}`);
  return quantity.value * fontSize();
}
