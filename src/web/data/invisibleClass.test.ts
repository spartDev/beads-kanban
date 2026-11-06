import { describe, expect, it } from 'vitest';
import { epicLabels, shortTitle } from '../kanban/epics';
import { isInvisibleText } from '../lib/invisibleText';
import { issue } from '../test/fixtures';
import { collapseSpaces, withoutInvisible } from './helpers';

/**
 * Une seule classe de caractères qu'on ne voit pas (bdesk-38k.70). `isInvisibleText` la dit (lib/invisibleText) ; trois autres expressions la suivent, et s'écrivaient encore par la catégorie `Cf`, que
 * bdesk-38k.65 a trouvée fausse dans les deux sens : `withoutInvisible` (ce que l'écran occupe, ce qui fait deux titres le même), la série de blancs de `collapseSpaces` et les bords que la pastille d'Epic
 * rogne (`shortTitle`). Ce fichier les tient accordées à `isInvisibleText` sur chaque point de code, pour qu'une règle changée d'un côté seulement échoue ici, et non sur un titre en production :
 *
 *   - `withoutInvisible` retire les caractères invisibles qui ne sont pas des blancs (un blanc occupe sa place : l'espace d'un titre compte), jamais un caractère qui se voit ;
 *   - `collapseSpaces` replie en une seule espace les blancs d'une série où se mêlent des caractères invisibles, et garde chacun de ces caractères à sa place ;
 *   - `shortTitle` rogne de la pastille tout ce qui est invisible au bord du titre ;
 *   - `epicLabels` tient pour le même titre deux titres qui ne diffèrent que par un caractère invisible.
 *
 * Une exception, dite et mesurée : un sélecteur de variante qui suit un caractère qu'on voit en fait partie (« ⚠ » suivi de U+FE0F est le signe en couleurs : sans lui il redevient un signe noir). Il n'est
 * invisible que seul, ou derrière un caractère invisible ; et aucune de ces expressions ne lui fait prendre, ni perdre, un caractère qu'on voit (revue de bdesk-38k.70, B1). Les tests ci-dessous l'écrivent à part.
 * La classe de chaque point de code est lue chez `isInvisibleText`, la règle des textes invisibles, et chez les propriétés Unicode, non dans le code qu'ils éprouvent.
 */

const hex = (code: number) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;

/** Les points de code d'une liste, groupés en plages (« U+3164, U+FE00–U+FE0F ») : un désaccord s'y lit d'un coup d'œil, au lieu de milliers de lignes. */
function asRanges(codes: readonly number[]): string[] {
  const out: [number, number][] = [];
  for (const code of codes) {
    const last = out[out.length - 1];
    if (last && last[1] === code - 1) last[1] = code;
    else out.push([code, code]);
  }
  return out.map(([from, to]) => (from === to ? hex(from) : `${hex(from)}–${hex(to)}`));
}

/** Chaque point de code de l'Unicode, sauf les demi-codets (qui ne sont pas des caractères). */
function everyCodePoint(visit: (code: number, char: string) => void) {
  for (let code = 0; code <= 0x10ffff; code += 1) {
    if (code >= 0xd800 && code <= 0xdfff) continue;
    visit(code, String.fromCodePoint(code));
  }
}

/**
 * Les points de code qui peuvent changer ce que le filtre lit : tous ceux que la règle dit invisibles, toute la catégorie `Cf` (ceux que l'ancienne règle disait tels), et un sur soixante et un des autres.
 * Le filtre compare des titres par `withoutInvisible` et `collapseSpaces`, balayés plus haut sur chaque point de code : lui compte dix fois plus cher qu'eux (une liste d'Epics, des tables).
 */
function someCodePoints(visit: (code: number, char: string) => void) {
  everyCodePoint((code, char) => {
    if (isInvisibleText(char) || /\p{Cf}/u.test(char) || code % 61 === 0) visit(code, char);
  });
}

