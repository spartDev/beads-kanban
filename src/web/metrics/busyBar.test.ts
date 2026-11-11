import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Le trait du calcul en cours (`.metrics-busy`, metrics.css) : ce que jsdom ne dessine pas, lu dans la feuille de style (comme design/contrast.test.ts lit les jetons). Ce que le navigateur
 * en fait (la page ne se déplace pas quand il paraît, à aucune largeur ; il se voit épinglé sous la barre du haut ; il ressort en couleurs forcées) est mesuré dans Chromium : voir la preuve de
 * bdesk-38k.80.
 */

const read = (name: string) => readFileSync(join(import.meta.dirname, name), 'utf8');
const css = read('metrics.css');
const topBar = read('../shell/TopBar.tsx');

interface Rule {
  selectors: string[];
  /** Le bloc qui l'enveloppe (`@media (…)`, `@keyframes …`), ou rien. */
  within: string;
  body: string;
}

/** Les règles d'un texte CSS, celles des blocs `@media` et `@keyframes` comprises (chacune avec le bloc qui l'enveloppe). */
function rulesOf(source: string, within = ''): Rule[] {
  const rules: Rule[] = [];
  let from = 0;
  for (;;) {
    const open = source.indexOf('{', from);
    if (open < 0) return rules;
    let depth = 0;
    let close = open;
    for (; close < source.length; close++) {
      if (source[close] === '{') depth++;
      else if (source[close] === '}' && --depth === 0) break;
    }
    const head = source.slice(from, open).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const body = source.slice(open + 1, close);
    if (head.startsWith('@media') || head.startsWith('@keyframes')) rules.push(...rulesOf(body, head));
    else rules.push({ selectors: head.split(',').map((selector) => selector.trim()), within, body });
    from = close + 1;
  }
}

const rules = rulesOf(css);

/** Ce que `selector` déclare, dans ce bloc (aucun par défaut) : les déclarations de toutes les règles qui le nomment, les dernières l'emportant. */
function styleOf(selector: string, within = ''): Record<string, string> {
  const style: Record<string, string> = {};
  for (const rule of rules.filter((candidate) => candidate.within === within && candidate.selectors.includes(selector))) {
    for (const [, property, value] of rule.body.matchAll(/([\w-]+):\s*([^;]+);/g)) style[property as string] = (value as string).trim();
  }
  return style;
}

/** La barre du haut : sa couche, sa hauteur sur mobile et dès `md` (en rem : `h-12` = 3 rem). */
const header = /sticky top-0 z-(\d+) flex h-(\d+)[^"']*?md:h-(\d+)/.exec(topBar);
const [topBarLayer, mobile, desktop] = [Number(header?.[1]), Number(header?.[2]) / 4, Number(header?.[3]) / 4];

describe('le trait du calcul en cours : épinglé sous la barre du haut', () => {
  const anchor = styleOf('.metrics-busy');

  it('lit la barre du haut dans TopBar.tsx : sa couche et ses hauteurs', () => {
    expect(header, 'TopBar.tsx : « sticky top-0 z-… flex h-… md:h-… »').not.toBeNull();
  });

  it('ne prend aucune place dans la page : un point d’ancrage collant, de hauteur nulle, que la souris traverse', () => {
    expect(anchor['position']).toBe('sticky');
    expect(anchor['height']).toBe('0');
    expect(anchor['pointer-events']).toBe('none');
  });

  it('passe sous la barre du haut', () => {
    expect(Number(anchor['z-index'])).toBeLessThan(topBarLayer);
  });

  it('s’épingle juste sous la barre du haut, sur mobile et dès `md` : sa hauteur, plus de combien le trait est posé au-dessus de son point d’ancrage', () => {
    const lift = 'var(--metrics-busy-lift)';
    expect(anchor['--metrics-busy-lift']).toBeTruthy();
    expect(anchor['top']).toBe(`calc(${mobile}rem + ${lift})`);
    expect(styleOf('.metrics-busy', '@media (min-width: 48rem)')['top']).toBe(`calc(${desktop}rem + ${lift})`);
    // Et la piste et le segment sont posés de ce même décalage au-dessus : épinglé, le trait est exactement sous la barre, ni recouvert par elle ni écarté d'elle.
    expect(styleOf('.metrics-busy::before')['top']).toBe(`calc(${lift} * -1)`);
    expect(styleOf('.metrics-busy::after')['top']).toBe(`calc(${lift} * -1)`);
  });
});

describe('le trait du calcul en cours : la piste et le segment', () => {
  it('le segment court dans la piste et n’en sort jamais : à chaque image de l’animation, son bord droit reste dans la largeur (la piste n’est pas rognée)', () => {
    const frames = rules
      .filter((rule) => rule.within === '@keyframes metrics-busy')
      .map((rule) => ({ at: rule.selectors[0] as string, left: parseFloat(/left:\s*([\d.]+)/.exec(rule.body)?.[1] ?? 'NaN'), width: parseFloat(/width:\s*([\d.]+)/.exec(rule.body)?.[1] ?? 'NaN') }));
    expect(frames.map((frame) => frame.at)).toEqual(expect.arrayContaining(['0%', '100%']));
    expect(frames.length).toBeGreaterThanOrEqual(3);
    for (const { at, left, width } of frames) {
      expect(left, `${at} : left`).toBeGreaterThanOrEqual(0);
      expect(width, `${at} : width`).toBeGreaterThanOrEqual(0);
      expect(left + width, `${at} : le segment dépasse la piste`).toBeLessThanOrEqual(100);
    }
  });

  it('la piste couvre la largeur, le segment est de l’accent (la piste, elle, n’est que décorative) et lit le mot de l’animation', () => {
    expect(styleOf('.metrics-busy::before')['inset-inline']).toBe('0');
    expect(styleOf('.metrics-busy::after')['background']).toBe('var(--accent)');
    expect(styleOf('.metrics-busy::after')['animation']).toMatch(/^metrics-busy /);
  });
});

describe('le trait du calcul en cours : mouvement réduit et couleurs forcées', () => {
  it('s’arrête quand le mouvement est réduit, et reste alors un trait fixe sur toute la largeur', () => {
    const reduced = styleOf('.metrics-busy::after', '@media (prefers-reduced-motion: reduce)');
    expect(reduced['animation']).toBe('none');
    expect(reduced['width']).toBe('100%');
  });

  // bdesk-38k.80 (relecture, R2) : en couleurs forcées (Windows « contraste élevé »), le système remplace les couleurs de l'auteur : le trait devenait blanc sur le blanc du panneau.
  // Une couleur du système, elle, est celle que l'utilisateur a choisie pour ressortir.
  it('prend une couleur du système en couleurs forcées : le trait y resterait invisible', () => {
    expect(styleOf('.metrics-busy::after', '@media (forced-colors: active)')['background']).toMatch(/^(Highlight|CanvasText)$/);
  });
});
