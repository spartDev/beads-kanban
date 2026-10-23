import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { THEME_PREFERENCES, type ThemePreference } from './theme';

/** Libellé et pictogramme de chaque préférence ; le `Record` oblige à décrire toute préférence ajoutée. */
const META: Record<ThemePreference, { label: string; icon: LucideIcon }> = {
  system: { label: 'Thème du système', icon: Monitor },
  light: { label: 'Thème clair', icon: Sun },
  dark: { label: 'Thème sombre', icon: Moon },
};

/** Les thèmes proposés, dans l'ordre de THEME_PREFERENCES : une seule liste pour la bascule et la palette. */
export const THEME_OPTIONS = THEME_PREFERENCES.map((value) => ({ value, ...META[value] }));