const BLANK = /\p{White_Space}/u;
/** Les blancs que `collapseSpaces` replie : ceux d'Unicode, et U+FEFF, que JavaScript compte parmi les blancs (`\s`) et que `collapseSpaces` a toujours replié. */
const FOLDED = /[\p{White_Space}\ufeff]/u;
const VARIATION_SELECTOR = /\p{Variation_Selector}/u;

type Kind = 'blank' | 'silent' | 'visible';
const kindOf = (char: string): Kind => (BLANK.test(char) ? 'blank' : isInvisibleText(char) ? 'silent' : 'visible');
/** Les caractères d'un texte, chacun avec sa sorte et « attaché » quand c'est un sélecteur de variante derrière un caractère qu'on voit. */
const scan = (text: string) => {
  const chars = [...text];
  return chars.map((char, index) => ({
    char,
    kind: kindOf(char),
    attached: VARIATION_SELECTOR.test(char) && index > 0 && kindOf(chars[index - 1] as string) === 'visible',
  }));
};
/** Un caractère que le titre n'écrit qu'à l'œil nu : qu'on ne voit pas, et qui ne fait pas corps avec le caractère qu'on voit devant lui. */
const ignorable = (token: { kind: Kind; attached: boolean }) => token.kind !== 'visible' && !token.attached;
/** Pour chaque sélecteur de variante d'un texte, dans l'ordre : suit-il un caractère qu'on voit ? C'est ce qui décide du dessin de ce caractère. */
const attachments = (text: string) => scan(text).filter((token) => VARIATION_SELECTOR.test(token.char)).map((token) => token.attached);

/** Tous les textes d'au plus cinq éléments pris parmi des lettres, des blancs, des caractères invisibles dont un liant, un sélecteur de variante et deux signes qui se dessinent (111 111 textes). */
const ALPHABET = ['a', ' ', '\u00a0', '\u3164', '\ufe0f', '\u06dd', '\u200b', '\u2800', '⚠', '\u200d'];
const EVERY: string[] = [''];
{
  let texts = [''];
  for (let length = 1; length <= 5; length += 1) {
    texts = texts.flatMap((text) => ALPHABET.map((element) => text + element));
    EVERY.push(...texts);
  }
}

