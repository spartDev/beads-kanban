import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { classesOf, declared, holds, lengthOf, names, resolved, rulesFor, seenBy, selectorOf, withoutImportant, wordsOf, type Rule } from '../test/compiledCss';
import { bdeskIssues } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

/**
 * La zone libre que la barre du haut laisse à côté de son bouton de Projet, sur mobile (bdesk-38k.84). La barre est collante : les cibles de la page qui défilent dessous, les résumés « Données du graphique » par exemple
 * (bdesk-38k.82), n'y sont recouvertes que par ses boutons, et `target-size` d'axe (WCAG 2.5.8, « Taille de la cible (minimum) ») veut qu'il en reste une zone libre de 24 px sur 24 : à côté du bouton du Projet, entre lui et
 * la recherche. Or le bouton du Projet prend toute la place que la recherche lui laisse (il rétrécit et tronque son nom) : plus le nom est long, plus il s'étend vers elle, jusqu'à 8 px, l'écart de la barre. À 375 px, un nom de
 * 21 caractères (`my-prompt-manager-app`) n'en laisse déjà que 23 : les sept résumés sont en violation (« partiallyObscured »), 14 positions de défilement chacun. La marge à droite du bouton réserve la zone, en la prenant sur
 * le nom ; mais le bouton ne rétrécit pas sous son rembourrage : plus étroite que 11 rem, la barre n'a plus de place pour la marge, qui y pousserait la recherche et le thème hors de la fenêtre.
 *
 * jsdom ne mesure rien. Ce test lit donc ce que les classes de la barre déclarent dans la feuille de style de l'application, compilée par Tailwind (la vraie, `styles.css`), à la largeur de fenêtre et à la taille de police racine
 * voulues : les conditions `@media` qui les enveloppent sont appliquées à la main, comme le fait le navigateur (technique de test/compiledCss.ts). La zone libre du pire cas, un bouton qui remplit sa ligne, est l'écart
 * de la barre plus la marge à droite du bouton. Ce que Chromium en fait (où finit le bouton, ce qu'axe dit à chaque position du défilement, la barre de bureau qui ne bouge pas à 1280 px) se mesure en vrai navigateur : voir la
 * preuve de bdesk-38k.84.
 *
 * Ce que ce test ne voit pas, et qu'il ne prétend donc pas garantir : il ne lit que les règles dont le sélecteur est une classe de l'élément, seule, et les conditions `@media` de largeur. Toute autre règle qui déclare une des
 * propriétés qu'il lit (un bloc `@supports` ou de conteneur, une couche dans une couche, un sélecteur qui nomme une classe de l'élément sans être elle seule) et toute variable déclarée plusieurs fois ou sous condition le font échouer, au lieu de passer
 * en silence ; à une exception près, pour les variables : les `--tw-*` que la couche `properties` de Tailwind redit, pour les navigateurs qui ne les enregistrent pas, à `initial` ou à la valeur initiale de leur `@property`, chaque fois qu'un
 * utilitaire de la feuille en pose une (celui de `leading-*`, par exemple : `variableOf`, test/compiledCss.ts). C'est la couche la plus basse de la feuille : l'utilitaire l'emporte, et sans lui la variable n'a pas de valeur ici. `--spacing`, elle,
 * n'a pas cette exception. Chaque élément lit ses variables dans ce qu'il voit (`seenBy`) : lui et ses ancêtres, jamais ses descendants ; et la `--tw-*` d'un ancêtre, que Tailwind déclare `inherits: false`, n'est pas la sienne (le `leading-*` de
 * la barre ne donne rien à la marge du bouton). Une règle de pseudo-élément n'est celle de personne (le `leading-*` d'une variante `before:` n'est pas celui du bouton) ; une règle qui n'est pas la classe seule (un état, une structure) fait refuser la
 * variable qu'elle pose. Une `--spacing` posée sur le bouton ne change donc pas l'écart de la barre, que la barre lit seule : le test la tue sur la barre et sur ses ancêtres, et sur le bouton quand sa marge la lit.
 * Le bouton lui-même doit aussi faire 24 px de haut au moins (bdesk-38k.87) : la zone libre ne fait pas sa cible. Sa classe de hauteur (`h-8`) lit `--spacing`, et une `--spacing` plus petite, posée sur le bouton, sur la barre ou sur un ancêtre,
 * le rétrécit (de 32 à 16 px, mesuré en navigateur) sans toucher à l'écart de la barre, que ce test garde ailleurs. Il lit `height`, `min-height` et `max-height`, physiques ou logiques ; quand ni la première ni la deuxième ne fixent la hauteur, elle est celle
 * du contenu, qu'il ne mesure pas : il échoue au lieu de la croire assez grande.
 * Les règles de `styles.css` écrites par nom d'élément (`header > button`), la position ou la largeur du bouton, et le voisin de droite échappent au test. Deux autres angles morts, du même ordre : un `style={…}` en ligne sur le bouton, que ses
 * classes ne montrent pas et qui passerait avant elles (cfdButton.test.tsx, lui, vérifie qu'il n'y en a pas) ; et la structure du DOM : le test lit l'écart (`gap`) de `closest('header')` et suppose que le bouton en est un enfant direct, sans
 * rien vérifier de cette hypothèse (un élément posé entre la barre et le bouton prendrait cet écart à sa place).
 */

