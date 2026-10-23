import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio, over, parseOklch, toSrgb, type Oklch, type Rgb } from '../test/color';

/**
 * Lisibilité des thèmes : chaque texte du design atteint le seuil WCAG AA (4,5:1) sur chacune des surfaces où il
 * s'affiche, en clair comme en sombre. Les tokens sont lus dans styles.css : changer une couleur sans vérifier
 * son contraste fait échouer ce test, avec la liste des paires fautives.
 */

const MIN_RATIO = 4.5;
const css = readFileSync(join(import.meta.dirname, '../styles.css'), 'utf8');

/** Contenu du bloc CSS qui s'ouvre par `opening`. */
function blockOf(source: string, opening: string): string {
  const start = source.indexOf(opening);
  if (start < 0) throw new Error(`Bloc « ${opening} » introuvable dans styles.css`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`Bloc « ${opening} » jamais refermé`);
}

type Tokens = Record<string, Oklch>;

const colorTokens = (block: string): Tokens =>
  Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(oklch\([^)]*\))/g)].map(([, name, value]) => [name, parseOklch(value as string)]));

const numberTokens = (block: string): Record<string, number> =>
  Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([\d.]+);/g)].map(([, name, value]) => [name, Number(value)]));

const lightBlock = blockOf(css, ':root {');
const darkBlock = blockOf(css, ":root[data-theme='dark'] {");
const THEMES = [
  { name: 'clair', tokens: colorTokens(lightBlock), numbers: numberTokens(lightBlock) },
  // Le thème sombre ne redéfinit que ce qui change : le reste vient du clair.
  {
    name: 'sombre',
    tokens: { ...colorTokens(lightBlock), ...colorTokens(darkBlock) },
    numbers: { ...numberTokens(lightBlock), ...numberTokens(darkBlock) },
  },
];

/** Un fond : des calques posés du plus profond au plus haut ; chaque calque est un token, avec son opacité propre. */
type Layer = string | readonly [token: string, alpha: number];

function surface(tokens: Tokens, layers: readonly Layer[]): Rgb {
  let rgb: Rgb | undefined;
  for (const layer of layers) {
    const [name, alpha] = typeof layer === 'string' ? [layer, undefined] : layer;
    const color = tokens[name];
    if (!color) throw new Error(`Token --${name} introuvable`);
    rgb = rgb ? over(color, rgb, alpha) : toSrgb(color);
  }
  if (!rgb) throw new Error('Fond sans calque');
  return rgb;
}

/**
 * Les fonds sur lesquels du texte se pose. `hover` et `press` sont des voiles translucides : ligne survolée,
 * ligne courante ou sélectionnée. Une touche (`.kbd`) pose encore son propre voile `hover` par-dessus.
 */
const BASES = ['canvas', 'panel', 'float', 'well'] as const;
const SURFACES: Record<string, readonly Layer[]> = {
  'panel + danger-soft': ['panel', 'danger-soft'],
  'panel + accent-soft': ['panel', 'accent-soft'],
  'well + accent-soft': ['well', 'accent-soft'],
  // Barre d'onglets du mobile : le fond de l'app à 90 %, sur le contenu de la page.
  'barre d’onglets': ['panel', ['canvas', 0.9]],
};
for (const base of BASES) {
  SURFACES[base] = [base];
  SURFACES[`${base} + hover`] = [base, 'hover'];
  SURFACES[`${base} + press`] = [base, 'press'];
  SURFACES[`${base} + hover + hover`] = [base, 'hover', 'hover'];
  SURFACES[`${base} + press + hover`] = [base, 'press', 'hover'];
}
const ALL_SURFACES = Object.keys(SURFACES);

// Le texte des touches de clavier (`.kbd`) : le token vient de styles.css, pas d'ici.
const kbdToken = /\.kbd\s*\{[^}]*\n\s*color:\s*var\(--([\w-]+)\)/.exec(css)?.[1];