describe('la classe des caractères invisibles, suivie par les expressions qui rognent, mesurent et comparent les titres', () => {
  it('`withoutInvisible` retire un caractère exactement quand il est invisible sans être un blanc', () => {
    const apart: number[] = [];
    everyCodePoint((code, char) => {
      const expected = isInvisibleText(char) && !BLANK.test(char) ? '' : char;
      if (withoutInvisible(char) !== expected) apart.push(code);
    });

    expect(asRanges(apart)).toEqual([]);
  });

  it('`collapseSpaces` replie une espace que borde un caractère invisible, et seulement un tel caractère : il reste à sa place', () => {
    // « a, une espace, c, une espace, b » : un blanc se replie en une espace (« a b »), un caractère invisible reste et fait de ses deux espaces une seule (« a cb »), un caractère qu'on voit ne
    // replie rien (« a c b »). Un sélecteur de variante est un caractère comme un autre pour le repli, comme sur HEAD : il coupe la série, et chaque espace reste (« a c b »).
    const apart: number[] = [];
    everyCodePoint((code, char) => {
      const expected = FOLDED.test(char) ? 'a b' : isInvisibleText(char) && !VARIATION_SELECTOR.test(char) ? `a ${char}b` : `a ${char} b`;
      if (collapseSpaces(`a ${char} b`) !== expected) apart.push(code);
    });

    expect(asRanges(apart)).toEqual([]);
  });

  it('`collapseSpaces` garde tel quel un caractère invisible qui n’est pas un blanc, et replie les blancs qui se suivent', () => {
    const apart: number[] = [];
    everyCodePoint((code, char) => {
      const expected = FOLDED.test(char) ? 'a b' : `a${char}${char}b`;
      if (collapseSpaces(`a${char}${char}b`) !== expected) apart.push(code);
    });

    expect(asRanges(apart)).toEqual([]);
  });

  describe('la pastille d’Epic rogne les bords du titre : tout ce qui est invisible, sauf un sélecteur de variante qui suit un caractère qu’on voit', () => {
    // « Kanban » passe le seuil de la tête (« V1 » en est trop mince) et la limite de la pastille : ces essais ne tiennent qu'aux bords.
    it('au début du titre', () => {
      const apart: number[] = [];
      everyCodePoint((code, char) => {
        const expected = isInvisibleText(char) ? 'Kanban' : `${char}Kanban`;
        if (shortTitle(`${char}Kanban`) !== expected) apart.push(code);
      });

      expect(asRanges(apart)).toEqual([]);
    });

    it('à la fin du titre', () => {
      const apart: number[] = [];
      everyCodePoint((code, char) => {
        // Un sélecteur de variante derrière « n » (un caractère qu'on voit) fait corps avec lui : il reste.
        const expected = isInvisibleText(char) && !VARIATION_SELECTOR.test(char) ? 'Kanban' : `Kanban${char}`;
        if (shortTitle(`Kanban${char}`) !== expected) apart.push(code);
      });

      expect(asRanges(apart)).toEqual([]);
    });

    it('derrière un caractère invisible, un sélecteur de variante ne tient à rien : il est rogné comme les autres', () => {
      const apart: number[] = [];
      everyCodePoint((code, char) => {
        if (!VARIATION_SELECTOR.test(char)) return;
        if (shortTitle(`Kanban\u200b${char}`) !== 'Kanban' || shortTitle(`${char}\u200bKanban`) !== 'Kanban') apart.push(code);
      });

      expect(asRanges(apart)).toEqual([]);
    });
  });

  describe('le filtre Epic tient pour le même titre deux titres qui ne diffèrent que par un caractère invisible', () => {
    const labelsOf = (...titles: string[]) =>
      Object.fromEntries(epicLabels(titles.map((title, index) => issue({ id: 'abcd'.charAt(index), title, type: 'epic' }))));
    /** Les deux Epics se lisent-elles pareil, si bien que chacune porte son identifiant (« Kanban (a) ») pour qu'on les distingue ? */
    const readAlike = (first: string, second: string) => {
      const labels = labelsOf(first, second);
      return Boolean(labels.a?.endsWith(' (a)') && labels.b?.endsWith(' (b)'));
    };

    it('un caractère invisible au début du titre ne fait pas une autre option', () => {
      const apart: number[] = [];
      someCodePoints((code, char) => {
        // Un titre fait de ce seul caractère n'en est pas un (l'Epic se lit par son identifiant) : on y met toujours « Kanban ».
        if (readAlike(`${char}Kanban`, 'Kanban') !== isInvisibleText(char)) apart.push(code);
      });

      expect(asRanges(apart)).toEqual([]);
    });

    it('ni à la fin, sauf un sélecteur de variante qui suit un caractère qu’on voit : il fait corps avec lui', () => {
      const apart: number[] = [];
      someCodePoints((code, char) => {
        const same = isInvisibleText(char) && !VARIATION_SELECTOR.test(char);
        if (readAlike(`Kanban${char}`, 'Kanban') !== same) apart.push(code);
      });

      expect(asRanges(apart)).toEqual([]);
    });
  });

  // Un modèle écrit à la main, caractère par caractère, sans expression régulière : ce qu'il rend pour tous les textes d'au plus cinq éléments pris parmi des lettres, des blancs, des caractères invisibles,
  // un sélecteur de variante et deux signes qui se dessinent, dont « ⚠ » (111 111 textes). Les expressions, qui lisent la classe par des assertions « en avant » et « en arrière », doivent rendre la même chose.
  describe('un modèle écrit caractère par caractère, pour chaque texte d’au plus cinq éléments', () => {
    const without = (text: string) =>
      scan(text)
        .filter((token) => !(token.kind === 'silent' && !token.attached))
        .map((token) => token.char)
        .join('');

    /** Un caractère d'une série de blancs : invisible, et qui n'est pas un sélecteur de variante, que `collapseSpaces` tient pour un caractère comme un autre (il coupe la série, comme sur HEAD). */
    const folding = (token: { char: string; kind: Kind; attached: boolean }) => ignorable(token) && !VARIATION_SELECTOR.test(token.char);

    const collapsed = (text: string) => {
      const tokens = scan(text);
      let out = '';
      for (let at = 0; at < tokens.length; ) {
        const token = tokens[at] as (typeof tokens)[number];
        if (!folding(token)) {
          out += token.char;
          at += 1;
          continue;
        }
        let end = at;
        while (end < tokens.length && folding(tokens[end] as (typeof tokens)[number])) end += 1;
        const series = tokens.slice(at, end);
        // Une seule espace par série de blancs et de caractères invisibles, et aucune au bord du texte ; les caractères invisibles restent à leur place.
        let spaced = at === 0 || end === tokens.length;
        let kept = '';
        for (const { char } of series) {
          if (FOLDED.test(char)) {
            if (!spaced) {
              kept += ' ';
              spaced = true;
            }
            continue;
          }
          kept += char;
        }
        out += kept;
        at = end;
      }
      return out;
    };

    const trimmed = (text: string) => {
      const tokens = scan(text);
      let from = 0;
      let to = tokens.length;
      while (from < to && ignorable(tokens[from] as (typeof tokens)[number])) from += 1;
      while (to > from && ignorable(tokens[to - 1] as (typeof tokens)[number])) to -= 1;
      return tokens
        .slice(from, to)
        .map((token) => token.char)
        .join('');
    };

    it('`withoutInvisible` retire ce que le modèle retire', () => {
      const failures = EVERY.filter((text) => withoutInvisible(text) !== without(text));

      expect(EVERY).toHaveLength(111_111);
      expect(failures.map((text) => JSON.stringify(text))).toEqual([]);
    });

    it('`collapseSpaces` replie ce que le modèle replie', () => {
      const failures = EVERY.filter((text) => collapseSpaces(text) !== collapsed(text));

      expect(failures.map((text) => JSON.stringify(text))).toEqual([]);
    });

    // Rogner les bords puis replier les blancs, ou l'inverse : le même texte (la pastille replie d'abord, comme `collapseSpaces` l'a toujours fait).
    it('la pastille d’Epic montre le texte replié puis rogné de ses bords, que le modèle écrit, dans un ordre comme dans l’autre', () => {
      const failures = EVERY.filter((text) => shortTitle(text) !== trimmed(collapsed(text)) || shortTitle(text) !== collapsed(trimmed(text)));

      expect(failures.map((text) => JSON.stringify(text))).toEqual([]);
    });
  });

  // Un sélecteur de variante n'a d'effet que collé à un caractère qu'on voit (« ⚠ » suivi de U+FE0F est le signe en couleurs) : replier une espace, rogner un bord ou retirer un caractère invisible ne doit ni lui
  // faire prendre un caractère ni le lui retirer. La revue de bdesk-38k.70 (B1) l'a trouvé en défaut : « ⚠ », une espace et U+FE0F en bout de titre, l'espace tombait en bout de texte, le sélecteur se collait au signe noir,
  // et le titre du ticket, le nom de l'Epic et l'option du filtre le montraient en couleurs, quand la pastille le gardait noir. Pour chaque texte d'au plus cinq éléments, chaque sélecteur garde, ou perd avec les
  // bords, le rapport qu'il avait au caractère qui le précède.
  describe('la forme d’un caractère qu’on voit ne change pas : un sélecteur de variante reste collé, ou décollé, comme dans le titre écrit', () => {
    const same = (first: readonly boolean[], second: readonly boolean[]) => JSON.stringify(first) === JSON.stringify(second);
    /** `small` est-elle une suite d'éléments consécutifs de `big` ? Ce que la pastille garde d'un titre : ses sélecteurs du milieu, sans ceux de ses bords. */
    const isSlice = (small: readonly boolean[], big: readonly boolean[]) => {
      for (let from = 0; from + small.length <= big.length; from += 1) if (same(small, big.slice(from, from + small.length))) return true;
      return false;
    };

    it('`collapseSpaces` garde chaque sélecteur, et le même rapport au caractère qui le précède', () => {
      const failures = EVERY.filter((text) => !same(attachments(collapseSpaces(text)), attachments(text)));

      expect(failures.map((text) => JSON.stringify(text))).toEqual([]);
    });

    it('`withoutInvisible` ne garde que les sélecteurs collés à un caractère qu’on voit, et les garde tous', () => {
      const failures = EVERY.filter((text) => !same(attachments(withoutInvisible(text)), attachments(text).filter(Boolean)));

      expect(failures.map((text) => JSON.stringify(text))).toEqual([]);
    });

    it('la pastille d’Epic garde des sélecteurs du milieu du titre, collés ou non comme dans le titre écrit', () => {
      const failures = EVERY.filter((text) => !isSlice(attachments(shortTitle(text)), attachments(text)));

      expect(failures.map((text) => JSON.stringify(text))).toEqual([]);
    });

    /**
     * Pour chaque sélecteur de variante d'un texte, dans l'ordre : un blanc le sépare-t-il de ce qui le précède (le caractère qu'on voit, ou la chaîne de sélecteurs qu'il prolongerait) ? C'est ce qui l'empêche de se coller :
     * à un caractère qu'on voit, au sélecteur d'avant (un deuxième sélecteur mongol dessine une boîte pointillée), à un liant (la lettre change de forme). Rien ne précède un sélecteur en tête de texte : faux.
     */
    const separations = (text: string) => {
      const tokens = scan(text);
      return tokens.flatMap((token, index) => {
        if (!VARIATION_SELECTOR.test(token.char)) return [];
        let from = index;
        while (from > 0 && ignorable(tokens[from - 1] as (typeof tokens)[number])) from -= 1;
        if (from === 0) return [false];
        return [tokens.slice(from, index).some((each) => FOLDED.test(each.char))];
      });
    };

    it('`collapseSpaces` garde chaque sélecteur séparé de ce qui le précède par un blanc, quand le titre écrit l’en séparait : il ne se colle ni à un caractère, ni à une chaîne, ni à un liant', () => {
      const failures = EVERY.filter((text) => !same(separations(collapseSpaces(text)), separations(text)));

      expect(failures.map((text) => JSON.stringify(text))).toEqual([]);
    });

    // Chaque blanc (les blancs d'Unicode, et U+FEFF) et chaque sélecteur de variante : le cas de la revue, à tous les points de code.
    it('`collapseSpaces` laisse une espace entre un sélecteur et ce qui le précède (un signe, une chaîne de sélecteurs, un liant) quand un blanc, quel qu’il soit, l’en séparait, en bout de titre', () => {
      const blanks: string[] = [];
      const selectors: string[] = [];
      everyCodePoint((_code, char) => {
        if (FOLDED.test(char)) blanks.push(char);
        if (VARIATION_SELECTOR.test(char)) selectors.push(char);
      });
      const blanksApart = new Set<number>();
      const selectorsApart = new Set<number>();
      for (const blank of blanks) {
        for (const selector of selectors) {
          // Le cas de B1 (derrière le signe, une fois, deux fois, en tête), puis ceux de B2 : derrière une chaîne de sélecteurs, derrière un liant, devant un liant.
          const written = [
            `Alerte ⚠${blank}${selector}`,
            `Alerte ⚠${blank}${selector}${blank}`,
            `⚠${blank}${blank}${selector}`,
            `Alerte ⚠\ufe0f${blank}${selector}`,
            `Alerte ⚠\u200d${blank}${selector}`,
            `Alerte ⚠${blank}\u200d${selector}`,
          ];
          const expected = [
            `Alerte ⚠ ${selector}`,
            `Alerte ⚠ ${selector}`,
            `⚠ ${selector}`,
            `Alerte ⚠\ufe0f ${selector}`,
            `Alerte ⚠\u200d ${selector}`,
            `Alerte ⚠ \u200d${selector}`,
          ];
          if (written.some((text, index) => collapseSpaces(text) !== expected[index])) {
            blanksApart.add(blank.codePointAt(0) as number);
            selectorsApart.add(selector.codePointAt(0) as number);
          }
        }
      }

      expect(blanks.length).toBeGreaterThan(20);
      expect(selectors).toHaveLength(260);
      expect({ blanks: asRanges([...blanksApart].sort((a, b) => a - b)), selectors: asRanges([...selectorsApart].sort((a, b) => a - b)) }).toEqual({ blanks: [], selectors: [] });
    });
  });

  // Les expressions lisent la classe à chaque position (une assertion « en avant », une assertion « en arrière ») : sur une longue série d'espaces ou de caractères invisibles, rogner les bords par `X+$` essayait
  // chaque position de la série, et la pastille mettait de quelques centaines de millisecondes à plusieurs secondes pour 20 000 caractères, quand HEAD en mettait moins d'une pour des espaces et des remplisseurs hangul
  // (la revue de bdesk-38k.70 ; pour des caractères sans largeur, HEAD avait déjà le défaut). Une base modifiée à la main peut porter un tel titre : le temps croît avec la longueur, il ne croît pas avec son carré.
  // La borne est large (une seconde pour trente mille caractères, quand quelques dizaines de millisecondes suffisent) : la machine chargée la tient, une série qui se parcourt à chaque position ne la tient pas.
  describe('les expressions restent linéaires sur une longue série de blancs et de caractères invisibles', () => {
    const LENGTH = 30_000;
    const LIMIT_MS = 1_000;
    const SIGN = '⚠';
    const inputs: readonly (readonly [string, string])[] = [
      ['des espaces', `a${' '.repeat(LENGTH)}b`],
      ['des remplisseurs hangul', `a${'\u3164'.repeat(LENGTH)}b`],
      ['des espaces sans largeur', `a${'\u200b'.repeat(LENGTH)}b`],
      ['des remplisseurs hangul aux deux bords du titre', `${'\u3164'.repeat(LENGTH)}Kanban${'\u3164'.repeat(LENGTH)}`],
      ['des espaces et des remplisseurs qui alternent', `Kanban${' \u3164'.repeat(LENGTH / 2)}`],
      ['des espaces et des sélecteurs de variante qui alternent', `Kanban${' \ufe0f'.repeat(LENGTH / 2)}`],
      ['une longue série d’espaces devant un sélecteur de variante', `Alerte ${SIGN}${' '.repeat(LENGTH)}\ufe0f`],
      ['une longue série de sélecteurs de variante', `Alerte ${SIGN}${'\ufe0f'.repeat(LENGTH)}`],
      ['une longue série d’espaces et de sélecteurs de variante qui finit la tête avant le séparateur', `Alerte ${SIGN}${' \ufe0f'.repeat(LENGTH / 2)} : suite du titre`],
      ['une longue série d’espaces et de sélecteurs de variante, puis du texte, avant le séparateur', `Alerte ${SIGN}${' \ufe0f'.repeat(LENGTH / 2)}x : suite du titre`],
    ];

    it.each(inputs)('sur %s', (_kind, title) => {
      const labels = () => epicLabels([issue({ id: 'a', title, type: 'epic' }), issue({ id: 'b', title: 'Kanban', type: 'epic' })]);
      const runs: readonly (readonly [string, () => unknown])[] = [
        ['shortTitle', () => shortTitle(title)],
        ['collapseSpaces', () => collapseSpaces(title)],
        ['withoutInvisible', () => withoutInvisible(title)],
        ['epicLabels', labels],
      ];
      const slow = runs
        .map(([name, run]) => {
          const started = performance.now();
          run();
          return [name, Math.round(performance.now() - started)] as const;
        })
        .filter(([, milliseconds]) => milliseconds > LIMIT_MS);

      expect(slow).toEqual([]);
    });
  });
});
