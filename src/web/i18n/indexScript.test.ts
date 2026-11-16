import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setBrowserLanguages } from '../test/languages';
import {
  browserLanguages,
  detectLanguage,
  LANGUAGE_STORAGE_KEY,
  LANGUAGE_SWITCH_ENABLED,
  LANGUAGES,
  parseLanguagePreference,
  resolveLanguage,
} from './language';

/** Le script en ligne de index.html pose `<html lang>` avant le premier rendu : même clé, même drapeau, même règle que `language.ts`. */
const source = readFileSync(join(import.meta.dirname, '../index.html'), 'utf8');
const script = /<script>([\s\S]*?)<\/script>/.exec(source)?.[1] ?? '';
const FLAG = /var LANGUAGE_SWITCH_ENABLED = (true|false);/;

/** Le script, le drapeau levé ou baissé : la règle se vérifie dès aujourd'hui, avant l'activation. */
const withFlag = (enabled: boolean) => script.replace(FLAG, `var LANGUAGE_SWITCH_ENABLED = ${enabled};`);

function runScript(code: string, languages: string[], stored?: string, language?: string): string {
  setBrowserLanguages(languages, { language });
  window.localStorage.clear();
  if (stored !== undefined) window.localStorage.setItem(LANGUAGE_STORAGE_KEY, stored);
  document.documentElement.lang = 'xx';
  new Function(code)();
  return document.documentElement.lang;
}

// Chaque langue de l'application, sous plusieurs formes, et des langues qu'elle ne connaît pas : une langue ajoutée à `LANGUAGES` sans
// l'être au script fait échouer le test.
const BROWSERS = [
  ...LANGUAGES.flatMap((code) => [[code], [`${code.toUpperCase()}-XX`], ['de-DE', `${code}-YY`]]),
  ['fr-FR', 'en'],
  ['en-US', 'fr'],
  ['de-DE', 'es'],
  ['zz'],
  // Une sous-étiquette principale, pas deux lettres : « frr » et « eng » ne sont pas « fr » et « en », ni « fr_FR » une étiquette valide.
  ['frr-DE'],
  ['eng'],
  ['fr_FR'],
  ['french', 'english'],
  [],
];
const STORED = [undefined, 'system', ...LANGUAGES, 'de', 'FR', 'n’importe quoi'];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('script de index.html (langue posée avant le premier rendu)', () => {
  it('a le même drapeau que l’application', () => {
    expect(FLAG.exec(script)?.[1]).toBe(String(LANGUAGE_SWITCH_ENABLED));
  });

  it('utilise la même clé de stockage que l’application', () => {
    expect(script).toContain(`'${LANGUAGE_STORAGE_KEY}'`);
  });

  for (const enabled of [true, false]) {
    it(`applique la même règle que resolveLanguage, sélecteur ${enabled ? 'activé' : 'désactivé'}`, () => {
      for (const languages of BROWSERS) {
        for (const stored of STORED) {
          // jsdom : `navigator.language` vaut la première langue de la liste, '' pour une liste vide.
          const detected = detectLanguage(browserLanguages({ languages, language: languages[0] ?? '' }));
          const expected = resolveLanguage(parseLanguagePreference(stored ?? null), detected, enabled);
          expect(runScript(withFlag(enabled), languages, stored), `navigateur=${languages.join(',')}, mémorisé=${stored}`).toBe(expected);
        }
      }
    });
  }

  it('tel qu’il est livré, pose la langue que l’application affichera', () => {
    const expected = resolveLanguage(parseLanguagePreference('en'), 'en', LANGUAGE_SWITCH_ENABLED);
    expect(runScript(script, ['en-US'], 'en')).toBe(expected);
  });

  it('lit navigator.language quand navigator.languages est vide, comme browserLanguages', () => {
    expect(runScript(withFlag(true), [], undefined, 'fr-FR')).toBe('fr');
    expect(detectLanguage(browserLanguages({ languages: [], language: 'fr-FR' }))).toBe('fr');
    expect(runScript(withFlag(true), [], undefined, 'de-DE')).toBe('en');
  });

  it('retombe sur le navigateur quand le stockage est inaccessible', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('Accès refusé', 'SecurityError');
    });
    setBrowserLanguages(['fr-CH']);
    document.documentElement.lang = 'xx';

    new Function(withFlag(true))();

    expect(document.documentElement.lang).toBe('fr');
  });

  it('déclare <html lang="fr"> dans le HTML même, avant tout script', () => {
    expect(source).toMatch(/<html lang="fr">/);
  });
});
