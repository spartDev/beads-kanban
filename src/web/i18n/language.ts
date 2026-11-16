import { readStorage, writeStorage } from '../lib/storage';

/**
 * Les langues de l'interface (ADR 0006). Ajouter une langue : l'ajouter ici, écrire son objet dans chaque module de `catalog/`
 * et ses formateurs (`metrics/format.ts`, `lib/relativeTime.ts`) ; le compilateur dit ce qui manque. Le script de `index.html`
 * répète cette liste : un test les compare.
 */
export const LANGUAGES = ['fr', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Le choix de l'utilisateur : suivre la langue du navigateur, ou en forcer une. */
export type LanguagePreference = 'system' | Language;
export const LANGUAGE_PREFERENCES: readonly LanguagePreference[] = ['system', ...LANGUAGES];

/**
 * Tant qu'il est faux, l'interface est forcée en français et le sélecteur de langue caché : les zones se traduisent une à une
 * (bdesk-ewr.2 à .6), et l'activation (bdesk-ewr.7) passe ce drapeau à vrai, ici et dans le script de `index.html` (un test vérifie
 * qu'ils sont d'accord). Les tests de la détection et du sélecteur passent outre par `<LanguageProvider switchEnabled>`.
 */
export const LANGUAGE_SWITCH_ENABLED = false;

/** La langue quand le navigateur n'en donne aucune que l'interface connaisse. */
export const FALLBACK_LANGUAGE: Language = 'en';

/** Même clé que le script de index.html, qui pose `<html lang>` avant le premier rendu. */
export const LANGUAGE_STORAGE_KEY = 'beads-desktop:language';

const isLanguage = (value: unknown): value is Language => (LANGUAGES as readonly unknown[]).includes(value);

export function parseLanguagePreference(value: unknown): LanguagePreference {
  return isLanguage(value) ? value : 'system';
}

/**
 * La première langue du navigateur que l'interface connaît, d'après sa sous-étiquette principale (« fr-CA » est du français),
 * l'anglais à défaut. Les langues viennent de `navigator.languages`, ou de `navigator.language` quand la liste est vide.
 */
export function detectLanguage(languages: readonly (string | null | undefined)[]): Language {
  for (const tag of languages) {
    const primary = String(tag ?? '').toLowerCase().split('-')[0];
    if (isLanguage(primary)) return primary;
  }
  return FALLBACK_LANGUAGE;
}

/** Les langues préférées du navigateur, telles que `detectLanguage` les lit. */
export function browserLanguages(nav: Pick<Navigator, 'languages' | 'language'> = navigator): readonly string[] {
  return nav.languages && nav.languages.length > 0 ? nav.languages : [nav.language];
}

/** La langue affichée : le choix forcé, sinon celle du navigateur ; le français tant que le sélecteur n'est pas activé. */
export function resolveLanguage(preference: LanguagePreference, detected: Language, switchEnabled: boolean): Language {
  if (!switchEnabled) return 'fr';
  return preference === 'system' ? detected : preference;
}

export const readLanguagePreference = (): LanguagePreference =>
  parseLanguagePreference(readStorage(LANGUAGE_STORAGE_KEY));

export const writeLanguagePreference = (preference: LanguagePreference): void =>
  writeStorage(LANGUAGE_STORAGE_KEY, preference);

/** Pose la langue sur `<html lang>` : lecteurs d'écran, césure et correcteur la lisent. */
export function applyLanguage(language: Language, root: HTMLElement = document.documentElement): void {
  root.lang = language;
}
