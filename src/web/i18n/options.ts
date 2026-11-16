import { Globe, type LucideIcon } from 'lucide-react';
import type { Messages } from './catalog';
import { LANGUAGE_PREFERENCES, type Language, type LanguagePreference } from './language';

/** Le nom de chaque langue, écrit dans cette langue : on reconnaît la sienne quelle que soit celle affichée. */
export const LANGUAGE_NAMES: Record<Language, string> = { fr: 'Français', en: 'English' };

/** Ce qu'affiche un bouton du sélecteur : un pictogramme pour « navigateur », le code de la langue sinon. */
export type LanguageMark = { icon: LucideIcon } | { code: string };

export interface LanguageOption {
  value: LanguagePreference;
  /** Le libellé (nom accessible, infobulle, ligne de la palette). */
  label: string;
  /** La langue du libellé (`lang` du bouton), pour un nom de langue : « English » est dit en anglais même sur une page française. */
  labelLanguage: Language | undefined;
  mark: LanguageMark;
}

/** Les positions du sélecteur, dans l'ordre de LANGUAGE_PREFERENCES : une seule liste pour la bascule et la palette. */
export function languageOptions(t: Messages): LanguageOption[] {
  return LANGUAGE_PREFERENCES.map((value) =>
    value === 'system'
      ? { value, label: t.shell.language.system, labelLanguage: undefined, mark: { icon: Globe } }
      : { value, label: LANGUAGE_NAMES[value], labelLanguage: value, mark: { code: value.toUpperCase() } },
  );
}