withAsyncTimeout(5_000);
afterEach(() => vi.unstubAllGlobals());

/** La taille minimale d'une cible, en px (WCAG 2.5.8), et la tolérance d'axe sur elle. */
const TARGET = 24;
const TOLERANCE = 0.05;

/** Les polices racine que le test passe en revue, en px : de la plus petite (12) à « très grande » (24). Les 24 px de WCAG, eux, ne grandissent pas avec le texte ; l'écart de la barre (en `rem`), si. */
const ROOTS = [12, 14, 16, 20, 24];

/**
 * La largeur de fenêtre, en px, à partir de laquelle la barre a la place de la marge : 11 rem. Le bouton du Projet ne descend pas sous son rembourrage (12 px) : avec la marge (16 px), la recherche et le thème tiennent, rembourrage
 * de la barre compris, à partir de 173 px (mesuré en navigateur) ; 11 rem, un compte rond, laisse 3 px de plus. Plus étroite, la marge les pousserait hors de la fenêtre. Les requêtes de média comptent le `rem` à la taille de police par défaut du
 * navigateur (16 px, sauf réglage) : le seuil suit ce réglage, avec la barre, mais pas un `html { font-size }` posé par une feuille de style (feuille utilisateur, extension), qui grossit la barre sans le déplacer.
 */
const ROOM = 176;

/** Le Projet dont le ticket parle : 21 caractères, ce qui suffit, à 375 px, pour que la zone libre à côté de son bouton tombe sous 24 px (23,08 px, mesurés). */
const NAME = 'my-prompt-manager-app';
const project: Project = { id: 'bdesk', name: NAME, path: `/dev/${NAME}`, prefix: 'bdesk', mode: 'embedded', status: 'ok' };

/**
 * La propriété du rétrécissement d'un élément flex, écrite en morceaux : Tailwind lit aussi les fichiers de tests, et la propriété écrite d'un bloc, même dans un commentaire, y ferait naître la classe de même nom dans la
 * feuille de style de l'application.
 */
const FLEX_SHRINK = ['flex', 'sh' + 'rink'].join('-');

/** Les déclarations qui posent la largeur minimale du bouton : `min-width` et son écriture logique, celle de l'axe du texte (à l'horizontale). */
const MIN_WIDTH = ['min-width', 'min-inline-size'];

