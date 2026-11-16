import { describe, expect, it } from 'vitest';
import { CATALOGS } from '../i18n';
import { themeOptions } from './options';
import { THEME_PREFERENCES } from './theme';

describe('themeOptions : la liste des thèmes, partagée par la bascule et la palette', () => {
  it('décrit chaque préférence de THEME_PREFERENCES, dans le même ordre', () => {
    expect(themeOptions(CATALOGS.fr).map((option) => option.value)).toEqual([...THEME_PREFERENCES]);
  });

  it('donne à chacune un libellé distinct et un pictogramme', () => {
    const options = themeOptions(CATALOGS.fr);
    const labels = options.map((option) => option.label);

    expect(labels).toEqual(['Thème du système', 'Thème clair', 'Thème sombre']);
    expect(new Set(labels).size).toBe(options.length);
    for (const option of options) expect(option.icon).toBeTruthy();
  });

  it('écrit les libellés dans la langue affichée', () => {
    expect(themeOptions(CATALOGS.en).map((option) => option.label)).toEqual(['System theme', 'Light theme', 'Dark theme']);
  });
});
