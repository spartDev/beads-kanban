import { CATALOGS } from '../i18n/catalog';
import type { Language } from '../i18n/language';

type NavigatorInfo = Pick<Navigator, 'platform' | 'userAgent'> & {
  userAgentData?: { platform?: string };
};

/** macOS et iOS : ⌘ sert de touche de commande ; ailleurs, c'est Ctrl. */
export function isMacPlatform(nav: NavigatorInfo = navigator): boolean {
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Le nom écrit des touches : un signe, ou un mot de la langue (`t.shell.keys`). */
const keyLabels = (language: Language): Record<string, string> => {
  const { keys } = CATALOGS[language].shell;
  return {
    enter: '↵',
    escape: keys.escape,
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
    space: keys.space,
    tab: keys.tab,
    backspace: '⌫',
  };
};

/**
 * Décompose un raccourci (`mod+k`, `g k`, `?`) en touches à afficher.
 * Une séquence (`g k`) donne une touche par étape.
 */
export function keyCaps(keys: string, mac: boolean, language: Language = 'fr'): string[] {
  const labels = keyLabels(language);
  return keys
    .split(' ')
    .flatMap((step) => step.split('+'))
    .map((token) => {
      switch (token) {
        case 'mod':
          return mac ? '⌘' : 'Ctrl';
        case 'ctrl':
          return mac ? '⌃' : 'Ctrl';
        case 'alt':
          return mac ? '⌥' : 'Alt';
        case 'shift':
          return mac ? '⇧' : CATALOGS[language].shell.keys.shift;
        default:
          return labels[token] ?? token.toUpperCase();
      }
    });
}
