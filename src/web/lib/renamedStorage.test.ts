import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LANGUAGE_STORAGE_KEY } from '../i18n/language';
import { LAST_PROJECT_KEY } from '../shell/navigation';
import { installMatchMedia } from '../test/matchMedia';
import { THEME_STORAGE_KEY } from '../theme/theme';

/**
 * Le script en ligne de index.html reprend les préférences enregistrées sous l'ancien nom de l'application (bdesk-1xz), avant
 * que le thème et la langue ne soient posés : un thème sombre choisi avant le renommage ne laisse pas d'éclair clair.
 */
const source = readFileSync(join(import.meta.dirname, '../index.html'), 'utf8');
const script = /<script>([\s\S]*?)<\/script>/.exec(source)?.[1] ?? '';

const PREFIX = 'throughline:';
const LEGACY_PREFIX = 'beads-desktop:';
const APP_KEYS = [THEME_STORAGE_KEY, LANGUAGE_STORAGE_KEY, LAST_PROJECT_KEY];
const legacyOf = (key: string) => LEGACY_PREFIX + key.slice(PREFIX.length);

function runScript(entries: Record<string, string>, systemDark = false): void {
  installMatchMedia(systemDark);
  window.localStorage.clear();
  for (const [key, value] of Object.entries(entries)) window.localStorage.setItem(key, value);
  document.documentElement.removeAttribute('data-theme');
  new Function(script)();
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('script de index.html (préférences d’avant le renommage)', () => {
  it('connaît toutes les clés de l’application, qui portent le nouveau nom', () => {
    for (const key of APP_KEYS) expect(key.startsWith(PREFIX), key).toBe(true);
    expect(script).toContain(`var names = [${APP_KEYS.map((key) => `'${key.slice(PREFIX.length)}'`).join(', ')}];`);
  });

  it('reprend chaque préférence enregistrée sous l’ancien nom, puis l’efface', () => {
    runScript(Object.fromEntries(APP_KEYS.map((key, i) => [legacyOf(key), `valeur-${i}`])));

    APP_KEYS.forEach((key, i) => {
      expect(window.localStorage.getItem(key), key).toBe(`valeur-${i}`);
      expect(window.localStorage.getItem(legacyOf(key)), legacyOf(key)).toBeNull();
    });
  });

  it('garde la préférence déjà enregistrée sous le nouveau nom', () => {
    runScript({ [legacyOf(THEME_STORAGE_KEY)]: 'dark', [THEME_STORAGE_KEY]: 'light' });

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(window.localStorage.getItem(legacyOf(THEME_STORAGE_KEY))).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('pose dès le premier rendu le thème repris', () => {
    runScript({ [legacyOf(THEME_STORAGE_KEY)]: 'dark' }, false);

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('ne touche pas aux clés qu’il ne connaît pas', () => {
    runScript({ [`${LEGACY_PREFIX}autre`]: 'x' });

    expect(window.localStorage.getItem(`${LEGACY_PREFIX}autre`)).toBe('x');
    expect(window.localStorage.getItem(`${PREFIX}autre`)).toBeNull();
  });

  it('n’échoue pas quand le stockage est inaccessible', () => {
    installMatchMedia(true);
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('Accès refusé', 'SecurityError');
    });
    document.documentElement.removeAttribute('data-theme');

    new Function(script)();

    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
