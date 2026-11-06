import { describe, expect, it } from 'vitest';
import { collapseSpaces, ticketTitle, withoutInvisible } from '../data/helpers';
import { isInvisibleText } from '../lib/invisibleText';
import { issue } from '../test/fixtures';
import { HEAD_INVISIBLE, headCollapseSpaces, headEpicLabels, headShortTitle, headWithoutInvisible } from '../test/headTitles';
import { epicLabels, epicShortName, shortTitle } from './epics';

/**
 * Les titres ordinaires se lisent comme avant (bdesk-38k.70, revue finale). La règle commune des caractères invisibles change la classe de quelques caractères (U+3164, U+2800, U+0085, les sélecteurs de
 * variante seuls, U+06DD…) : ce qui doit changer, et rien d'autre. Chaque revue a trouvé, dans les tests de colle écrits pour le cas d'avant, un cas voisin (B1, B2, B3, B4) : la parade d'une revue
 * était un cas de plus. Ce fichier fixe donc l'invariant lui-même, contre une copie figée de ce que faisait HEAD (`test/headTitles.ts`) :
 *
 *   - **pour tout titre où aucun caractère ne change de classe, `collapseSpaces`, `shortTitle` et le libellé du filtre rendent exactement ce que rendait HEAD** ;
 *   - quand un caractère change de classe, la différence est celle que son remplaçant donnerait sur HEAD : U+3164 se lit comme une espace sans largeur (U+200B), U+0085 comme un saut de ligne, U+06DD comme une
 *     lettre (`standIn`). Pour `collapseSpaces`, `withoutInvisible` et `shortTitle` c'est exact, sur tous les titres éprouvés ;
 *   - un sélecteur de variante qu'aucun caractère qu'on voit ne précède est invisible pour la pastille et le filtre (`withoutInvisible`, `EDGE_BLANKS`, la fin de la tête) : il change, lui, `shortTitle` et
 *     `epicLabels`, et n'a pas de remplaçant (il compte pour rien dans la mesure et se rogne des bords, mais coupe encore les séries de blancs). Pour `collapseSpaces` il reste un caractère comme un autre,
 *     comme sur HEAD : c'est ce qui garde chaque espace que HEAD gardait autour de lui.
 *
 * Les titres éprouvés sont toutes les suites d'au plus quatre symboles d'un alphabet de 27 (blancs, caractères sans largeur, marques de direction, sélecteurs de variante, séparateurs, une lettre hébraïque, une
 * lettre mongole, U+3164, U+2800, U+06DD, une étiquette de drapeau…), des suites plus longues sur des alphabets qui ne gardent que les symboles du cas, et des titres tirés au hasard, de longueur 5 à 12.
 */

const SPACE = ' ';
const TAB = '\t';
const NBSP = '\u00a0';
const NEL = '\u0085';
const ZWSP = '\u200b';
const ZWNJ = '\u200c';
const ZWJ = '\u200d';
const LRM = '\u200e';
const RLM = '\u200f';
const ALM = '\u061c';
const VS15 = '\ufe0e';
const VS16 = '\ufe0f';
const FVS1 = '\u180b';
const MVS = '\u180e';
const HEBREW = '\u05e9';
const MONGOLIAN = '\u1824';
const SYRIAC = '\u0712';
const FILLER = '\u3164';
const END_OF_AYAH = '\u06dd';
const TAG = '\u{e0067}';
const BOM = '\ufeff';
const BRAILLE = '\u2800';
const IVS = '\u{e0100}';
const SIGN = '\u26a0';
/** Les neuf autres caractères de contrôle de direction (U+202A à U+202E, U+2066 à U+2069), en plus des trois marques LRM, RLM et ALM. */
const BIDI_CONTROLS = ['\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069'];

const ALPHABET = ['a', '1', SPACE, TAB, NBSP, NEL, BOM, ZWSP, ZWJ, ZWNJ, VS15, VS16, FVS1, IVS, MVS, LRM, RLM, ALM, ':', '—', '-', HEBREW, MONGOLIAN, FILLER, BRAILLE, END_OF_AYAH, TAG];

