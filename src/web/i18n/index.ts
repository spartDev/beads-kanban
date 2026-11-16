/** L'internationalisation de l'interface (ADR 0006). Ajouter un texte : voir `catalog/index.ts`. */
export { CATALOGS, type Messages } from './catalog';
export { FORMATS_BY_LANGUAGE, type DisplayFormat } from './format';
export {
  FALLBACK_LANGUAGE,
  LANGUAGE_PREFERENCES,
  LANGUAGE_SWITCH_ENABLED,
  LANGUAGES,
  type Language,
  type LanguagePreference,
} from './language';
export { LanguageProvider, useFormat, useLanguage, useT } from './LanguageProvider';
export { LANGUAGE_NAMES, languageOptions } from './options';