interface TextRole {
  /** Token de la couleur du texte. */
  token: string;
  surfaces: readonly string[];
  usage: string;
}

const TEXT_ROLES: readonly TextRole[] = [
  { token: 'ink', surfaces: ALL_SURFACES, usage: 'titres, texte courant' },
  {
    token: 'ink-2',
    surfaces: ALL_SURFACES,
    usage: 'texte secondaire ; ids, indices et titres fermés des lignes sélectionnées de la palette (float + press)',
  },
  {
    token: 'ink-3',
    surfaces: [
      'canvas', // barre latérale : intertitres, préfixes, aide
      'canvas + hover', // ligne de la barre latérale survolée
      'panel', // pages : chemins, ids, légendes
      'panel + hover', // ligne de la Vue globale survolée
      'float', // palette et aide : intertitres, ids, champ de saisie vide (placeholder), pied
      'well', // champ « Rechercher » de la barre latérale
      'panel + danger-soft', // chemin du Projet dans l'encart d'un Projet illisible
      'barre d’onglets', // onglets inactifs du mobile
    ],
    usage: 'indices : jamais sur une ligne sélectionnée (press), où le texte passe en ink-2',
  },
  ...(kbdToken
    ? [
        {
          token: kbdToken,
          surfaces: BASES.flatMap((base) => [`${base} + hover`, `${base} + hover + hover`, `${base} + press + hover`]),
          usage: 'touches de clavier : voile hover, posé sur une ligne survolée ou sélectionnée',
        },
      ]
    : []),
  {
    token: 'accent',
    surfaces: ['canvas', 'panel', 'float', 'well', 'panel + accent-soft', 'well + accent-soft'],
    usage: 'liens, pastille « À venir »',
  },
  { token: 'danger', surfaces: ['canvas', 'panel', 'float', 'panel + danger-soft'], usage: 'pictogrammes d’alerte' },
];

describe('contraste WCAG AA des tokens de styles.css', () => {
  it('lit le token de couleur des touches de clavier', () => {
    expect(kbdToken, 'la règle `.kbd` de styles.css déclare une couleur `var(--…)`').toBeTruthy();
  });

  describe.each(THEMES)('thème $name', ({ tokens }) => {
    it(`tous les textes atteignent ${MIN_RATIO}:1 sur les fonds où ils s’affichent`, () => {
      const failures: string[] = [];
      for (const { token, surfaces, usage } of TEXT_ROLES) {
        const text = tokens[token];
        if (!text) throw new Error(`Token --${token} introuvable`);
        for (const name of surfaces) {
          const background = surface(tokens, SURFACES[name] ?? []);
          const ratio = contrastRatio(over(text, background), background);
          if (ratio < MIN_RATIO) failures.push(`${token} sur ${name} : ${ratio.toFixed(2)}:1 (${usage})`);
        }
      }
      expect(failures).toEqual([]);
    });

    it('garde ink-3 en retrait d’ink-2 : le contraste se gagne sans écraser la hiérarchie', () => {
      const [ink2, ink3] = [tokens['ink-2'], tokens['ink-3']] as [Oklch, Oklch];
      expect(Math.abs(ink2.L - ink3.L)).toBeGreaterThanOrEqual(0.05);
    });
  });

  it('lit les monogrammes des Projets : texte de la pastille sur son fond, pour toutes les teintes', () => {
    const failures: string[] = [];
    for (const { name, numbers } of THEMES) {
      for (let hue = 0; hue < 360; hue += 5) {
        const background = toSrgb({ L: numbers['tile-bg-l'] as number, C: numbers['tile-bg-c'] as number, H: hue, A: 1 });
        const text = toSrgb({ L: numbers['tile-fg-l'] as number, C: numbers['tile-fg-c'] as number, H: hue, A: 1 });
        const ratio = contrastRatio(text, background);
        if (ratio < MIN_RATIO) failures.push(`thème ${name}, teinte ${hue}° : ${ratio.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });
});
