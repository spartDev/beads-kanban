type NavigatorInfo = Pick<Navigator, 'platform' | 'userAgent'> & {
  userAgentData?: { platform?: string };
};

/** macOS et iOS : ⌘ sert de touche de commande ; ailleurs, c'est Ctrl. */
export function isMacPlatform(nav: NavigatorInfo = navigator): boolean {
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

const KEY_LABELS: Record<string, string> = {
  enter: '↵',
  escape: 'Échap',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  space: 'Espace',
  tab: 'Tab',
  backspace: '⌫',
};

/**
 * Décompose un raccourci (`mod+k`, `g k`, `?`) en touches à afficher.
 * Une séquence (`g k`) donne une touche par étape.
 */
export function keyCaps(keys: string, mac: boolean): string[] {
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
          return mac ? '⇧' : 'Maj';
        default:
          return KEY_LABELS[token] ?? token.toUpperCase();
      }
    });
}
