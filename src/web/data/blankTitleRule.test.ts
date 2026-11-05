import { describe, expect, it } from 'vitest';
import { isInvisibleText } from '../lib/invisibleText';
import { INVISIBLE_TEXTS, VISIBLE_TEXTS } from '../test/invisibleTexts';
import { isBlankTitle, ticketTitle } from './helpers';

/**
 * Un titre de ticket est vide quand on n'en verrait rien, et la règle est celle des textes invisibles (bdesk-38k.65) : une seule, écrite dans `lib/invisibleText`, que `isBlankTitle` appelle. Elle s'écrivait
 * deux fois (`/^[\s\p{Cf}]*$/u`, dans `isBlankTitle` et dans `isInvisibleText`) : deux copies qu'on corrige l'une sans l'autre, et un titre fait d'un remplisseur hangul (U+3164) resterait un titre pour
 * l'une et pas pour l'autre. Ce test les tient accordées : sur les tables écrites à la main, puis sur chaque point de code.
 */
describe('un titre de ticket est blanc quand on n’en verrait rien : la règle des textes invisibles', () => {
  it.each(INVISIBLE_TEXTS)('un titre %s est blanc, et s’écrit « Sans titre »', (_kind, title) => {
    expect(isBlankTitle(title)).toBe(true);
    expect(ticketTitle({ title })).toBe('Sans titre');
  });

  it.each(VISIBLE_TEXTS)('%s n’est pas blanc', (_kind, title) => {
    expect(isBlankTitle(title)).toBe(false);
  });

  it('dit blanc un titre sur les mêmes points de code que `isInvisibleText`, sans en excepter un seul', () => {
    // Les deux règles ont la forme « tout caractère est dans l'ensemble » : elles s'accordent sur un texte quand elles s'accordent sur chacun de ses caractères.
    const apart: string[] = [];
    for (let code = 0; code <= 0x10ffff; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue; // les demi-codets ne sont pas des caractères
      const char = String.fromCodePoint(code);
      if (isBlankTitle(char) !== isInvisibleText(char)) apart.push(`U+${code.toString(16).toUpperCase().padStart(4, '0')}`);
    }
    expect(apart).toEqual([]);
  });
});
