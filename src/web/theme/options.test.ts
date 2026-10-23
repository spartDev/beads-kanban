import { describe, expect, it } from 'vitest';
import { THEME_OPTIONS } from './options';
import { THEME_PREFERENCES } from './theme';

describe('THEME_OPTIONS : la liste des thèmes, partagée par la bascule et la palette', () => {
  it('décrit chaque préférence de THEME_PREFERENCES, dans le même ordre', () => {
    expect(THEME_OPTIONS.map((option) => option.value)).toEqual([...THEME_PREFERENCES]);
  });

  it('donne à chacune un libellé distinct et un pictogramme', () => {
    const labels = THEME_OPTIONS.map((option) => option.label);

    expect(labels).toEqual(['Thème du système', 'Thème clair', 'Thème sombre']);
    expect(new Set(labels).size).toBe(THEME_OPTIONS.length);
    for (const option of THEME_OPTIONS) expect(option.icon).toBeTruthy();
  });
});
