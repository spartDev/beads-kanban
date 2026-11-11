import { describe, expect, it } from 'vitest';
import { collapseSpaces, ticketTitle, withoutInvisible } from '../data/helpers';
import { isInvisibleText } from '../lib/invisibleText';
import { issue } from '../test/fixtures';
import { HEAD_BLANK_TEXT, HEAD_INVISIBLE, headCollapseSpaces, headEpicLabels, headShortTitle, headWithoutInvisible } from '../test/headTitles';
import { epicLabels, epicShortName, shortTitle } from './epics';

/**
 * Les titres ordinaires se lisent comme avant (bdesk-38k.70, revue finale ; bdesk-38k.77). La règle commune des caractères invisibles change la classe de quelques caractères (U+3164, U+2800, U+0085, les sélecteurs de
 * variante seuls, U+06DD…) : ce qui doit changer, et rien d'autre. Chaque revue a trouvé, dans les tests de colle écrits pour le cas d'avant, un cas voisin (B1, B2, B3, B4) : la parade d'une revue était un cas de plus.
 * Ce fichier fixe donc l'invariant lui-même, contre une copie figée de ce que faisait HEAD (`test/headTitles.ts`) :
 *
 *   - **pour tout titre où aucun caractère ne change de classe, `collapseSpaces`, `shortTitle` et le libellé du filtre rendent exactement ce que rendait HEAD** ;
 *   - quand un caractère change de classe, la différence est celle que son remplaçant donnerait sur HEAD (`standIn`) : U+3164 et U+2800 se lisent comme une espace sans largeur (U+200B), U+0085 comme un saut de ligne,
 *     U+06DD comme une lettre qui se prépend au graphème suivant, comme lui (U+0D4E). U+FFF9 à U+FFFB ne changent de classe que pour une des deux règles de HEAD : la catégorie `Cf` les disait invisibles, comme la règle
 *     d'aujourd'hui, mais la règle des titres qui ne disent rien (`HEAD_BLANK_TEXT`, bdesk-38k.65) ne les comptait pas. Ils se lisent comme U+200B, et la seule différence est qu'un titre fait d'eux seuls ne dit rien ;
 *   - un sélecteur de variante qu'aucun caractère qu'on voit ne précède (seul : au début, derrière un blanc ou un caractère invisible) ne se voit pas. Pour `collapseSpaces` il reste un caractère comme un autre, comme sur
 *     HEAD : c'est ce qui garde chaque espace que HEAD gardait autour de lui. Pour la pastille, une fois le titre replié, il se lit comme une étiquette (U+E007E) : sans largeur, sans effet sur la coupe, hors des bords, mais
 *     qui cache un séparateur comme lui (`LONELY`) ; la tête avant le séparateur en perd la fin, avec l'espace qui l'en sépare (`withoutDetached`). Pour le retrait et la clé de comparaison du filtre, qui n'ont pas de repli
 *     devant eux, il se lit comme U+200B. Un sélecteur seul en bout de titre rogne donc aussi la marque de direction qui le précède, comme HEAD rogne celle d'un titre qui finit par elle (remarque 2 de la dernière revue de bdesk-38k.70).
 *
 * Ce que le test éprouve, et ce qu'il ne dit pas :
 *
 *   - les titres : toutes les suites d'au plus quatre symboles d'un alphabet de 28 (blancs, caractères sans largeur, marques de direction, sélecteurs de variante, séparateurs, un contrôle visible, une lettre hébraïque, une
 *     lettre mongole, U+3164, U+2800, U+06DD, U+FFF9, une étiquette de drapeau…), des suites plus longues sur des alphabets qui ne gardent que les symboles du cas, des titres tirés au hasard de 5 à 12 symboles et de 30 à 60 ;
 *   - la coupe : la pastille est éprouvée à 2, 3 et 5 unités sur les titres courts, et à 12 et à la limite de 24 sur les titres longs. Les domaines sont comptés (`truncated`) : sans cela rien ne prouverait que la coupe est jouée ;
 *   - les comparaisons valent pour ces domaines, non pour tous les titres : ce sont des échantillons, très vastes, mais finis. Un second domaine (`graphemes`) joue les graphèmes qui se joignent : un pictogramme, un liant, des
 *     sélecteurs seuls ou non, un accent combinant. Ni les drapeaux (paires d'indicateurs régionaux), ni les conjonctions indiennes n'y sont : les cas nommés de `epics.test.ts` les éprouvent ;
 *   - le remplaçant d'un sélecteur seul (une étiquette) prolonge le graphème qui le précède comme lui. Ceux de U+3164 et de U+2800 (U+200B, un caractère de contrôle pour la norme des graphèmes) ne le font pas : une marque qui les
 *     suit fait corps avec eux, pas avec U+200B. La coupe ne tombe jamais devant un graphème sans largeur, si bien que cet écart ne change aucune pastille des domaines du test. Vérifié hors du dépôt sur plus de trente millions de
 *     comparaisons (le grand alphabet jusqu'à quatre symboles, des graphèmes qui se joignent jusqu'à six, des titres à sélecteur seul jusqu'à six) : le seul cas où il en change une est une lettre qui se prépend (U+06DD) suivie de
 *     U+3164 ou de U+2800 puis d'une marque, que le vrai graphème tient ensemble et que le remplaçant sépare (3 670 comparaisons sur 15,7 millions). C'est alors le modèle qui s'écarte du code, non l'inverse ; aucun domaine du test
 *     ne combine U+06DD, un remplisseur et une marque qui se voit ;
 *   - les libellés du filtre : exacts quand aucun caractère ne change de classe ; au remplaçant près quand l'un d'eux change ; pour un sélecteur seul, ce sont les identifiants que HEAD ajoute sur le titre lu (le libellé écrit
 *     garde le sélecteur : il ne se compare pas caractère pour caractère, `collapseSpaces` le fait).
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
/** Un caractère de contrôle qu'on voit (ni blanc, ni ignorable) : un sélecteur qui le suit lui est attaché, mais la norme des graphèmes (UAX #29, GB4) l'en sépare (remarque 1 de la dernière revue de bdesk-38k.70). */
const CONTROL = '\u0001';
const ESCAPE = '\u001b';
const DELETE = '\u007f';
const C1_CONTROL = '\u0090';
/** L'ancre d'annotation : `Cf` pour HEAD, invisible pour la règle d'aujourd'hui, mais jamais « un titre qui ne dit rien » pour HEAD (bdesk-38k.77). */
const ANNOTATION = '\ufff9';
const ANNOTATION_SEPARATOR = '\ufffa';
const ANNOTATION_TERMINATOR = '\ufffb';
/** Le remplaçant de U+06DD : une lettre (HEAD la garde) qui se prépend au graphème suivant, comme elle (`Prepend`, UAX #29). */
const PREPEND_LETTER = '\u0d4e';
/** Les neuf autres caractères de contrôle de direction (U+202A à U+202E, U+2066 à U+2069), en plus des trois marques LRM, RLM et ALM. */
const BIDI_CONTROLS = ['\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069'];

