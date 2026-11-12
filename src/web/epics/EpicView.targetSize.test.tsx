import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { classesOf, declared, lengthOf, names, rulesFor, selectorOf, type Rule } from '../test/compiledCss';
import { issue, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

/**
 * Les liens du haut de la page d'une Epic : « Epics » (le retour à la liste), « Ouvrir le ticket » et « Voir au kanban » (bdesk-38k.85). La barre du haut est collante : quand on défile, ils passent dessous, et ses boutons les recouvrent en
 * partie (sur mobile, le bouton du Projet, qui couvre toute la largeur d'un lien aussi étroit que son texte ; à 1280 px, le fil d'Ariane, selon la longueur du nom du Projet). `target-size` d'axe (WCAG 2.5.8, « Taille de la cible (minimum) »)
 * veut alors 24 px sur 24 de lien que rien ne recouvre, et un lien de 20 px de haut n'en a nulle part : quelques positions de défilement d'un pixel en violation, 14 chacun à 375 px avec un nom de Projet long. Chacun fait donc 24 px de haut,
 * à toute largeur, et « Epics », seul sur sa ligne, la prend en entier, au bureau comme sur mobile (à la largeur de son texte il échoue à 1280 px pour certains noms de Projet : le fil d'Ariane le recouvre par le milieu) : la zone que la barre laisse à côté de ses
 * boutons (TopBar.tsx) tombe dans le lien, comme dans le résumé « Données du graphique » (ChartParts.tsx). Sur mobile, les deux liens de la phrase passent l'un sous l'autre pour avoir, chacun, toute la ligne ; sous 11 rem de large, où la barre n'a plus cette zone, ils s'écartent de 12 px (axe les prendrait sinon pour voisins). Une
 * marge négative reprend les 2 px de chaque côté : la page ne bouge pas.
 *
 * jsdom ne met rien en page et ne mesure rien. Ce test lit donc ce que les classes des liens déclarent dans la feuille de style de l'application, compilée par Tailwind (la vraie, `styles.css`, non recopiée ici : test/compiledCss.ts), à 375 et à 1280 px,
 * et non leurs noms : une classe qui annulerait l'effet d'une autre à une largeur (un reste à zéro dès `md`, une largeur rendue à l'auto) le fait échouer, une écriture équivalente ne le fait pas. Il lit la hauteur minimale, la marge et le
 * rembourrage verticaux, la largeur et l'alignement de « Epics », le sens de la phrase et l'écart entre ses deux liens. Il refuse, au lieu de les ignorer, les règles d'une classe de l'élément qui déclarent l'une de ces propriétés sous une
 * forme qu'il ne sait pas lire (raccourcis `margin`, `padding`, `gap`, un côté seul, un sélecteur composé) et toute condition autre qu'une largeur de fenêtre.
 *
 * Ce qu'il ne voit pas : les règles de `styles.css` écrites par nom d'élément, celles des ancêtres (`header a`), un `style` en ligne, la hauteur de ligne du texte (la page « ne bouge pas » à 20 px de texte), la mise en page réelle (le texte
 * qui passerait sur deux lignes, la barre du haut) et ce que dit axe : le sens du fil d'Ariane et la zone libre de la barre se mesurent en vrai navigateur (voir la preuve de bdesk-38k.85). Les deux liens de la phrase restent étroits et côte à côte
 * au bureau ; pour certains noms de Projet et certaines largeurs, ils y gardent quelques positions en violation (la preuve les chiffre), ce que ce test ne dit pas non plus.
 */

withAsyncTimeout(5_000);

/** La police racine du navigateur, en px : le `rem` des longueurs lues. */
const ROOT = 16;

/** Ce que ce test lit : les propriétés dont dépendent la boîte des liens et l'empilement de leur phrase. */
const READ = ['min-height', 'margin-block', 'padding-block', 'width', 'max-width', 'display', 'align-items', 'flex-direction', 'row-gap'];
/** Les écritures voisines qu'il ne sait pas lire : une règle d'une classe de l'élément qui en déclare une le fait échouer, au lieu de laisser passer en silence ce qu'elle change. */
const UNREAD_BOX = ['margin', 'margin-top', 'margin-bottom', 'padding', 'padding-top', 'padding-bottom'];
/** Sur la phrase, l'écart se lit par `row-gap` : le raccourci `gap` aussi serait refusé (sur un lien, `gap` espace l'icône de son texte : il ne dit rien de la boîte). */
const UNREAD_PHRASE = [...UNREAD_BOX, 'gap'];

/**
 * Les règles de ces classes que ce test lit pour cet élément, dans l'ordre de la feuille (celui de la cascade) : celles qu'une classe de l'élément pose seule, pour l'une des propriétés lues. Les conditions qui les enveloppent
 * (`md:`, `max-md:`, `max-[11rem]:`) sont lues par `declared`, largeur de fenêtre par largeur de fenêtre. Une règle qui nomme une classe de l'élément autrement (sélecteur composé) et déclare une de ces propriétés, ou qui déclare une
 * des écritures qu'il ne sait pas lire, fait échouer le test ; une règle de pseudo-élément est écartée, elle ne dit rien de la boîte du lien.
 */
function appliedTo(rules: readonly Rule[], element: Element, unreadable: readonly string[]): Rule[] {
  const own = classesOf(element).map(selectorOf);
  return rules.filter((rule) => {
    if (!own.some((selector) => names(rule, selector)) || /(?<!\\)::/.test(rule.selector)) return false;
    const unread = unreadable.find((property) => rule.declarations[property] !== undefined);
    if (unread !== undefined) throw new Error(`Règle que ce test ne sait pas lire : « ${[...rule.within, rule.selector].join(' → ')} » déclare ${unread}, que ce test ne lit pas : il lit ${READ.join(', ')}`);
    const read = READ.find((property) => rule.declarations[property] !== undefined);
    if (read === undefined) return false;
    if (!own.includes(rule.selector)) throw new Error(`Règle que ce test ne sait pas lire : « ${[...rule.within, rule.selector].join(' → ')} » déclare ${read} et nomme une classe de l'élément sans en être seule`);
    return true;
  });
}

/** Les règles de feuille de style d'un jeu de classes, compilées une fois par jeu : Tailwind met une centaine de millisecondes à le faire. */
const sheets = new Map<string, Promise<Rule[]>>();
const sheetOf = (element: Element) => {
  const classes = classesOf(element);
  const key = classes.join(' ');
  if (!sheets.has(key)) sheets.set(key, rulesFor(classes));
  return sheets.get(key) as Promise<Rule[]>;
};

/** Ce que les classes d'un élément déclarent, à une largeur de fenêtre : une longueur en px (`0` : aucune déclaration), ou le texte de la valeur. */
async function declarationsOf(element: Element, unreadable: readonly string[] = UNREAD_BOX) {
  const sheet = await sheetOf(element);
  const own = appliedTo(sheet, element, unreadable);
  const value = (property: string, viewport: number) => declared(own, [property], viewport);
  const length = (property: string, viewport: number) => lengthOf(sheet, value(property, viewport) ?? '0px', ROOT);
  return { value, length };
}

const LINKS = ['Epics', 'Ouvrir le ticket', 'Voir au kanban'];
const SENTENCE = ['Ouvrir le ticket', 'Voir au kanban'];
/** 375 px : un téléphone (la barre mobile) ; 1280 px : le bureau (le fil d'Ariane). */
const VIEWPORTS = [375, 1280];

const EPIC = issue({ id: 'bdesk-e1', title: 'Une Epic', type: 'epic', priority: 1 });

/** Ouvre la page `path`, et rend le cadre de la page (celui qui porte « Epics », le titre et les liens) : la barre latérale et le fil d'Ariane ont aussi un lien « Epics ». */
async function openPage(path: string, title: string) {
  stubApi({ projects: projectsResponse, issues: { bdesk: [EPIC, issue({ id: 'bdesk-a', title: 'Un Enfant', parentId: EPIC.id })] } });
  renderApp(path);
  const heading = await screen.findByRole('heading', { level: 1, name: title });
  return within(heading.closest('header')?.parentElement as HTMLElement);
}

describe('la page Epic : les liens du haut, lus dans la feuille de style', () => {
  it.each(VIEWPORTS.flatMap((viewport) => LINKS.map((name) => [viewport, name] as const)))('à %i px, « %s » fait 24 px de haut au moins, et sa marge négative reprend les 2 px de chaque côté', async (viewport, name) => {
    const page = await openPage('/p/bdesk/epics?epic=bdesk-e1', 'Une Epic');

    const { length } = await declarationsOf(page.getByRole('link', { name }));

    expect(length('min-height', viewport), `hauteur minimale à ${viewport} px`).toBeGreaterThanOrEqual(24);
    expect(length('margin-block', viewport), `marge verticale à ${viewport} px`).toBe(-2);
  });

  it.each(VIEWPORTS)('à %i px, « Epics » prend toute la ligne, l’icône et le texte alignés', async (viewport) => {
    const page = await openPage('/p/bdesk/epics?epic=bdesk-e1', 'Une Epic');

    const { value } = await declarationsOf(page.getByRole('link', { name: 'Epics' }));

    expect(value('width', viewport), `largeur à ${viewport} px`).toBe('100%');
    expect(value('max-width', viewport) ?? 'none', `largeur maximale à ${viewport} px`).toBe('none');
    expect(value('display', viewport), `affichage à ${viewport} px`).toMatch(/^(inline-)?flex$/);
    expect(value('align-items', viewport), `alignement à ${viewport} px`).toBe('center');
  });

  it.each(VIEWPORTS.flatMap((viewport) => SENTENCE.map((name) => [viewport, name] as const)))('à %i px, le texte de « %s » reste en place : son rembourrage compense sa marge négative', async (viewport, name) => {
    const page = await openPage('/p/bdesk/epics?epic=bdesk-e1', 'Une Epic');

    const { length } = await declarationsOf(page.getByRole('link', { name }));

    expect(length('padding-block', viewport) + length('margin-block', viewport), `rembourrage et marge à ${viewport} px`).toBe(0);
  });

  it('range « Ouvrir le ticket » et « Voir au kanban » l’un sous l’autre sous 768 px, côte à côte dès 768 px', async () => {
    const page = await openPage('/p/bdesk/epics?epic=bdesk-e1', 'Une Epic');
    const phrase = page.getByRole('link', { name: 'Ouvrir le ticket' }).parentElement as HTMLElement;

    const { value } = await declarationsOf(phrase, UNREAD_PHRASE);

    expect(phrase.contains(page.getByRole('link', { name: 'Voir au kanban' })), 'les deux liens sont dans la même phrase').toBe(true);
    expect(value('display', 1280)).toBe('flex');
    for (const viewport of [175, 375, 767]) expect(value('flex-direction', viewport), `sens à ${viewport} px`).toBe('column');
    for (const viewport of [768, 1280]) expect(value('flex-direction', viewport) ?? 'row', `sens à ${viewport} px`).toBe('row');
  });

  it('écarte les deux liens empilés de 12 px sous 11 rem, et pas dès 11 rem : en dessous, la barre mobile n’a plus de zone libre à côté du bouton du Projet', async () => {
    const page = await openPage('/p/bdesk/epics?epic=bdesk-e1', 'Une Epic');
    const phrase = page.getByRole('link', { name: 'Ouvrir le ticket' }).parentElement as HTMLElement;
    const { length } = await declarationsOf(phrase, UNREAD_PHRASE);
    const { length: margin } = await declarationsOf(page.getByRole('link', { name: 'Ouvrir le ticket' }));

    // Entre les boîtes de deux liens empilés : l'écart de la phrase, plus la marge négative du lien du dessus (en bas) et celle du lien du dessous (en haut).
    const between = (viewport: number) => length('row-gap', viewport) + 2 * margin('margin-block', viewport);

    expect(between(175), 'écart entre les boîtes à 175 px').toBeGreaterThanOrEqual(12);
    for (const viewport of [176, 375, 767]) expect(between(viewport), `écart entre les boîtes à ${viewport} px`).toBe(0);
  });

  it.each([
    ['d’une Epic introuvable', '/p/bdesk/epics?epic=bdesk-zzz', 'Epic introuvable'],
    ['d’un ticket qui n’est pas une Epic', '/p/bdesk/epics?epic=bdesk-a', 'Ce n’est pas une Epic'],
  ])('« Epics » est le même lien, de 24 px et sur toute la ligne, à 375 et à 1280 px, sur la page %s', async (_page, path, title) => {
    const page = await openPage(path, title);

    const { value, length } = await declarationsOf(page.getByRole('link', { name: 'Epics' }));

    for (const viewport of VIEWPORTS) {
      expect(length('min-height', viewport), `hauteur minimale à ${viewport} px`).toBeGreaterThanOrEqual(24);
      expect(length('margin-block', viewport), `marge verticale à ${viewport} px`).toBe(-2);
      expect(value('width', viewport), `largeur à ${viewport} px`).toBe('100%');
      expect(value('max-width', viewport) ?? 'none', `largeur maximale à ${viewport} px`).toBe('none');
    }
  });
});
