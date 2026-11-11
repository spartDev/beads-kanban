import { describe, expect, it } from 'vitest';
import { INVISIBLE_TEXTS, VISIBLE_TEXTS } from '../test/invisibleTexts';
import { isInvisibleText } from './invisibleText';

/**
 * Un texte qu'on ne voit pas (bdesk-38k.61, revue ; bdesk-38k.65) : de quoi décider qu'un titre n'en est pas un. C'est aussi la règle des titres de ticket (`isBlankTitle`, dans `data/helpers.ts`, qui l'appelle :
 * voir `data/blankTitleRule.test.ts`) : seulement ce que l'œil ne lit pas. Une ponctuation se voit, et c'est ce que l'auteur a écrit. Les tables `INVISIBLE_TEXTS` et `VISIBLE_TEXTS` disent la règle une ligne à la fois,
 * écrite à la main : aucune ne la dérive de la règle qu'elle éprouve.
 */
describe('isInvisibleText', () => {
  it.each(INVISIBLE_TEXTS)('un texte %s est invisible', (_kind, text) => {
    expect(isInvisibleText(text)).toBe(true);
  });

  it.each(VISIBLE_TEXTS)('%s n’est pas invisible', (_kind, text) => {
    expect(isInvisibleText(text)).toBe(false);
  });

  // La règle est composée (blancs, puis caractères qu'on ne voit pas sans être des blancs) pour que les expressions qui rognent, mesurent et comparent les titres la prennent d'ici (bdesk-38k.70) : composée,
  // elle doit dire ce que la règle d'une ligne disait. Chaque point de code est lu contre cette ligne, écrite ici à la main et non importée du code qu'elle éprouve.
  it('dit invisibles les blancs d’Unicode, les caractères ignorables par défaut, le blanc braille et les ancres d’annotation, et aucun autre point de code', () => {
    const LINE = /^[\p{White_Space}\p{Default_Ignorable_Code_Point}\u2800\ufff9-\ufffb]*$/u;
    const apart: string[] = [];
    for (let code = 0; code <= 0x10ffff; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      const char = String.fromCodePoint(code);
      if (isInvisibleText(char) !== LINE.test(char)) apart.push(`U+${code.toString(16).toUpperCase().padStart(4, '0')}`);
    }

    expect(apart).toEqual([]);
  });

  it('ne tient pour blanche que la cellule braille sans point (U+2800) : les 255 autres du bloc ont des points, et se voient', () => {
    for (let code = 0x2801; code <= 0x28ff; code++) expect(isInvisibleText(String.fromCodePoint(code)), `U+${code.toString(16)}`).toBe(false);
  });

  it('tient pour visibles les signes de mise en forme que les polices dessinent, que la catégorie `Cf` disait invisibles', () => {
    // Ceux que l'écriture arabe (U+0600 à U+0605, U+06DD, U+0890, U+0891, U+08E2), syriaque (U+070F) et kaithi (U+110BD, U+110CD) pose devant un nombre ou un mot : Unicode les nomme `Prepended_Concatenation_Mark`.
    const drawn = ['\u0600', '\u0601', '\u0602', '\u0603', '\u0604', '\u0605', '\u06dd', '\u070f', '\u0890', '\u0891', '\u08e2', '\u{110bd}', '\u{110cd}'];
    for (const text of drawn) expect(isInvisibleText(text), `U+${text.codePointAt(0)?.toString(16)}`).toBe(false);
  });

  // Les ancres d'annotation (U+FFF9 à U+FFFB) sont `Cf` sans être `Default_Ignorable_Code_Point` : la règle, bâtie sur cette propriété, les gardait comme des signes qui se dessinent (bdesk-38k.77). Chromium 156 ne
  // dessine aucun pixel pour eux, dans le canvas comme dans le DOM de l'application, à la graisse 400 comme à 500, 600 et 700, et leur donne 7,19 px de large dans une pastille d'Epic (text-xs) : un retrait vide.
  // La catégorie `Cf` les disait invisibles, comme la pastille d'avant bdesk-38k.70 : ce sont les trois seuls points de code `Cf` que la règle laissait voir sans que Chromium les dessine.
  it.each([
    ['l’ancre d’annotation', '\ufff9'],
    ['le séparateur d’annotation', '\ufffa'],
    ['le terminateur d’annotation', '\ufffb'],
  ])('dit invisible %s, seul comme parmi des blancs et des caractères sans largeur', (_kind, anchor) => {
    expect(isInvisibleText(anchor)).toBe(true);
    expect(isInvisibleText(`${anchor}${anchor}`)).toBe(true);
    expect(isInvisibleText(` \u200b${anchor}\u2800 `)).toBe(true);
    expect(isInvisibleText(`${anchor}Kanban`)).toBe(false);
    expect(isInvisibleText(`Kanban${anchor}`)).toBe(false);
  });

  // Ce que Chromium ne dessine pas non plus (bdesk-38k.77, mesuré comme bdesk-38k.65 : 488 points de code attribués sans un pixel) et que la règle ne dit pas invisible : 61 points de code. Ils restent hors de la règle,
  // par décision. Les caractères de contrôle (U+0000 à U+0008, U+000E à U+001F, U+007F, U+0081 à U+0084, U+0086 à U+009F) sont à dessiner pour CSS Text, qui veut une glyphe synthétisée à défaut ; U+0080, de la même
  // catégorie, se dessine dans Chromium : `\p{Cc}` n'est pas un ensemble sans encre, et la liste exacte est celle d'une police. U+F860 et U+F861 sont des points de code d'usage privé que seule la police de cette machine
  // laisse blancs. U+FFFC est un symbole (`So`) sans largeur dans Chromium : aucun retrait à corriger. Aucun n'était retiré avant bdesk-38k.70 : les garder, c'est ne rien changer.
  it('laisse hors de la règle les 61 autres points de code que Chromium ne dessine pas : les contrôles, U+F860 et U+F861, U+FFFC', () => {
    const noInk: number[] = [];
    const range = (from: number, to: number) => {
      for (let code = from; code <= to; code++) noInk.push(code);
    };
    range(0x0000, 0x0008);
    range(0x000e, 0x001f);
    range(0x007f, 0x007f);
    range(0x0081, 0x0084);
    range(0x0086, 0x009f);
    range(0xf860, 0xf861);
    range(0xfffc, 0xfffc);

    expect(noInk).toHaveLength(61);
    expect(noInk.filter((code) => isInvisibleText(String.fromCodePoint(code))).map((code) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`)).toEqual([]);
  });
  it('ne dit invisible que ce qui l’est de bout en bout : un seul caractère visible, où qu’il soit, suffit', () => {
    for (const text of ['a\u200b', '\u200ba', ' \u200b a \u2060 ', '\ufeff-', ':\u00ad']) expect(isInvisibleText(text), JSON.stringify(text)).toBe(false);
  });
});
