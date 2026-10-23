import { readStorage, writeStorage } from '../lib/storage';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

/** Même clé que le script de index.html, qui pose le thème avant le premier rendu. */
export const THEME_STORAGE_KEY = 'beads-desktop:theme';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

/** Couleur de la barre du navigateur mobile (`<meta name="theme-color">`). Le script de index.html en répète les valeurs : un test les compare. */
export const THEME_COLOR: Record<ResolvedTheme, string> = { light: '#f3f4f6', dark: '#0f1114' };

export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

export const readThemePreference = (): ThemePreference =>
  parseThemePreference(readStorage(THEME_STORAGE_KEY));

export const writeThemePreference = (preference: ThemePreference): void =>
  writeStorage(THEME_STORAGE_KEY, preference);

/** Pose le thème résolu sur <html> (les tokens de styles.css en dépendent). */
export function applyTheme(theme: ResolvedTheme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme;
  root.ownerDocument
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[theme]);
}
