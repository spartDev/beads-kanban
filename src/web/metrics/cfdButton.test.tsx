import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import { CfdPanel } from './CfdChart';
import { metricsFixture } from './testing';

/**
 * Le bouton « Masquer Terminé » de la carte « Flux cumulé » : sa place dans l'en-tête de la carte (bdesk-38k.83). Quand la description (large de 60ch au plus : `max-w-[60ch]`, ChartParts.tsx) et le bouton ne tiennent plus côte à
 * côte, le bouton passe seul sur sa ligne. Il y restait à gauche, et la barre du haut, collante, passait sur lui quand on défile, avec le bouton du Projet, qui en recouvre presque toute la largeur (axe : `target-size`,
 * « partiallyObscured », à 14 positions de défilement d'un pixel chacune) ; à droite, comme à côté du titre à 1280 px, il ne passe que sous les petits boutons de recherche et de thème, et axe n'a plus rien à dire.
 *
 * Ce qui le range à droite de sa ligne, seul comme à côté du titre, c'est sa marge gauche `auto` : elle prend l'espace libre de la ligne avant `justify-content` (CSS Flexbox, §8.1). Où l'en-tête passe à la ligne dépend de la police
 * (de repli, avant le chargement de celle de l'application), de l'espacement du texte (WCAG 1.4.12) et de la taille du texte : la marge n'a donc aucune condition de largeur, et ce test vérifie que rien ne la défait : elle est la seule
 * chose qui décide de la place du bouton dans sa ligne (ni autre marge horizontale, ni largeur, croissance ou ordre, ni style en ligne), dans les deux états du bouton ; et le bouton est l'enfant direct d'un en-tête flex qui passe à la ligne.
 *
 * jsdom ne mesure rien. Ce test lit donc ce que Tailwind écrit pour les classes de l'élément, dans la feuille de style de l'application (la vraie, `styles.css` : technique de dataSummary.test.tsx pour le résumé « Données du graphique »),
 * et il n'en lit que la couche `utilities`, celle des classes : il ne fait correspondre aucune classe à un sélecteur, donc aucun caractère spécial (`!`, `[`, `:`, `/`, `#`…) n'est à échapper pour qu'une classe soit vue (bdesk-38k.83, revue 2).
 * Ce que Chromium en fait (axe à chaque position du défilement, la page qui ne bouge pas à 1280 px) se mesure en vrai navigateur : voir la preuve de bdesk-38k.83. Ce test ne voit pas une règle écrite à la main pour le bouton dans
 * styles.css ou metrics.css, ni une règle d'ancêtre qui vise `button`.
 */

const web = join(import.meta.dirname, '..');
const modules = join(import.meta.dirname, '../../../node_modules');

/** La feuille de style de l'application, compilée pour ces classes seulement, variantes comprises. */
async function stylesheetFor(classes: readonly string[]): Promise<string> {
  const compiler = await compile(readFileSync(join(web, 'styles.css'), 'utf8'), {
    base: web,
    loadStylesheet: async (id, base) => {
      const path = id === 'tailwindcss' ? join(modules, 'tailwindcss/index.css') : join(base, id);
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
    },
  });
  return compiler.build([...classes]);
}

interface Rule {
  selector: string;
  /** Les blocs `@container` et `@media` qui l'enveloppent, du plus extérieur au plus intérieur. */
  within: string[];
  /** La couche (`@layer`) où elle est écrite : Tailwind range dans `utilities` ce que les classes demandent. */
  layer: string | undefined;
  declarations: Record<string, string>;
}