const ALPHABET = ['a', CONTROL, SPACE, TAB, NBSP, NEL, BOM, ZWSP, ZWJ, ZWNJ, VS15, VS16, FVS1, IVS, MVS, LRM, RLM, ALM, ':', '—', '-', HEBREW, MONGOLIAN, FILLER, BRAILLE, END_OF_AYAH, TAG, ANNOTATION];

const SELECTOR = /\p{Variation_Selector}/u;
const BLANK = /\p{White_Space}/u;
/** Un sélecteur de variante est seul quand aucun caractère qu'on voit ne le précède : au début du texte, derrière un blanc ou derrière un caractère invisible. */
const isLonely = (char: string, previous: string): boolean => SELECTOR.test(char) && (previous === '' || isInvisibleText(previous));

/**
 * Ce que HEAD fait du caractère qui a changé de classe, pour qu'on le lui donne à lire : il ne change pas de classe, ou HEAD le prend pour son contraire. HEAD a deux règles (`HEAD_INVISIBLE` : le retrait, le repli, les
 * bords et la mesure ; `HEAD_BLANK_TEXT` : « un titre qui ne dit rien »), le caractère change de classe s'il en change pour l'une des deux. Un sélecteur de variante a son traitement à part.
 */
const standInOf = (char: string): string => {
  if (SELECTOR.test(char)) return char;
  const now = isInvisibleText(char);
  if (HEAD_INVISIBLE.test(char) === now && HEAD_BLANK_TEXT.test(char) === now) return char;
  if (!now) return PREPEND_LETTER;
  return BLANK.test(char) ? '\n' : ZWSP;
};
const changesClass = (char: string): boolean => standInOf(char) !== char;