const SELECTOR = /\p{Variation_Selector}/u;
const standInOf = (char: string): string => {
  // Ce que l'ancienne règle fait du caractère qui a changé de classe : elle n'en change pas, ou le prend pour son contraire.
  if (SELECTOR.test(char) || HEAD_INVISIBLE.test(char) === isInvisibleText(char)) return char;
  if (HEAD_INVISIBLE.test(char)) return 'ß';
  return /\p{White_Space}/u.test(char) ? '\n' : ZWSP;
};
const changesClass = (char: string): boolean => !SELECTOR.test(char) && HEAD_INVISIBLE.test(char) !== isInvisibleText(char);

/** Le texte où chaque caractère qui change de classe est remplacé par ce que HEAD en fait, et un sélecteur sans caractère visible devant lui, par U+200B (`withoutInvisible` et le libellé le retirent). */
const standIn = (text: string, lonelySelectors = false): string => {
  let out = '';
  let previous = '';
  for (const char of text) {
    const attached = previous !== '' && !isInvisibleText(previous);
    out += lonelySelectors && SELECTOR.test(char) && !attached ? ZWSP : standInOf(char);
    previous = char;
  }
  return out;
};

const hasLonelySelector = (text: string): boolean => {
  let previous = '';
  for (const char of text) {
    if (SELECTOR.test(char) && (previous === '' || isInvisibleText(previous))) return true;
    previous = char;
  }
  return false;
};
/** Aucun caractère ne change de classe, sélecteurs seuls compris : le cas où `shortTitle` et le libellé du filtre doivent rendre ce que rendait HEAD. */
const unchanged = (text: string): boolean => ![...text].some(changesClass) && !hasLonelySelector(text);

const show = (text: string): string =>
  [...text].map((char) => (char === ' ' ? '␣' : /[\p{L}\p{N}\p{P}\p{S}]/u.test(char) && !SELECTOR.test(char) ? char : `⟨U+${char.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}⟩`)).join('');

/** Toutes les suites d'au plus `maxLength` symboles de `alphabet`. */
function everyText(alphabet: readonly string[], maxLength: number, visit: (text: string) => void, prefix = ''): void {
  for (const symbol of alphabet) {
    visit(prefix + symbol);
    if (maxLength > 1) everyText(alphabet, maxLength - 1, visit, prefix + symbol);
  }
}

/** Un tirage reproductible (mulberry32) : les mêmes titres à chaque passe. */
function randomTexts(alphabet: readonly string[], count: number, minLength: number, maxLength: number, visit: (text: string) => void): void {
  let state = 62;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let n = 0; n < count; n += 1) {
    const length = minLength + Math.floor(next() * (maxLength - minLength + 1));
    let text = '';
    for (let i = 0; i < length; i += 1) text += alphabet[Math.floor(next() * alphabet.length)];
    visit(text);
  }
}

type Domain = (visit: (text: string) => void) => void;
type Disagreement = { titre: string; HEAD: string; patch: string };

/** Les premiers titres d'un domaine où `patch` et `head` ne s'accordent pas, et combien il y en a. */
function disagreements(domain: Domain, applies: (text: string) => boolean, head: (text: string) => string, patch: (text: string) => string): { count: number; examples: Disagreement[] } {
  const examples: Disagreement[] = [];
  let count = 0;
  domain((text) => {
    if (!applies(text)) return;
    const expected = head(text);
    const actual = patch(text);
    if (expected === actual) return;
    count += 1;
    if (examples.length < 4) examples.push({ titre: show(text), HEAD: show(expected), patch: show(actual) });
  });
  return { count, examples };
}

const agree = { count: 0, examples: [] };
const everything = () => true;

/** Les domaines : le grand alphabet jusqu'à quatre symboles, puis, pour chaque cas qu'une revue a trouvé, un petit alphabet jusqu'à neuf. */
const full: Domain = (visit) => everyText(ALPHABET, 4, visit);
const longer: Domain = (visit) => randomTexts(ALPHABET, 120_000, 5, 12, visit);
const joiners: Domain = (visit) => everyText(['a', SPACE, TAB, ZWSP, ZWJ, VS16, FVS1, MONGOLIAN, TAG], 6, visit);
const selectorsAndHyphen: Domain = (visit) => everyText(['a', SPACE, VS16, '-', ':'], 8, visit);
const directionMarks: Domain = (visit) => everyText(['a', SPACE, RLM, ':'], 9, visit);
const invisibleTails: Domain = (visit) => everyText(['a', SPACE, ZWSP, ':'], 9, visit);