/** Les règles d'une feuille de style, chacune avec les blocs qui l'enveloppent. */
function rulesOf(source: string, within: string[] = [], layer?: string): Rule[] {
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
    // Ce qui précède l'accolade, sans les instructions qui le précèdent (`@layer theme, base;`) ni les commentaires.
    const head = (source.slice(from, open).replace(/\/\*[\s\S]*?\*\//g, '').split(/[;}]/).pop() ?? '').trim();
    const body = source.slice(open + 1, close);
    if (head.startsWith('@')) rules.push(...rulesOf(body, /^@(container|media)\b/.test(head) ? [...within, head] : within, /^@layer\s+([\w-]+)$/.exec(head)?.[1] ?? layer));
    else {
      const declarations = Object.fromEntries([...body.matchAll(/([\w-]+):\s*([^;]+?)\s*(?:;|$)/g)].map(([, property, value]) => [property as string, value as string]));
      rules.push({ selector: head, within, layer, declarations });
    }
    from = close + 1;
  }
}

const classesOf = (element: Element) => (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

/** Les règles que Tailwind écrit pour ces classes : la couche `utilities` de la feuille compilée pour elles seules. */
async function utilitiesFor(classes: readonly string[]): Promise<Rule[]> {
  const rules = rulesOf(await stylesheetFor(classes)).filter((rule) => rule.layer === 'utilities');
  // Des classes sans une seule règle : la feuille compilée n'a plus la forme que ce test sait lire, et les « aucune » des tests passeraient à vide.
  expect(rules.length, `aucune règle de la couche utilities pour : ${classes.join(' ')}`).toBeGreaterThan(0);
  return rules;
}

/** Les déclarations de ces propriétés dans ces règles, une ligne chacune : les blocs qui les enveloppent, le sélecteur, la propriété et sa valeur (`!important` comprise). */
function declarationsOf(rules: readonly Rule[], properties: readonly string[]): string[] {
  return rules.flatMap((rule) => properties.filter((property) => property in rule.declarations).map((property) => [...rule.within, `${rule.selector} { ${property}: ${rule.declarations[property]} }`].join(' → ')));
}

/** Les propriétés qui posent une marge à gauche ou à droite, raccourci et propriétés logiques compris. */
const HORIZONTAL_MARGINS = ['margin', 'margin-inline', 'margin-inline-start', 'margin-inline-end', 'margin-left', 'margin-right'];

/**
 * Ce qui décide, avec ses marges, de la place et de la largeur d'une boîte dans sa ligne flex : sa largeur, sa croissance, sa base et son ordre. Écrites en camelCase, comme React les écrit : Tailwind lit aussi les fichiers
 * de test, et l'une d'elles, en kebab-case, est le nom d'une classe qu'il ajouterait à la feuille de l'application.
 */
const PLACE = ['width', 'minWidth', 'flex', 'flexGrow', 'flexBasis', 'order'].map((name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));

/** Le bouton « Masquer Terminé » de la vraie `CfdPanel`, tel qu'on le voit d'abord, puis une fois pressé (`aria-pressed`) : `check` le voit dans ses deux états. */
async function inBothStates(check: (button: HTMLElement) => void | Promise<void>) {
  render(<CfdPanel points={metricsFixture().cfd} />);
  const button = screen.getByRole('button', { name: 'Masquer Terminé' });
  expect(button.getAttribute('aria-pressed')).toBe('false');
  await check(button);
  fireEvent.click(button);
  expect(button.getAttribute('aria-pressed')).toBe('true');
  await check(button);
}

describe('le bouton « Masquer Terminé » : sa place dans l’en-tête de la carte', () => {
  // Pas de seuil, pas d'`!important`, pas de variante : une marge conditionnelle (le premier jet la déclarait sous un seuil de conteneur de 34 rem), une marge forcée à zéro ou une autre marge laisseraient le bouton à gauche là où
  // l'en-tête passe à la ligne (preuve de bdesk-38k.83, « Corrections après revue » et « Corrections après revue 2 »). Toute autre marge horizontale fait échouer ce test, même si la feuille de style la départage aujourd'hui par son ordre.
  it('n’a d’autre marge horizontale que `margin-left: auto`, sans condition ni `!important`, dans ses deux états', async () => {
    await inBothStates(async (button) => {
      expect(declarationsOf(await utilitiesFor(classesOf(button)), HORIZONTAL_MARGINS)).toEqual(['.ml-auto { margin-left: auto }']);
    });
  });

  it('n’a ni largeur, ni croissance, ni ordre qui changent sa place dans la ligne, dans ses deux états', async () => {
    await inBothStates(async (button) => {
      expect(declarationsOf(await utilitiesFor(classesOf(button)), PLACE)).toEqual([]);
    });
  });

  it('n’a pas de style en ligne, qui passerait avant toute classe, dans ses deux états', async () => {
    await inBothStates((button) => {
      expect(button.getAttribute('style')).toBeNull();
    });
  });

  it('est un enfant direct de l’en-tête de la carte, une ligne flex qui passe à la ligne : la marge auto joue sur la ligne où se trouve le bouton', async () => {
    render(<CfdPanel points={metricsFixture().cfd} />);
    const header = screen.getByRole('button', { name: 'Masquer Terminé' }).parentElement as HTMLElement;

    expect(header.tagName).toBe('HEADER');
    expect(declarationsOf(await utilitiesFor(classesOf(header)), ['display', 'flex-wrap'])).toEqual(['.flex { display: flex }', '.flex-wrap { flex-wrap: wrap }']);
  });
});
