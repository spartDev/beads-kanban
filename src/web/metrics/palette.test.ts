import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio, parseOklch, toSrgb, type Oklch } from '../test/color';
import { OUTLINE_FILL_SHARE, outlineOf } from './palette';

/**
 * Lisibilité des graphiques en clair comme en sombre, sur le même modèle que design/contrast.test.ts : les jetons sont
 * lus dans les feuilles de style, et changer une couleur sans vérifier son contraste fait échouer le test, avec la
 * liste des couleurs fautives.
 *
 * - le texte d'une tendance (--good, --danger) atteint 4,5:1 sur les fonds des tuiles (WCAG 1.4.3) ;
 * - chaque forme pleine d'un graphique (bande du CFD, barre, point, pastille de légende) est cernée d'un trait mêlé à
 *   l'encre du thème, et ce contour atteint 3:1 sur le panneau (WCAG 1.4.11) ;
 * - les cinq colonnes du CFD se distinguent de leurs voisines.
 */

const TEXT_MIN = 4.5;
const GRAPHIC_MIN = 3;

const read = (name: string) => readFileSync(join(import.meta.dirname, name), 'utf8');
const stylesCss = read('../styles.css');
const metricsCss = read('metrics.css');

/** Contenu du bloc CSS qui s'ouvre par `opening`. */
function blockOf(source: string, opening: string): string {
  const start = source.indexOf(opening);
  if (start < 0) throw new Error(`Bloc « ${opening} » introuvable`);
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

const LIGHT = ':root {';
const DARK = ":root[data-theme='dark'] {";

const THEMES = [LIGHT, DARK].map((opening) => {
  const dark = opening === DARK;
  const [styles, metrics] = [stylesCss, metricsCss].map((css) => ({
    colors: colorTokens(blockOf(css, opening)),
    numbers: numberTokens(blockOf(css, opening)),
  })) as [{ colors: Tokens; numbers: Record<string, number> }, { colors: Tokens; numbers: Record<string, number> }];
  // Le thème sombre ne redéfinit que ce qui change : le reste vient du clair.
  const base = dark
    ? {
        styles: colorTokens(blockOf(stylesCss, LIGHT)),
        metrics: colorTokens(blockOf(metricsCss, LIGHT)),
        numbers: { ...numberTokens(blockOf(metricsCss, LIGHT)) },
      }
    : { styles: {}, metrics: {}, numbers: {} };
  return {
    name: dark ? 'sombre' : 'clair',
    tokens: { ...base.styles, ...base.metrics, ...styles.colors, ...metrics.colors } as Tokens,
    numbers: { ...base.numbers, ...metrics.numbers },
  };
});

/** `color-mix(in oklab, fill 60%, ink)` : la moyenne de L, a et b, pondérée par la part de la couleur. */
function outline(fill: Oklch, ink: Oklch, share = OUTLINE_FILL_SHARE): Oklch {
  const lab = ({ L, C, H }: Oklch) => ({ L, a: C * Math.cos((H * Math.PI) / 180), b: C * Math.sin((H * Math.PI) / 180) });
  const [f, i] = [lab(fill), lab(ink)];
  const [L, a, b] = [f.L * share + i.L * (1 - share), f.a * share + i.a * (1 - share), f.b * share + i.b * (1 - share)];
  return { L, C: Math.hypot(a, b), H: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360, A: 1 };
}

/** Distance entre deux couleurs dans OKLab : de quoi dire si deux aplats voisins se distinguent. */
function distance(x: Oklch, y: Oklch): number {
  const lab = ({ L, C, H }: Oklch) => [L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)] as const;
  const [p, q] = [lab(x), lab(y)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

const token = (tokens: Tokens, name: string): Oklch => {
  const color = tokens[name];
  if (!color) throw new Error(`Jeton --${name} introuvable`);
  return color;
};

describe('outlineOf', () => {
  it('mêle la couleur à l’encre du thème, dans OKLab, avec la part que le test de contraste suppose', () => {
    expect(OUTLINE_FILL_SHARE).toBe(0.6);
    expect(outlineOf('var(--flow-done)')).toBe('color-mix(in oklab, var(--flow-done) 60%, var(--ink))');
  });
});

describe.each(THEMES)('thème $name', ({ tokens, numbers }) => {
  const panel = toSrgb(token(tokens, 'panel'));
  const ink = token(tokens, 'ink');

  it(`le texte des tendances atteint ${TEXT_MIN}:1 sur les tuiles (panneau et fond en retrait)`, () => {
    const failures: string[] = [];
    for (const text of ['good', 'danger']) {
      for (const surface of ['panel', 'well']) {
        const ratio = contrastRatio(toSrgb(token(tokens, text)), toSrgb(token(tokens, surface)));
        if (ratio < TEXT_MIN) failures.push(`--${text} sur ${surface} : ${ratio.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });

  it(`le contour de chaque colonne du CFD atteint ${GRAPHIC_MIN}:1 sur le panneau`, () => {
    const failures: string[] = [];
    for (const name of ['flow-backlog', 'flow-ready', 'flow-progress', 'flow-blocked', 'flow-done']) {
      const ratio = contrastRatio(toSrgb(outline(token(tokens, name), ink)), panel);
      if (ratio < GRAPHIC_MIN) failures.push(`--${name} : ${ratio.toFixed(2)}:1`);
    }
    expect(failures).toEqual([]);
  });

  it(`le contour de chaque type et de chaque priorité atteint ${GRAPHIC_MIN}:1 : nuage de points et âges les colorent`, () => {
    const failures: string[] = [];
    const names = Object.keys(tokens).filter((name) => /^(type|prio)-/.test(name));
    expect(names.length).toBeGreaterThanOrEqual(14);
    for (const name of names) {
      const ratio = contrastRatio(toSrgb(outline(token(tokens, name), ink)), panel);
      if (ratio < GRAPHIC_MIN) failures.push(`--${name} : ${ratio.toFixed(2)}:1`);
    }
    expect(failures).toEqual([]);
  });

  it(`le contour d’un Projet atteint ${GRAPHIC_MIN}:1 pour toutes les teintes`, () => {
    const [L, C] = [numbers['series-l'], numbers['series-c']];
    if (L === undefined || C === undefined) throw new Error('--series-l et --series-c introuvables');
    const failures: string[] = [];
    for (let hue = 0; hue < 360; hue += 5) {
      const ratio = contrastRatio(toSrgb(outline({ L, C, H: hue, A: 1 }, ink)), panel);
      if (ratio < GRAPHIC_MIN) failures.push(`teinte ${hue}° : ${ratio.toFixed(2)}:1`);
    }
    expect(failures).toEqual([]);
  });

  it(`le contour de chaque niveau de la carte d’activité atteint ${GRAPHIC_MIN}:1 sur le panneau, et deux niveaux voisins se distinguent`, () => {
    const levels = ['activity-1', 'activity-2', 'activity-3', 'activity-4'];
    const failures: string[] = [];
    for (const name of levels) {
      const ratio = contrastRatio(toSrgb(outline(token(tokens, name), ink)), panel);
      if (ratio < GRAPHIC_MIN) failures.push(`--${name} : ${ratio.toFixed(2)}:1`);
    }
    for (let i = 1; i < levels.length; i++) {
      const [lower, upper] = [levels[i - 1] as string, levels[i] as string];
      const gap = distance(token(tokens, lower), token(tokens, upper));
      if (gap < 0.08) failures.push(`--${lower} / --${upper} : ${gap.toFixed(3)}`);
    }
    expect(failures).toEqual([]);
  });

  it('distingue les colonnes voisines du CFD', () => {
    const order = ['flow-done', 'flow-progress', 'flow-blocked', 'flow-ready', 'flow-backlog'];
    const failures: string[] = [];
    for (let i = 1; i < order.length; i++) {
      const [lower, upper] = [order[i - 1] as string, order[i] as string];
      const gap = distance(token(tokens, lower), token(tokens, upper));
      if (gap < 0.08) failures.push(`--${lower} / --${upper} : ${gap.toFixed(3)}`);
    }
    expect(failures).toEqual([]);
  });
});