describe('les titres ordinaires se lisent comme sur HEAD', () => {
  describe('les cas des revues, écrits tels que HEAD les rend', () => {
    // B3 : la tête avant le séparateur gardait sa marque de direction : à travers l'espace elle donne leur sens aux signes neutres d'avant (le « ! » d'un mot hébreu, le « ؟ » d'un mot arabe).
    it.each([
      ['un mot hébreu, « ! », une espace et RLM', `${HEBREW}${HEBREW}${HEBREW}! ${RLM} : ab`, `${HEBREW}${HEBREW}${HEBREW}! ${RLM}`],
      ['un mot arabe, « ؟ », une espace et RLM', `\u0645\u0631\u062d\u0628\u0627\u061f ${RLM} : ab`, `\u0645\u0631\u062d\u0628\u0627\u061f ${RLM}`],
      ['une espace et LRM', `abc ${LRM} : d`, `abc ${LRM}`],
      ['une espace et la marque arabe ALM', `abc ${ALM} : d`, `abc ${ALM}`],
      ...BIDI_CONTROLS.map((control) => [`une espace et U+${control.codePointAt(0)?.toString(16).toUpperCase()}`, `abc ${control} : d`, `abc ${control}`]),
    ])('la pastille garde la marque de direction que sépare une espace : %s', (_cas, title, expected) => {
      expect(headShortTitle(title)).toBe(expected);
      expect(shortTitle(title)).toBe(expected);
      expect(epicShortName({ id: 'e-1', title })).toBe(expected);
    });

    // B4 : une série que HEAD coupait au sélecteur de variante ne doit pas redevenir une seule : l'espace derrière le liant se perdait, et le liant se collait à la lettre qui suit (elle prend sa forme liée).
    it.each([
      ['U+FE0F, un liant, une espace, deux lettres mongoles', VS16, MONGOLIAN],
      ['un sélecteur mongol, un liant, une espace, deux lettres mongoles', FVS1, MONGOLIAN],
      ['U+FE0F, un liant, une espace, deux lettres syriaques', VS16, SYRIAC],
    ])('l’espace derrière le liant reste : %s', (_cas, selector, letter) => {
      const title = `Tache ${selector}${ZWJ} ${letter}${letter}`;
      expect(headCollapseSpaces(title)).toBe(title);
      expect(collapseSpaces(title)).toBe(title);
      expect(ticketTitle({ title })).toBe(title);
    });

    // R1 : une espace et un sélecteur de variante, puis « - » : les espaces autour du sélecteur ne se fondent pas, le séparateur « espace, tiret, espace » reste lu.
    it('le séparateur « - » reste lu derrière une espace et un sélecteur de variante', () => {
      const title = `Alerte ${SIGN} ${VS16} - suite`;
      expect(headCollapseSpaces(title)).toBe(`Alerte ${SIGN} ${VS16} - suite`);
      expect(collapseSpaces(title)).toBe(`Alerte ${SIGN} ${VS16} - suite`);
      expect(shortTitle(title)).toBe(`Alerte ${SIGN}`);
    });

    // R2 : la tête se mesure telle qu'elle est écrite, avant qu'on en rogne le bout, comme sur HEAD : « V1 », une espace et U+200B passent le seuil de trois.
    it.each([
      ['une espace et U+200B', `V1 ${ZWSP} : suite`, `V1 ${ZWSP}`],
      ['une espace et un liant', `AB ${ZWJ} : suite`, `AB ${ZWJ}`],
      ['une espace et U+2060', `AB \u2060 — suite`, `AB \u2060`],
      ['une espace et U+FE0F, dont la pastille perd le sélecteur et son espace', `AB ${VS16} : suite`, 'AB'],
    ])('la tête qui passe le seuil de trois y compris son espace reste la tête : %s', (_cas, title, expected) => {
      expect(shortTitle(title)).toBe(expected);
    });
  });

  describe('collapseSpaces et withoutInvisible : exactement HEAD, ou ce que HEAD fait du remplaçant', () => {
    it('sur toutes les suites d’au plus quatre symboles du grand alphabet', () => {
      expect(disagreements(full, everything, (text) => headCollapseSpaces(standIn(text)), (text) => standIn(collapseSpaces(text)))).toEqual(agree);
      expect(disagreements(full, everything, (text) => headWithoutInvisible(standIn(text, true)), (text) => standIn(withoutInvisible(text), true))).toEqual(agree);
    }, 120_000);

    it('sur des titres tirés au hasard, de cinq à douze symboles', () => {
      expect(disagreements(longer, everything, (text) => headCollapseSpaces(standIn(text)), (text) => standIn(collapseSpaces(text)))).toEqual(agree);
      expect(disagreements(longer, everything, (text) => headWithoutInvisible(standIn(text, true)), (text) => standIn(withoutInvisible(text), true))).toEqual(agree);
    }, 120_000);

    it('B4 : sur toutes les suites d’au plus six symboles, liants, sélecteurs et lettres mongoles compris', () => {
      expect(disagreements(joiners, everything, headCollapseSpaces, collapseSpaces)).toEqual(agree);
    }, 120_000);

    it('R1 : sur toutes les suites d’au plus huit symboles, sélecteur, tiret et deux-points compris', () => {
      expect(disagreements(selectorsAndHyphen, everything, headCollapseSpaces, collapseSpaces)).toEqual(agree);
    }, 120_000);
  });

  describe('la pastille d’Epic : exactement HEAD quand aucun caractère ne change de classe', () => {
    it('sur toutes les suites d’au plus quatre symboles du grand alphabet', () => {
      expect(disagreements(full, unchanged, (text) => headShortTitle(text), (text) => shortTitle(text))).toEqual(agree);
      expect(disagreements(full, unchanged, (text) => headShortTitle(text, 3), (text) => shortTitle(text, 3))).toEqual(agree);
    }, 120_000);

    it('sur des titres tirés au hasard, de cinq à douze symboles', () => {
      expect(disagreements(longer, unchanged, (text) => headShortTitle(text), (text) => shortTitle(text))).toEqual(agree);
      expect(disagreements(longer, unchanged, (text) => headShortTitle(text, 5), (text) => shortTitle(text, 5))).toEqual(agree);
    }, 120_000);

    it('un caractère qui change de classe change la pastille comme son remplaçant sur HEAD', () => {
      const withoutLonelySelector = (text: string) => !hasLonelySelector(text);
      const head = (text: string) => headShortTitle(standIn(text));
      const patch = (text: string) => standIn(shortTitle(text));
      expect(disagreements(full, withoutLonelySelector, head, patch)).toEqual(agree);
      expect(disagreements(longer, withoutLonelySelector, head, patch)).toEqual(agree);
    }, 120_000);

    it('B3 : sur toutes les suites d’au plus neuf symboles, marque de direction, espace et deux-points compris', () => {
      expect(disagreements(directionMarks, unchanged, (text) => headShortTitle(text), (text) => shortTitle(text))).toEqual(agree);
    }, 120_000);

    it('R2 : sur toutes les suites d’au plus neuf symboles, espace sans largeur, espace et deux-points compris', () => {
      expect(disagreements(invisibleTails, unchanged, (text) => headShortTitle(text), (text) => shortTitle(text))).toEqual(agree);
    }, 120_000);
  });

  describe('le libellé du filtre : le même identifiant que HEAD quand aucun caractère ne change de classe', () => {
    /** Les libellés de deux Epics, dont l’une a le titre donné et l’autre un titre varié (une espace de plus, un caractère sans largeur, la casse). */
    const epics = (a: string, b: string) => [issue({ id: 'a-1', title: a, type: 'epic' }), issue({ id: 'b-2', title: b, type: 'epic' })];
    const variants = (text: string): string[] => [`${text} `, `${ZWSP}${text}`, text.toUpperCase(), text.replace(/ /g, '  '), `${text}${ZWSP}`, `${text}${ZWNJ}${SPACE}`];

    it('sur les titres d’au plus trois symboles et leurs variantes, et sur des titres tirés au hasard', () => {
      const domain: Domain = (visit) => {
        everyText(ALPHABET, 3, visit);
        randomTexts(ALPHABET, 20_000, 4, 9, visit);
      };
      const head = (text: string) => variants(text).map((other) => [...headEpicLabels(epics(text, other)).values()].join('|')).join('/');
      const patch = (text: string) => variants(text).map((other) => [...epicLabels(epics(text, other)).values()].join('|')).join('/');
      expect(disagreements(domain, unchanged, head, patch)).toEqual(agree);
    }, 120_000);
  });
});