/** Les déclarations qui posent la hauteur du bouton, sa hauteur minimale et sa hauteur maximale : l'écriture physique et l'écriture logique (le bloc est la verticale : le texte est à l'horizontale). */
const HEIGHT = ['height', 'block-size'];
const MIN_HEIGHT = ['min-height', 'min-block-size'];
const MAX_HEIGHT = ['max-height', 'max-block-size'];

/** Les déclarations qui posent la marge à droite : `margin-right`, `margin-inline-end` et les raccourcis `margin` et `margin-inline`, dont elle est la deuxième valeur, ou la seule. */
const MARGIN_RIGHT = ['margin', 'margin-inline', 'margin-right', 'margin-inline-end'];
const rightOf = (property: string, value: string) => (property === 'margin' || property === 'margin-inline' ? (wordsOf(value)[1] ?? wordsOf(value)[0] ?? value) : value);

/**
 * Le facteur de rétrécissement d'une boîte flex à cette largeur de fenêtre (1, la valeur initiale, tant que rien ne le change), lu dans `flex` et dans sa propriété seule : le dernier des deux déclarés l'emporte. `flex: none`
 * (`0 0 auto`) et un facteur nul empêchent le bouton de rétrécir ; un nom long le ferait alors déborder, la recherche et le thème avec lui, hors de la fenêtre. Les `var(--…)` sont résolus ; une valeur qu'il ne sait pas lire
 * fait échouer le test plutôt que de passer pour un facteur de 1.
 */
function shrinkOf(sheet: readonly Rule[], rules: readonly Rule[], viewport: number): number {
  const unreadable = (value: string) => new Error(`Valeur de flex que ce test ne sait pas lire : ${value}`);
  const isNumber = (token: string) => /^\d*\.?\d+$/.test(token);
  let rate = 1;
  let important = false;
  for (const rule of rules) {
    const touched = Object.entries(rule.declarations).filter(([property]) => property === 'flex' || property === FLEX_SHRINK);
    if (touched.length === 0 || !rule.within.every((condition) => holds(condition, viewport))) continue;
    for (const [property, raw] of touched) {
      const declaration = withoutImportant(raw);
      if (important && !declaration.important) continue;
      important = declaration.important;
      const value = resolved(sheet, declaration.value).trim();
      if (value === 'initial' || (property === 'flex' && value === 'auto')) rate = 1;
      else if (property === FLEX_SHRINK) {
        if (!isNumber(value)) throw unreadable(value);
        rate = Number(value);
      } else if (value === 'none') rate = 0;
      else {
        if (/^(inherit|unset|revert|revert-layer)$/i.test(value)) throw unreadable(value);
        const numbers = value.split(/\s+/).filter(isNumber);
        rate = numbers.length >= 2 ? Number(numbers[1]) : 1;
      }
    }
  }
  return rate;
}

/** Les propriétés que ce test lit : une règle qui en déclare une doit être lue en entier, ou le test échoue. */
const READ = [...MARGIN_RIGHT, 'column-gap', 'gap', ...MIN_WIDTH, ...HEIGHT, ...MIN_HEIGHT, ...MAX_HEIGHT, 'display', 'flex', FLEX_SHRINK, 'overflow', 'text-overflow', 'white-space'];

/**
 * La vraie barre du haut, dans la vraie application, avec le Projet de la page : ce que ses classes déclarent (la barre, le bouton du Projet, son nom). La feuille compilée porte aussi les classes de tous leurs ancêtres, et chaque longueur se
 * lit dans ce que l'élément voit (`seenBy`, test/compiledCss.ts) : lui et ses ancêtres, jamais son nom ni un autre élément. Une variable qu'ils redéclarent y paraît, et fait échouer la lecture (`lengthOf`) ; une `--tw-*` n'y paraît que si l'élément
 * la pose lui-même. Une règle qui déclare une propriété lue et nomme une classe de l'élément autrement que seule (`header .classe`, `.classe:where(*)`) fait échouer le test.
 */
