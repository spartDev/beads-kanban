import { describe, expect, it } from 'vitest';
import { INVISIBLE_TEXTS, VISIBLE_TEXTS } from '../test/invisibleTexts';
import { isInvisibleText } from './invisibleText';

/**
 * Un texte qu'on ne voit pas (bdesk-38k.61, revue) : de quoi décider qu'un titre n'en est pas un. C'est aussi la règle des titres de ticket (`isBlankTitle`, dans `data/helpers.ts`, écrite là de son
 * côté) : seulement ce que l'œil ne lit pas. Une ponctuation se voit, et c'est ce que l'auteur a écrit.
 */
describe('isInvisibleText', () => {
  it.each(INVISIBLE_TEXTS)('un texte %s est invisible', (_kind, text) => {
    expect(isInvisibleText(text)).toBe(true);
  });

  it.each(VISIBLE_TEXTS)('%s n’est pas invisible', (_kind, text) => {
    expect(isInvisibleText(text)).toBe(false);
  });

  it('ne dit invisible que ce qui l’est de bout en bout : un seul caractère visible, où qu’il soit, suffit', () => {
    for (const text of ['a\u200b', '\u200ba', ' \u200b a \u2060 ', '\ufeff-', ':\u00ad']) expect(isInvisibleText(text), JSON.stringify(text)).toBe(false);
  });
});