/** Le texte où chaque caractère qui change de classe est remplacé par ce que HEAD en fait, et un sélecteur sans caractère visible devant lui, par U+200B (`withoutInvisible` et le libellé le retirent). */
const standIn = (text: string, lonelySelectors = false): string => {
  let out = '';
  let previous = '';
  for (const char of text) {
    out += lonelySelectors && isLonely(char, previous) ? ZWSP : standInOf(char);
    previous = char;
  }
  return out;
};

const hasLonelySelector = (text: string): boolean => {
  let previous = '';
  for (const char of text) {
    if (isLonely(char, previous)) return true;
    previous = char;
  }
  return false;
};
/** Aucun caractère ne change de classe, sélecteurs seuls compris : le cas où `shortTitle` et le libellé du filtre doivent rendre ce que rendait HEAD. */
const unchanged = (text: string): boolean => ![...text].some(changesClass) && !hasLonelySelector(text);

/** Le texte sans ses sélecteurs de variante seuls (qu'aucun caractère qu'on voit ne précède). */
const withoutLonelySelectors = (text: string): string => {
  let out = '';
  let previous = '';
  for (const char of text) {
    if (!isLonely(char, previous)) out += char;
    previous = char;
  }
  return out;
};

/**
 * Ce que HEAD lit à la place d'un sélecteur de variante seul (qu'aucun caractère qu'on voit ne précède), une fois le titre replié : une étiquette (U+E007E), qui ne se voit pas, n'a pas de largeur, prolonge le graphème
 * qui la précède comme lui, ne forme pas un blanc et ne s'attache à rien. HEAD la retire de la mesure et des bords comme `Cf`, et elle cache comme lui un séparateur (« espace, sélecteur, tiret ») que seule une espace
 * suivie du signe ferait lire. Le repli, lui, la lit comme un sélecteur : un caractère comme un autre (voir `standIn`).
 */
const LONELY = '\u{e007e}';
const withLonelyAsTag = (text: string): string => {
  let out = '';
  let previous = '';
  for (const char of text) {
    out += isLonely(char, previous) ? LONELY : char;
    previous = char;
  }
  return out;
};

/**
 * La tête avant le séparateur perd les sélecteurs seuls qu'une espace sépare de ce qui précède, avec cette espace, et rien d'autre (`withoutDetachedSelectors`, revues de bdesk-38k.70) : la fin de la tête faite de blancs
 * et de sélecteurs seuls, quand elle finit par un sélecteur seul, se coupe à son premier blanc. Écrite ici pour l'oracle, qui ne coupe pas la tête : elle est la règle, et le code la vérifie.
 */
const withoutDetached = (head: string): string => {
  const run = new RegExp(`[\\s${LONELY}]*$`, 'u').exec(head);
  const text = run?.[0] ?? '';
  const blank = text.endsWith(LONELY) ? text.search(/\s/u) : -1;
  return blank < 0 ? head : head.slice(0, (run?.index ?? 0) + blank);
};

/** La pastille de HEAD pour le titre tel que la règle commune le lit : les caractères qui changent de classe remplacés, les sélecteurs seuls lus comme des étiquettes une fois le titre replié, et la tête coupée comme le code. */
const headPill = (title: string, max = 24): string => headShortTitle(standIn(title), max, (text) => withLonelyAsTag(headCollapseSpaces(text)), withoutDetached);
/** La pastille du patch, ramenée à l'alphabet de HEAD : mêmes remplaçants, et ses sélecteurs seuls lus comme des étiquettes. Rien d'autre ne les distingue : la comparaison est exacte. */
const patchPill = (title: string, max = 24): string => withLonelyAsTag(standIn(shortTitle(title, max)));

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