async function topBar() {
  stubApi({ projects: { projects: [project], ignored: [] }, issues: { bdesk: bdeskIssues } });
  renderApp('/p/bdesk/kanban');
  const switcher = await screen.findByRole('button', { name: `${NAME}, changer de Projet` });
  const header = switcher.closest('header');
  if (!header) throw new Error('Le bouton du Projet n’est pas dans la barre du haut.');
  const label = within(switcher).getByText(NAME);

  const chain: Element[] = [];
  for (let element: Element | null = switcher; element; element = element.parentElement) chain.push(element);
  const elements = [label, ...chain];
  const all = await rulesFor(elements.flatMap(classesOf));
  const declaredBy = (element: Element) => {
    const own = classesOf(element).map(selectorOf);
    return all.filter((rule) => {
      if (own.includes(rule.selector)) return true;
      const property = READ.find((read) => rule.declarations[read] !== undefined);
      if (property && own.some((selector) => names(rule, selector))) {
        throw new Error(`Règle que ce test ne sait pas lire : « ${rule.selector} » déclare ${property} et nomme une classe de l'élément sans en être seule`);
      }
      return false;
    });
  };
  return { header: declaredBy(header), switcher: declaredBy(switcher), label: declaredBy(label), sheet: { header: seenBy(all, header, elements), switcher: seenBy(all, switcher, elements) } };
}

/** La marge à droite du bouton, en px, à cette largeur de fenêtre et à cette taille de police racine : `0` quand aucune règle n'en pose. */
const rightMargin = (bar: Awaited<ReturnType<typeof topBar>>, viewport: number, root: number) => lengthOf(bar.sheet.switcher, declared(bar.switcher, MARGIN_RIGHT, viewport, rightOf) ?? '0px', root);

/**
 * La hauteur du bouton, en px, à cette largeur de fenêtre et à cette taille de police racine : celle que ses classes lui donnent (`height`), entre sa hauteur minimale et sa hauteur maximale. Ni `height` ni `min-height` (ou `auto`) : la hauteur est celle du
 * contenu, que ce test ne mesure pas, et il échoue au lieu de la deviner. Une longueur qu'il ne sait pas lire (`100%`, `fit-content`) le fait échouer de même.
 */
function heightOf(bar: Awaited<ReturnType<typeof topBar>>, viewport: number, root: number): number {
  const read = (properties: readonly string[]) => {
    const value = declared(bar.switcher, properties, viewport);
    return value === undefined || value === 'auto' || value === 'none' ? undefined : lengthOf(bar.sheet.switcher, value, root);
  };
  const height = read(HEIGHT);
  const min = read(MIN_HEIGHT);
  if (height === undefined && min === undefined) throw new Error('Hauteur du bouton que ce test ne sait pas lire : ni `height` ni `min-height` ne la fixent, elle est celle de son contenu');
  return Math.max(min ?? 0, Math.min(height ?? 0, read(MAX_HEIGHT) ?? Infinity));
}

