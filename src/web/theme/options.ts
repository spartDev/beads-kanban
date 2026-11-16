import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import type { Messages } from '../i18n';
import { THEME_PREFERENCES, type ThemePreference } from './theme';

/** Pictogramme de chaque préférence ; le `Record` oblige à décrire toute préférence ajoutée. Le libellé est celui du catalogue (`t.shell.theme`). */
const ICONS: Record<ThemePreference, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

export interface ThemeOption {
  value: ThemePreference;
  label: string;
  icon: LucideIcon;
}

/** Les thèmes proposés, dans l'ordre de THEME_PREFERENCES et dans la langue affichée : une seule liste pour la bascule et la palette. */
export const themeOptions = (t: Messages): ThemeOption[] =>
  THEME_PREFERENCES.map((value) => ({ value, label: t.shell.theme[value], icon: ICONS[value] }));