/** Combien de titres du domaine ont une pastille coupée (qui finit par l'ellipse) : une comparaison qui ne coupe jamais ne dit rien de la coupe. */
function truncated(domain: Domain, applies: (text: string) => boolean, pill: (text: string) => string): { titles: number; truncated: number } {
  let titles = 0;
  let cut = 0;
  domain((text) => {
    if (!applies(text)) return;
    titles += 1;
    if (pill(text).endsWith('…')) cut += 1;
  });
  return { titles, truncated: cut };
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
/** Remarque 1 de la dernière revue : un sélecteur de variante (de la plage de base ou étendu) derrière un caractère de contrôle visible, que la coupe d'un graphème à la fois séparait de lui. */
const controlsAndSelectors: Domain = (visit) => everyText(['a', 'b', CONTROL, ESCAPE, DELETE, C1_CONTROL, VS16, FVS1, IVS, SPACE], 5, visit);
/** Les graphèmes qui se joignent : un pictogramme, un liant, des sélecteurs de variante seuls ou non, un remplisseur, un accent combinant. Retirer un sélecteur seul d'entre un liant et un pictogramme les joindrait. */
const graphemes: Domain = (visit) => everyText(['a', SIGN, ZWJ, VS16, FVS1, FILLER, SPACE, ':', '\u0301'], 6, visit);
/** Des titres plus longs que la limite de la pastille (24 unités) : la coupe y tombe à la fin d'un mot ou en plein mot, devant ou derrière des caractères sans largeur. Sans caractère qui change de classe ni sélecteur. */
const PLAIN_WORDS = ['a', 'b', 'c', 'd', 'e', 'f', 'a', 'b', 'c', SPACE, SPACE, SPACE, SPACE, TAB, NBSP, ZWSP, ZWJ, ZWNJ, LRM, RLM, CONTROL, ':', '—', '-', HEBREW, MONGOLIAN];
const longPlain: Domain = (visit) => randomTexts(PLAIN_WORDS, 20_000, 30, 60, visit);
/** Les mêmes, avec les caractères qui changent de classe et des sélecteurs de variante, seuls ou non. */
const WORDS = [...PLAIN_WORDS, FILLER, BRAILLE, NEL, ANNOTATION, END_OF_AYAH, VS16, FVS1, IVS];
const longAll: Domain = (visit) => randomTexts(WORDS, 20_000, 30, 60, visit);

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

    // Remarque 1 de la dernière revue de bdesk-38k.70 (bdesk-38k.77) : un sélecteur de variante derrière un caractère de contrôle visible est attaché à lui, la mesure du titre entier le compte pour une unité comme HEAD, et la coupe
    // d'un graphème à la fois le comptait pour zéro : la norme des graphèmes sépare le sélecteur du contrôle (GB4). La coupe tombait une unité plus tard que sur HEAD, ou gardait le sélecteur que HEAD retirait.
    it.each([
      ['U+0001', CONTROL],
      ['l’échappement (U+001B)', ESCAPE],
      ['le caractère d’effacement (U+007F)', DELETE],
      ['un contrôle C1 (U+0090)', C1_CONTROL],
    ])('la coupe compte pour une unité le sélecteur de variante qui suit un caractère de contrôle visible, comme HEAD : %s', (_cas, control) => {
      const long = `abcdefghij${control}${VS16}klmnopqrstuvwxyz0123456789`;
      expect(headShortTitle(long)).toBe(`abcdefghij${control}${VS16}klmnopqrstu…`);
      expect(shortTitle(long)).toBe(`abcdefghij${control}${VS16}klmnopqrstu…`);
      expect(headShortTitle(`a${control}${VS16}bc`, 3)).toBe(`a${control}…`);
      expect(shortTitle(`a${control}${VS16}bc`, 3)).toBe(`a${control}…`);
    });

    // Remarque 2 de la dernière revue de bdesk-38k.70 (bdesk-38k.77) : un sélecteur de variante seul en bout de titre ne se voit pas, et il rogne avec lui la marque de direction qui le précède. HEAD, pour qui le sélecteur était un
    // caractère comme un autre, la gardait ; mais HEAD rogne cette marque du bout d'un titre qui n'a pas de sélecteur, et la pastille d'un mot hébreu suivi de « ! », d'une espace, de RLM, d'une espace et de U+FE0F est celle de ce titre sans lui.
    it('rogne la marque de direction qui précède un sélecteur de variante seul en bout de titre, comme HEAD la rogne en bout de titre', () => {
      const word = `${HEBREW}${HEBREW}${HEBREW}${HEBREW}!`;
      expect(headShortTitle(`${word} ${RLM}`)).toBe(word);
      expect(shortTitle(`${word} ${RLM}`)).toBe(word);
      expect(headShortTitle(`${word} ${RLM} ${VS16}`)).toBe(`${word} ${RLM}${VS16}`);
      expect(shortTitle(`${word} ${RLM} ${VS16}`)).toBe(word);
    });

    // bdesk-38k.77 : U+FFF9 à U+FFFB. HEAD les retirait comme tout `Cf` ; la règle commune, bâtie sur `Default_Ignorable_Code_Point`, les gardait, et la pastille d'« U+FFF9 Kanban » montrait un retrait vide de 7 px.
    it.each([
      ['l’ancre d’annotation', ANNOTATION],
      ['le séparateur d’annotation', ANNOTATION_SEPARATOR],
      ['le terminateur d’annotation', ANNOTATION_TERMINATOR],
    ])('lit %s comme HEAD la lit : un caractère sans largeur que le retrait, le repli, les bords et la mesure ne comptent pas', (_cas, anchor) => {
      expect(headShortTitle(`${anchor}Kanban`)).toBe('Kanban');
      expect(shortTitle(`${anchor}Kanban`)).toBe('Kanban');
      expect(headShortTitle(`Kanban${anchor}`)).toBe('Kanban');
      expect(shortTitle(`Kanban${anchor}`)).toBe('Kanban');
      expect(headShortTitle(`${'A'.repeat(23)}${anchor}B`)).toBe(`${'A'.repeat(23)}${anchor}B`);
      expect(shortTitle(`${'A'.repeat(23)}${anchor}B`)).toBe(`${'A'.repeat(23)}${anchor}B`);
      expect(headCollapseSpaces(`A ${anchor} B`)).toBe(`A ${anchor}B`);
      expect(collapseSpaces(`A ${anchor} B`)).toBe(`A ${anchor}B`);
      expect(headWithoutInvisible(`Kan${anchor}ban`)).toBe('Kanban');
      expect(withoutInvisible(`Kan${anchor}ban`)).toBe('Kanban');
      const epics = (a: string, b: string) => [issue({ id: 'a-1', title: a, type: 'epic' }), issue({ id: 'b-2', title: b, type: 'epic' })];
      expect([...epicLabels(epics(`${anchor}Kanban`, 'Kanban')).values()]).toEqual([...headEpicLabels(epics(`${anchor}Kanban`, 'Kanban')).values()]);
    });

    // La seule différence : HEAD ne comptait pas U+FFF9 à U+FFFB dans « un titre qui ne dit rien », sa catégorie `Cf` les disait pourtant invisibles. Un titre fait d'eux seuls ne se voit pas : un ticket s'écrit « Sans titre »,
    // une Epic se lit par son identifiant (elle gardait l'ancre invisible pour libellé).
    it('lit par son identifiant l’Epic dont le titre n’est fait que d’ancres d’annotation : HEAD lui laissait l’ancre pour libellé', () => {
      const epic = [issue({ id: 'a-1', title: `${ANNOTATION}${ANNOTATION_TERMINATOR}`, type: 'epic' })];
      expect(HEAD_BLANK_TEXT.test(ANNOTATION)).toBe(false);
      expect(isInvisibleText(ANNOTATION)).toBe(true);
      expect([...headEpicLabels(epic).values()]).toEqual([`${ANNOTATION}${ANNOTATION_TERMINATOR}`]);
      expect([...epicLabels(epic).values()]).toEqual(['a-1']);
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

    it('sur des titres plus longs que la limite : la coupe tombe où elle tombait, à la limite de 24 unités et à celle de 12', () => {
      expect(disagreements(longPlain, unchanged, (text) => headShortTitle(text), (text) => shortTitle(text))).toEqual(agree);
      expect(disagreements(longPlain, unchanged, (text) => headShortTitle(text, 12), (text) => shortTitle(text, 12))).toEqual(agree);
    }, 120_000);

    it('remarque 1 : sur toutes les suites d’au plus cinq symboles où un sélecteur de variante suit un caractère de contrôle visible, à trois, quatre et cinq unités', () => {
      for (const max of [3, 4, 5]) expect(disagreements(controlsAndSelectors, unchanged, (text) => headShortTitle(text, max), (text) => shortTitle(text, max))).toEqual(agree);
    }, 120_000);

    it('B3 : sur toutes les suites d’au plus neuf symboles, marque de direction, espace et deux-points compris', () => {
      expect(disagreements(directionMarks, unchanged, (text) => headShortTitle(text), (text) => shortTitle(text))).toEqual(agree);
    }, 120_000);

    it('R2 : sur toutes les suites d’au plus neuf symboles, espace sans largeur, espace et deux-points compris', () => {
      expect(disagreements(invisibleTails, unchanged, (text) => headShortTitle(text), (text) => shortTitle(text))).toEqual(agree);
    }, 120_000);
  });

  // Pour un titre qui change de classe, ou qui porte un sélecteur seul, HEAD n'a pas de pastille à donner : on lui donne le titre tel que la règle le lit (`headPill`). Quand rien ne change, c'est le titre lui-même, et
  // la comparaison est exacte (le test du dessus la dit seule). La comparaison est exacte aussi quand quelque chose change : le remplaçant est lu comme le caractère, sans « ou presque ». La coupe est jouée : à deux, trois
  // et cinq unités sur les titres courts, à 12 et à la limite de 24 sur les titres longs (`truncated` le compte).
  describe('la pastille d’Epic : HEAD sur le titre tel que la règle commune le lit, quand un caractère change de classe ou qu’un sélecteur est seul', () => {
    it('sur toutes les suites d’au plus quatre symboles du grand alphabet, coupées à deux unités', () => {
      expect(disagreements(full, everything, (text) => headPill(text, 2), (text) => patchPill(text, 2))).toEqual(agree);
    }, 120_000);

    it('sur toutes les suites d’au plus six symboles qui joignent des graphèmes : pictogramme, liant, sélecteurs, accent combinant, coupées à trois unités', () => {
      expect(disagreements(graphemes, everything, (text) => headPill(text, 3), (text) => patchPill(text, 3))).toEqual(agree);
    }, 120_000);

    it('sur des titres tirés au hasard, de cinq à douze symboles, coupés à cinq unités et à la limite de 24', () => {
      expect(disagreements(longer, everything, (text) => headPill(text, 5), (text) => patchPill(text, 5))).toEqual(agree);
      expect(disagreements(longer, everything, (text) => headPill(text), (text) => patchPill(text))).toEqual(agree);
    }, 120_000);

    it('sur des titres de trente à soixante symboles, coupés à la limite de 24 et à 12', () => {
      expect(disagreements(longAll, everything, (text) => headPill(text), (text) => patchPill(text))).toEqual(agree);
      expect(disagreements(longAll, everything, (text) => headPill(text, 12), (text) => patchPill(text, 12))).toEqual(agree);
    }, 120_000);

    it('compte les titres dont la pastille est coupée, dans chaque domaine : la coupe est jouée, jamais seulement évitée', () => {
      const cut = (domain: Domain, max: number, applies: (text: string) => boolean = everything) => truncated(domain, applies, (text) => headPill(text, max));
      const shortTitles = cut(full, 2);
      const randomTitles = cut(longer, 5);
      const longTitles = cut(longAll, 24);
      const halfLimit = cut(longAll, 12);
      // Des titres qui changent de classe, ou qui portent un sélecteur seul, sont coupés aussi.
      const changed = cut(longAll, 12, (text) => !unchanged(text));
      expect(shortTitles.truncated).toBeGreaterThan(shortTitles.titles / 10);
      expect(randomTitles.truncated).toBeGreaterThan(randomTitles.titles / 10);
      expect(longTitles.truncated).toBeGreaterThan(longTitles.titles / 3);
      expect(halfLimit.truncated).toBeGreaterThan(halfLimit.titles / 2);
      expect(changed.truncated).toBeGreaterThan(changed.titles / 2);
    }, 120_000);
  });

  describe('le libellé du filtre : le même identifiant que HEAD, ou que HEAD sur le titre tel que la règle le lit', () => {
    /** Les libellés de deux Epics, dont l’une a le titre donné et l’autre un titre varié (une espace de plus, un caractère sans largeur, la casse). */
    const epics = (a: string, b: string) => [issue({ id: 'a-1', title: a, type: 'epic' }), issue({ id: 'b-2', title: b, type: 'epic' })];
    /** Le titre sans ses caractères qui changent de classe, et sans ses sélecteurs seuls : ce qu'on ne voit pas ne le distingue plus, et le filtre doit en tenir compte pour les deux. */
    const plain = (text: string): string => withoutLonelySelectors([...text].filter((char) => !changesClass(char)).join(''));
    const variants = (text: string): string[] => [`${text} `, `${ZWSP}${text}`, text.toUpperCase(), text.replace(/ /g, '  '), `${text}${ZWSP}`, `${text}${ZWNJ}${SPACE}`, plain(text)];
    const domain: Domain = (visit) => {
      everyText(ALPHABET, 3, visit);
      randomTexts(ALPHABET, 20_000, 4, 9, visit);
    };
    const joined = (labels: Map<string, string>) => [...labels.values()].join('|');
    /** Quelles Epics portent leur identifiant (« Kanban (a-1) »), l'une après l'autre. */
    const decorated = (labels: Map<string, string>) => [...labels].map(([id, label]) => label.endsWith(` (${id})`)).join();

    it('exactement quand aucun caractère ne change de classe, sur les titres d’au plus trois symboles et leurs variantes, et sur des titres tirés au hasard', () => {
      const head = (text: string) => variants(text).map((other) => joined(headEpicLabels(epics(text, other)))).join('/');
      const patch = (text: string) => variants(text).map((other) => joined(epicLabels(epics(text, other)))).join('/');
      expect(disagreements(domain, unchanged, head, patch)).toEqual(agree);
    }, 120_000);

    it('au remplaçant près quand un caractère change de classe : identifiants compris', () => {
      const noLonely = (text: string) => !hasLonelySelector(text) && [...text].some(changesClass);
      const head = (text: string) => variants(text).map((other) => joined(headEpicLabels(epics(standIn(text), standIn(other))))).join('/');
      const patch = (text: string) => variants(text).map((other) => standIn(joined(epicLabels(epics(text, other))))).join('/');
      expect(disagreements(domain, noLonely, head, patch)).toEqual(agree);
    }, 120_000);

    it('avec un sélecteur seul : les mêmes identifiants que HEAD sur le titre lu, où il vaut U+200B (le libellé écrit garde le sélecteur)', () => {
      const lonely = (text: string) => hasLonelySelector(text);
      const head = (text: string) => variants(text).map((other) => decorated(headEpicLabels(epics(standIn(text, true), standIn(other, true))))).join('/');
      const patch = (text: string) => variants(text).map((other) => decorated(epicLabels(epics(text, other)))).join('/');
      expect(disagreements(domain, lonely, head, patch)).toEqual(agree);
    }, 120_000);
  });

  describe('le test éprouve ce qu’il dit', () => {
    it('ne change de classe, dans l’alphabet, que ce qui doit changer, et chaque remplaçant est lu par HEAD comme la règle d’aujourd’hui lit le caractère', () => {
      const changed = ALPHABET.filter(changesClass);
      expect(changed.map((char) => `U+${char.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}`)).toEqual(['U+0085', 'U+3164', 'U+2800', 'U+06DD', 'U+FFF9']);
      for (const char of changed) {
        const stand = standInOf(char);
        expect(stand.length, show(char)).toBe(char.length);
        expect(HEAD_INVISIBLE.test(stand), show(char)).toBe(isInvisibleText(char));
        expect(HEAD_BLANK_TEXT.test(stand), show(char)).toBe(isInvisibleText(char));
        expect(BLANK.test(stand), show(char)).toBe(BLANK.test(char));
      }
    });
  });
});
