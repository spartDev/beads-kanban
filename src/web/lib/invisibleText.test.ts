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
  it('dit invisibles les blancs d’Unicode, les caractères ignorables par défaut et le blanc braille, et aucun autre point de code', () => {
    const LINE = /^[\p{White_Space}\p{Default_Ignorable_Code_Point}\u2800]*$/u;
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

  it('ne dit invisible que ce qui l’est de bout en bout : un seul caractère visible, où qu’il soit, suffit', () => {
    for (const text of ['a\u200b', '\u200ba', ' \u200b a \u2060 ', '\ufeff-', ':\u00ad']) expect(isInvisibleText(text), JSON.stringify(text)).toBe(false);
  });
});
