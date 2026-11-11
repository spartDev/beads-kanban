import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import { ChartCard } from './ChartParts';

/**
 * Le résumé « Données du graphique » de chaque carte (`ChartCard`) : sa cible (WCAG 2.5.8, « Taille de la cible (minimum) » : 24 px sur 24) et ce qu'elle ne doit pas déplacer
 * (bdesk-38k.82). axe le signalait à 375 px : le résumé faisait 16 px de haut, et la barre du haut, collante, passe sur lui quand on défile.
 *
 * jsdom ne mesure rien. Ce test lit donc ce que les classes du résumé font à sa boîte dans la feuille de style de l'application, compilée par Tailwind (la vraie, `styles.css`, et non une table
 * recopiée ici), comme busyBar.test.ts lit `metrics.css`. Ce que Chromium en fait (la hauteur mesurée, la page qui ne bouge pas à 1280 px, ce qu'axe dit à chaque position du défilement) se
 * mesure en vrai navigateur : voir la preuve de bdesk-38k.82.
 */

const web = join(import.meta.dirname, '..');
const modules = join(import.meta.dirname, '../../../node_modules');

/** La feuille de style de l'application, compilée pour ces classes seulement (les classes à variante, `hover:…`, n'y sont pas : ce n'est pas la boîte au repos). */
async function stylesheetFor(classes: readonly string[]): Promise<string> {
  const compiler = await compile(readFileSync(join(web, 'styles.css'), 'utf8'), {
    base: web,
    loadStylesheet: async (id, base) => {
      const path = id === 'tailwindcss' ? join(modules, 'tailwindcss/index.css') : join(base, id);
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
    },
  });
  return compiler.build(classes.filter((name) => !/[:[]/.test(name)));
}

/** Le sélecteur de la classe tel que Tailwind l'écrit (`gap-1.5` : `.gap-1\.5`), puis son texte pour une expression régulière. */
const selectorOf = (name: string) => `.${name.replace(/[.:/[\]()%]/g, '\\$&')}`;
const literal = (text: string) => text.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');

/** Ce que déclarent, ensemble, les utilitaires de ces classes (aucun, pour une classe qui n'en a pas : `group`). */
function declarationsOf(stylesheet: string, classes: readonly string[]): Record<string, string> {
  const declared: Record<string, string> = {};
  for (const name of classes) {
    const rule = new RegExp(`${literal(selectorOf(name))}\\s*\\{([^}]*)\\}`).exec(stylesheet);
    for (const [, property, value] of (rule?.[1] ?? '').matchAll(/([\w-]+):\s*([^;]+);/g)) declared[property as string] = (value as string).trim();
  }
  return declared;
}

/** Une longueur en px : `1rem`, `calc(var(--spacing) * -1)`, `var(--tw-leading, 1rem)`. Les variables sont lues dans la feuille de style (`--spacing` y vaut 0,25 rem). */
function lengthOf(stylesheet: string, value: string): number {
  const text = value.trim();
  const variable = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(text);
  if (variable) {
    const declared = new RegExp(`${variable[1] as string}:\\s*([^;]+);`).exec(stylesheet)?.[1] ?? variable[2];
    if (declared === undefined) throw new Error(`Variable CSS sans valeur : ${text}`);
    return lengthOf(stylesheet, declared);
  }
  const product = /^calc\((.+) \* (-?[\d.]+)\)$/.exec(text);
  if (product) return lengthOf(stylesheet, product[1] as string) * Number(product[2]);
  const unit = /^(-?[\d.]+)(rem|px)$/.exec(text);
  if (unit) return Number(unit[1]) * (unit[2] === 'rem' ? 16 : 1);
  throw new Error(`Longueur que ce test ne sait pas lire : ${text}`);
}

/** Le résumé d'une carte de graphique, avec la boîte que ses classes lui donnent : sa hauteur, ce qu'elle prend dans la page, et si c'est un bloc. */
async function renderedSummary() {
  render(
    <ChartCard title="Débit" data={<p>valeurs</p>}>
      <div />
    </ChartCard>,
  );
  const summary = screen.getByText('Données du graphique').closest('summary');
  const details = summary?.closest('details');
  if (!summary || !details) throw new Error('La carte n’a pas de résumé « Données du graphique ».');

  const summaryClasses = summary.className.split(/\s+/).filter(Boolean);
  const detailsClasses = details.className.split(/\s+/).filter(Boolean);
  const stylesheet = await stylesheetFor([...summaryClasses, ...detailsClasses]);
  const own = declarationsOf(stylesheet, summaryClasses);
  // Le texte du résumé hérite de la hauteur de ligne de `details` (`text-micro` : 1 rem).
  const line = lengthOf(stylesheet, declarationsOf(stylesheet, detailsClasses)['line-height'] ?? declarationsOf(stylesheet, summaryClasses)['line-height'] ?? '');
  const edge = (kind: 'padding' | 'margin', side: 'top' | 'bottom') => lengthOf(stylesheet, own[`${kind}-${side}`] ?? own[`${kind}-block`] ?? '0px');

  // Une seule ligne de texte (« Données du graphique » tient dans la carte à 375 px) : la boîte du résumé est sa ligne, plus son rembourrage, au moins sa hauteur minimale.
  const border = Math.max(line + edge('padding', 'top') + edge('padding', 'bottom'), lengthOf(stylesheet, own['min-height'] ?? '0px'));
  return {
    summary,
    /** Ce qu'axe mesure : la boîte de bordure. */
    height: border,
    /** Ce que le résumé prend dans la page : la boîte de bordure moins ce que les marges négatives en reprennent. */
    footprint: border + edge('margin', 'top') + edge('margin', 'bottom'),
    line,
    /** Sans utilitaire `display`, c'est celui du navigateur pour un résumé : un bloc (le défaut est de remplir la ligne). */
    display: own['display'] ?? 'block',
    cursor: own['cursor'],
  };
}

describe('le résumé « Données du graphique » : sa cible', () => {
  it('fait 24 px de haut au moins : au-dessous, axe signale `target-size` (WCAG 2.5.8)', async () => {
    const { height } = await renderedSummary();

    expect(height).toBeGreaterThanOrEqual(24);
  });

  it('ne déplace rien dans la page : le rembourrage qui l’agrandit est repris par des marges négatives, la carte garde la hauteur de sa ligne de texte', async () => {
    const { footprint, line } = await renderedSummary();

    expect(line).toBeGreaterThan(0);
    expect(footprint).toBe(line);
  });

  // À 375 px le bouton du Projet de la barre du haut, collante, recouvre presque toute la largeur du texte du résumé (il n'en laisse dépasser que 8 px avec le Projet de la mesure) : quand on
  // défile, un résumé réduit à son texte n'a plus de zone libre de 24 px à côté de la barre (axe : « partiallyObscured »). Sur toute la ligne de la carte, il garde de quoi cliquer à côté du
  // bouton, à chaque position du défilement.
  it('est une ligne entière, pas une boîte réduite à son texte : une cible plus large que le bouton de la barre du haut qui peut la recouvrir', async () => {
    const { display } = await renderedSummary();

    expect(display, `display : « ${display} » réduit la cible à son texte, il faut un bloc (flex, block…)`).toMatch(/^(block|flex|grid)$/);
  });

  // Toute la ligne déplie, le blanc à droite du texte compris : le curseur le dit, comme pour un lien.
  it('montre la main sur toute la ligne : elle déplie, le curseur le dit', async () => {
    const { cursor } = await renderedSummary();

    expect(cursor).toBe('pointer');
  });

  it('reste le résumé de la carte : le texte et le tableau des valeurs, qu’il déplie, sont inchangés', async () => {
    const { summary } = await renderedSummary();

    expect(summary.textContent).toBe('›Données du graphique');
    expect(summary.closest('details')?.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe('Données : Débit');
  });
});
