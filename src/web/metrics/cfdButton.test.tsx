import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { classesOf, rulesFor, type Rule } from '../test/compiledCss';
import { CfdPanel } from './CfdChart';
import { metricsFixture } from './testing';

/**
 * Le bouton « Masquer Terminé » de la carte « Flux cumulé » : sa place dans l'en-tête de la carte (bdesk-38k.83). Quand la description (large de 60ch au plus : `max-w-[60ch]`, ChartParts.tsx) et le bouton ne tiennent plus côte à
 * côte, le bouton passe seul sur sa ligne. Il y restait à gauche, et la barre du haut, collante, passait sur lui quand on défile, avec le bouton du Projet, qui en recouvre presque toute la largeur (axe : `target-size`,
 * « partiallyObscured », à 14 positions de défilement d'un pixel chacune) ; à droite, comme à côté du titre à 1280 px, il ne passe que sous les petits boutons de recherche et de thème, et axe n'a plus rien à dire.
 *
 * Ce qui le range à droite de sa ligne, seul comme à côté du titre, c'est sa marge gauche `auto` : elle prend l'espace libre de la ligne avant `justify-content` (CSS Flexbox, §8.1). Où l'en-tête passe à la ligne dépend de la police
 * (de repli, avant le chargement de celle de l'application), de l'espacement du texte (WCAG 1.4.12) et de la taille du texte : la marge n'a donc aucune condition de largeur, et ce test vérifie que rien ne la défait : elle est la seule
 * chose qui décide de la place du bouton dans sa ligne (ni autre marge horizontale, ni largeur, physique ou logique, ni croissance ou ordre, ni style en ligne), dans les deux états du bouton ; et le bouton est l'enfant direct d'un en-tête flex qui passe à la ligne.
 *
 * jsdom ne mesure rien. Ce test lit donc ce que Tailwind écrit pour les classes de l'élément, dans la feuille de style de l'application (la vraie, `styles.css` : test/compiledCss.ts, que partagent les tests de taille de cible),
 * et il n'en lit que la couche `utilities`, celle des classes : il ne fait correspondre aucune classe à un sélecteur, donc aucun caractère spécial (`!`, `[`, `:`, `/`, `#`…) n'est à échapper pour qu'une classe soit vue (bdesk-38k.83, revue 2).
 * Une couche écrite dans cette couche y paraît comme une condition de la règle, que `declarationsOf` met devant elle : les égalités la refusent (bdesk-38k.86, revue). Ce que Chromium en fait (axe à chaque position du défilement, la page qui ne bouge pas à 1280 px) se mesure en vrai navigateur : voir la preuve de bdesk-38k.83. Ce test ne voit pas une règle écrite à la main pour le bouton dans
 * styles.css ou metrics.css, ni une règle d'ancêtre qui vise `button`, ni une largeur maximale (elle rétrécit le bouton sans le déplacer de son bord).
 */

/** Les règles que Tailwind écrit pour ces classes : la couche `utilities` de la feuille compilée pour elles seules, une couche écrite dans celle-ci comprise (c'est une condition de la règle). */
async function utilitiesFor(classes: readonly string[]): Promise<Rule[]> {
  const rules = (await rulesFor(classes)).filter((rule) => rule.layer === 'utilities');
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
 * Ce qui décide, avec ses marges, de la place et de la largeur d'une boîte dans sa ligne flex : sa largeur, physique ou logique (celle de l'axe du texte, à l'horizontale), sa croissance, sa base et son ordre. Écrites en camelCase, comme React
 * les écrit : Tailwind lit aussi les fichiers de test, et l'une d'elles, en kebab-case, est le nom d'une classe qu'il ajouterait à la feuille de l'application.
 */
const PLACE = ['width', 'minWidth', 'inlineSize', 'minInlineSize', 'flex', 'flexGrow', 'flexBasis', 'order'].map((name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));

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
