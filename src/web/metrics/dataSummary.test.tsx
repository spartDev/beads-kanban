import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { classesOf, declared, lengthOf, names, rulesFor, selectorOf, wordsOf, type Rule } from '../test/compiledCss';
import { ChartCard } from './ChartParts';

/**
 * Le résumé « Données du graphique » de chaque carte (`ChartCard`) : sa cible (WCAG 2.5.8, « Taille de la cible (minimum) » : 24 px sur 24) et ce qu'elle ne doit pas déplacer
 * (bdesk-38k.82). axe le signalait à 375 px : le résumé faisait 16 px de haut, et la barre du haut, collante, passe sur lui quand on défile.
 *
 * jsdom ne mesure rien. Ce test lit donc ce que les classes du résumé font à sa boîte dans la feuille de style de l'application, compilée par Tailwind (la vraie, `styles.css`, et non une table
 * recopiée ici : test/compiledCss.ts), comme busyBar.test.ts lit `metrics.css`. Ce que Chromium en fait (la hauteur mesurée, la page qui ne bouge pas à 1280 px, ce qu'axe dit à chaque position du défilement) se
 * mesure en vrai navigateur : voir la preuve de bdesk-38k.82.
 *
 * Il lit les règles que les classes du résumé et de `details` posent seules et sans condition, dans l'ordre de la feuille, qui est celui de la cascade. Il refuse, au lieu de les ignorer, celles qui déclarent une des propriétés qu'il lit
 * et nomment une de ces classes autrement (`hover:…`, `md:…`, `dark:…`, `max-[…]:…`, une couche dans une couche, un sélecteur composé) : il ne sait pas dire quand elles s'appliquent. Seule une règle de pseudo-élément, comme la puce du
 * résumé, passe : elle ne dit rien de sa boîte. Ce qu'il ne voit pas : les règles de `styles.css` écrites par nom d'élément (`details > summary`), les propriétés qu'il ne lit pas (`height`, `max-height`…), la mise en page de la ligne
 * (un texte qui passerait sur deux lignes) et ce que les ancêtres de `details` font hériter au résumé : sa hauteur de ligne ne se lit que sur `details` et sur lui.
 */

/** La police racine du navigateur, en px : le `rem` des longueurs lues. */
const ROOT = 16;

/** Les propriétés dont la boîte du résumé dépend et que ce test lit, raccourcis de marge et de rembourrage compris (`edgeOf` les ouvre en côtés). */
const READ = ['padding', 'padding-block', 'padding-top', 'padding-bottom', 'margin', 'margin-block', 'margin-top', 'margin-bottom', 'min-height', 'line-height', 'display', 'cursor'];

/**
 * Les règles qui s'appliquent à cet élément, dans l'ordre de la feuille : celles qu'une de ses classes pose seule et sans condition, pour une propriété lue. Une règle qui en déclare une et nomme une de ses classes autrement fait
 * échouer le test ; une règle de pseudo-élément (`::-webkit-details-marker`) est écartée, elle ne dit rien de la boîte de l'élément.
 */
function appliedTo(rules: readonly Rule[], element: Element): Rule[] {
  const own = classesOf(element).map(selectorOf);
  return rules.filter((rule) => {
    const property = READ.find((read) => rule.declarations[read] !== undefined);
    if (property === undefined || !own.some((selector) => names(rule, selector)) || /(?<!\\)::/.test(rule.selector)) return false;
    if (rule.within.length > 0 || !own.includes(rule.selector)) {
      throw new Error(`Règle que ce test ne sait pas lire : « ${[...rule.within, rule.selector].join(' → ')} » déclare ${property} et nomme une classe de l'élément sans en être seule et sans condition`);
    }
    return true;
  });
}

/** Un côté (`top` ou `bottom`) d'une déclaration de rembourrage ou de marge : le raccourci (`padding` : de une à quatre valeurs, le haut est la première, le bas la troisième ou, à défaut, la première), `*-block` (début, fin) ou le côté seul. */
function edgeOf(property: string, value: string, edge: 'top' | 'bottom'): string {
  const words = wordsOf(value);
  const at = (index: number) => words[index] ?? words[0] ?? value;
  if (property.endsWith('-block')) return edge === 'top' ? at(0) : at(1);
  if (property === 'padding' || property === 'margin') return edge === 'top' ? at(0) : at(2);
  return value;
}

/** La dernière valeur de cette propriété parmi ces règles, `undefined` : aucune. Aucune d'elles n'est sous condition : la largeur de fenêtre ne compte pas. */
const lastOf = (rules: readonly Rule[], property: string) => declared(rules, [property], 0);

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

  const rules = await rulesFor([...classesOf(summary), ...classesOf(details)]);
  const own = appliedTo(rules, summary);
  // Le texte du résumé hérite de la hauteur de ligne de `details` (`text-micro` : 1 rem).
  const line = lengthOf(rules, lastOf(appliedTo(rules, details), 'line-height') ?? lastOf(own, 'line-height') ?? '', ROOT);
  const edge = (kind: 'padding' | 'margin', side: 'top' | 'bottom') =>
    lengthOf(rules, declared(own, [kind, `${kind}-block`, `${kind}-${side}`], 0, (property, value) => edgeOf(property, value, side)) ?? '0px', ROOT);

  // Une seule ligne de texte (« Données du graphique » tient dans la carte à 375 px) : la boîte du résumé est sa ligne, plus son rembourrage, au moins sa hauteur minimale.
  const border = Math.max(line + edge('padding', 'top') + edge('padding', 'bottom'), lengthOf(rules, lastOf(own, 'min-height') ?? '0px', ROOT));
  return {
    summary,
    /** Ce qu'axe mesure : la boîte de bordure. */
    height: border,
    /** Ce que le résumé prend dans la page : la boîte de bordure moins ce que les marges négatives en reprennent. */
    footprint: border + edge('margin', 'top') + edge('margin', 'bottom'),
    line,
    /** Sans utilitaire `display`, c'est celui du navigateur pour un résumé : un bloc (le défaut est de remplir la ligne). */
    display: lastOf(own, 'display') ?? 'block',
    cursor: lastOf(own, 'cursor'),
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