describe('la barre du haut, sur mobile : la zone libre à côté du bouton du Projet', () => {
  // Le bouton du Projet remplit sa ligne quand le nom est long : ce qui sépare alors son bord droit du bouton de la recherche est l'écart de la barre (`gap`) et la marge à droite du bouton. Plus court, le nom laisse plus.
  it.each([ROOM, 188, 320, 375, 767])('fait 24 px au moins, à %i px de large et à toute taille de texte, même quand le nom du Projet remplit le bouton', async (viewport) => {
    const bar = await topBar();

    for (const root of ROOTS) {
      const gap = lengthOf(bar.sheet.header, declared(bar.header, ['column-gap', 'gap'], viewport) ?? '0px', root);
      const margin = rightMargin(bar, viewport, root);

      expect(
        gap + margin + TOLERANCE,
        `police racine de ${root} px : l'écart de la barre (${gap} px) et la marge à droite du bouton du Projet (${margin} px) laissent ${gap + margin} px libres entre lui et la recherche : il en faut ${TARGET}`,
      ).toBeGreaterThanOrEqual(TARGET);
    }
  });

  // Plus étroite que `ROOM`, la barre n'a plus la place de la marge : le bouton ne rétrécit plus sous son rembourrage, la marge pousserait la recherche et le thème hors de la fenêtre (à 160 px, un zoom de 200 % sur 320 px).
  it.each([120, 160, ROOM - 1])("ne pose pas de marge à %i px de large, où la barre n'a plus la place : elle pousserait la recherche et le thème hors de la fenêtre", async (viewport) => {
    const bar = await topBar();

    for (const root of ROOTS) {
      const margin = rightMargin(bar, viewport, root);

      expect(margin, `police racine de ${root} px : la marge à droite du bouton du Projet vaut ${margin} px à ${viewport} px de large : sous ${ROOM} px (11 rem), la barre n'a plus la place de la marge`).toBe(0);
    }
  });

  // La marge ne réserve rien à un bouton qui ne rétrécit pas : un nom long le ferait déborder, la recherche et le thème avec lui, hors de la fenêtre (à 320 px, avec 68 caractères, il s'étend alors jusqu'à 471 px). Il rétrécit
  // (largeur minimale nulle, facteur de rétrécissement non nul) et le nom se tronque.
  it('laisse le bouton rétrécir et son nom se tronquer : la place réservée à droite se prend sur le nom', async () => {
    const bar = await topBar();

    for (const viewport of [120, 160, ROOM, 320, 375, 767]) {
      const minWidth = declared(bar.switcher, MIN_WIDTH, viewport);
      expect(minWidth === undefined || minWidth === 'auto' ? 'auto' : lengthOf(bar.sheet.switcher, minWidth, 16), `largeur minimale du bouton à ${viewport} px : « auto » l'empêche de rétrécir sous son nom`).toBe(0);
      expect(shrinkOf(bar.sheet.switcher, bar.switcher, viewport), `facteur de rétrécissement du bouton à ${viewport} px : nul, il ne rétrécit plus et déborde sur la recherche`).toBeGreaterThan(0);
    }
    expect(Object.fromEntries(['overflow', 'text-overflow', 'white-space'].map((property) => [property, declared(bar.label, [property], 375)]))).toEqual({
      overflow: 'hidden',
      'text-overflow': 'ellipsis',
      'white-space': 'nowrap',
    });
  });

  // Dès 768 px la barre est celle du bureau (le fil d'Ariane) : le bouton n'y est pas, sa marge ne déplace donc rien à 1280 px.
  it('disparaît dès 768 px, où la barre de bureau prend le relais : sa marge ne change rien à la barre de 1280 px', async () => {
    const bar = await topBar();

    expect(declared(bar.switcher, ['display'], 767)).toBe('flex');
    expect(declared(bar.switcher, ['display'], 768)).toBe('none');
  });
});

describe('le bouton du Projet, sur mobile : sa cible', () => {
  // La zone libre à côté du bouton n'est pas sa cible : lui-même fait 24 px de haut au moins (`h-8` : 32 px). Sa hauteur lit `--spacing` (en `rem`) : une surcharge qui la réduit, sur le bouton, sur la barre ou sur un ancêtre, passe sous 24 px sans toucher
  // à l'écart de la barre.
  it('fait 24 px de haut au moins, à toute largeur de fenêtre et à toute taille de texte', async () => {
    const bar = await topBar();

    for (const viewport of [120, 160, ROOM, 188, 320, 375, 767]) {
      for (const root of ROOTS) {
        const height = heightOf(bar, viewport, root);

        expect(height + TOLERANCE, `police racine de ${root} px : le bouton du Projet fait ${height} px de haut à ${viewport} px de large, il en faut ${TARGET}`).toBeGreaterThanOrEqual(TARGET);
      }
    }
  });
});
