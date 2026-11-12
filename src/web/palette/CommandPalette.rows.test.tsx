import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Issue } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { classesOf, names, rulesFor, selectorOf, targetsPseudoElement } from '../test/compiledCss';
import { issue, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

/**
 * Une ligne de la palette ne bouge pas sous le doigt ni sous la souris (bdesk-38k.90). Le clic ou le toucher part de la ligne que le pointeur ou le doigt a sous lui à l'appui, et c'est celle-là qui doit s'ouvrir : si une ligne grandit ou se referme entre l'appui et
 * le relâchement, les lignes du dessous glissent sous un pointeur immobile, et le clic tombe sur une autre ligne, ou sur aucune. Une première version ouvrait la ligne que le clavier sélectionne (pour y montrer l'identifiant entier) et la refermait à l'appui : toucher une ligne après la frappe ouvrait un autre
 * ticket, et cliquer après une flèche ne faisait rien.
 *
 * jsdom ne met rien en page : la ligne qui bouge ne se voit donc pas, et ces tests ne prétendent pas la voir (c'est un navigateur qui la mesure : voir la preuve de bdesk-38k.90). Ils gardent ce qui rend le défaut impossible, sans dire comment la palette s'y prend :
 *   - aucune règle d'état (sélection, survol, focus, appui, attribut) ne change la taille ni la place d'une ligne ou de ce qu'elle contient : seulement des couleurs, des ombres, l'opacité, le curseur ;
 *   - un appui sur une ligne ne modifie rien dans la palette avant le clic ;
 *   - le clic, ou le toucher, ouvre la ligne sur laquelle il tombe, quelle que soit la ligne sélectionnée.
 * Une icône sans texte peut apparaître sur la ligne sélectionnée (l'icône « Entrée » : `display`) : elle n'a pas de texte à passer à la ligne, et ses voisines tiennent sur une ligne ou gardent leur largeur.
 */

withAsyncTimeout(5_000);

/** Des identifiants de 113 caractères sans occasion de coupure : les lignes de la palette y font plusieurs fois 36 px. */
const STEM = Array.from({ length: 30 }, (_, index) => `k${String(index + 1).padStart(3, '0')}`)
  .join('')
  .slice(0, 113);
const id = (tag: string) => `${STEM}-${tag}`;
const EPIC = issue({ id: id('e1'), title: 'Une Epic', type: 'epic', priority: 1 });
const TICKETS = ['c1', 'c2', 'c3', 'c4'].map((tag) => issue({ id: id(tag), title: `Ticket ${tag}`, parentId: EPIC.id }));
const ISSUES: Issue[] = [EPIC, ...TICKETS];

async function openPalette() {
  stubApi({ projects: projectsResponse, issues: { bdesk: ISSUES } });
  const app = renderApp('/p/bdesk/kanban');
  await screen.findByRole('navigation', { name: 'Navigation principale' });
  await app.user.keyboard('{Control>}k{/Control}');
  const dialog = within(await screen.findByRole('dialog', { name: 'Palette de commandes' }));
  return { ...app, dialog };
}

/** Tape le début des identifiants : les lignes de l'Epic et des tickets arrivent. */
async function typeIdentifiers(app: Awaited<ReturnType<typeof openPalette>>) {
  await app.user.keyboard(STEM.slice(0, 12));
  await app.dialog.findByText(id('c1'));
}

type Dialog = Awaited<ReturnType<typeof openPalette>>['dialog'];
const rowOf = (dialog: Dialog, tag: string) => dialog.getByText(id(tag)).closest('[cmdk-item]') as HTMLElement;
const rowsIn = (dialog: Dialog) => [...dialog.getByRole('listbox').querySelectorAll<HTMLElement>('[cmdk-item]')];

/** Ce qu'une règle d'état peut changer sans toucher à la taille ni à la place : couleurs, fonds, bordures (couleur, style), contours, ombres, opacité, curseur, décoration du texte, transitions. */
const VISUAL = /^(--|color$|background|border(-[a-z]+)*-(color|style|radius)$|opacity$|box-shadow$|outline|cursor$|fill$|stroke|text-decoration|caret-color$|accent-color$|user-select$|transition|animation|mix-blend-mode$|filter$|backdrop-filter$)/;

/** Le sélecteur sans ses groupes `:is()`, `:where()`, `:not()`, `:has()` : ce qui reste nomme l'élément que la règle vise et ses ancêtres directs, non l'ancêtre qui n'est là que pour la condition (`:where(.group\/item)[data-selected]` d'une variante `group-*`). */
function withoutConditions(selector: string): string {
  let result = '';
  for (let at = 0; at < selector.length; at++) {
    const rest = selector.slice(at);
    const group = /^:(?:is|where|not|has)\(/.exec(rest);
    if (!group) {
      if (selector[at] === '\\') result += selector[at++] ?? '';
      result += selector[at] ?? '';
      continue;
    }
    let depth = 0;
    for (let end = at + group[0].length - 1; end < selector.length; end++) {
      if (selector[end] === '\\') end++;
      else if (selector[end] === '(') depth++;
      else if (selector[end] === ')' && --depth === 0) {
        at = end;
        break;
      }
    }
  }
  return result;
}

/** Les règles d'état qui touchent à la taille ou à la place d'un de ces éléments : celles dont le sélecteur nomme une de ses classes autrement que seule, et qui déclarent autre chose que du visuel. */
async function stateRulesAffectingLayout(elements: readonly Element[]): Promise<string[]> {
  const sheet = await rulesFor([...new Set(elements.flatMap(classesOf))]);
  const found = new Set<string>();
  for (const element of elements) {
    const own = classesOf(element).map(selectorOf);
    for (const rule of sheet) {
      if (own.includes(rule.selector) || targetsPseudoElement(rule)) continue;
      if (!own.some((selector) => names({ ...rule, selector: withoutConditions(rule.selector) }, selector))) continue;
      const touched = Object.keys(rule.declarations).filter((property) => !VISUAL.test(property));
      // une icône sans texte peut apparaître : elle n'a rien à passer à la ligne
      if (touched.length === 0 || ((element.textContent ?? '').trim() === '' && touched.every((property) => property === 'display'))) continue;
      found.add(`<${element.tagName.toLowerCase()} class="${classesOf(element).join(' ')}"> : « ${rule.selector} » déclare ${touched.join(', ')}`);
    }
  }
  return [...found];
}

const elementsOfRows = (rows: readonly HTMLElement[]) => rows.flatMap((row) => [row, ...row.querySelectorAll('*')]);

describe('la palette : aucune règle d’état ne change la taille ni la place d’une ligne', () => {
  it('les lignes de commandes, de Projets, d’Epics et de tickets : sélection, survol, focus, appui ou attribut ne touchent qu’à leur apparence', async () => {
    const app = await openPalette();
    const before = await stateRulesAffectingLayout(elementsOfRows(rowsIn(app.dialog)));
    await typeIdentifiers(app);
    const after = await stateRulesAffectingLayout(elementsOfRows(rowsIn(app.dialog)));

    expect([...before, ...after]).toEqual([]);
  });

  it('la lecture voit une règle d’état qui change la taille, et laisse passer une icône qui apparaît', async () => {
    const row = document.createElement('div');
    row.setAttribute('class', 'group/item flex');
    const text = document.createElement('span');
    // Une classe de taille, sous l'état « sélectionnée » de la ligne : ce que faisait cette première version (sa coupure et son déploiement). Les noms des classes sont écrits en morceaux : Tailwind lit aussi ce fichier, et ces classes-là ne sont pas dans la feuille de production.
    const selected = 'group-data-[selected=true]/item';
    text.setAttribute('class', [[selected, 'overflow-hidden'].join(':'), [selected, 'text-ink-2'].join(':')].join(' '));
    text.textContent = 'texte';
    const icon = document.createElement('i');
    icon.setAttribute('class', ['hidden', [selected, 'block'].join(':')].join(' '));
    row.append(text, icon);

    const found = await stateRulesAffectingLayout([row, text, icon]);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/<span .*overflow-hidden.*déclare overflow/);
  });
});

describe('la palette : un appui sur une ligne ne modifie rien avant le clic', () => {
  /** Ce que la palette a changé dans son arbre entre l'appui et le clic (hors les effets du clic lui-même, qui ouvre la ligne et ferme la palette). */
  async function changesBetweenPressAndClick(press: () => Promise<void> | void) {
    const root = document.querySelector('[cmdk-root]') as HTMLElement;
    // Les enregistrements arrivent à l'observateur à chaque point de contrôle des microtâches (entre les événements d'un appui qui attend), ou restent en file (un appui d'un trait) : on prend les deux, jusqu'au clic.
    const records: MutationRecord[] = [];
    let clicked = false;
    const observer = new MutationObserver((list) => {
      if (!clicked) records.push(...list);
    });
    observer.observe(root, { subtree: true, attributes: true, childList: true, characterData: true });
    document.addEventListener(
      'click',
      () => {
        records.push(...observer.takeRecords());
        clicked = true;
      },
      { capture: true, once: true },
    );
    await press();
    observer.disconnect();
    return records.map((record) => `${record.type}${record.attributeName ? ` ${record.attributeName}` : ''} sur <${(record.target as Element).tagName?.toLowerCase()}>`);
  }

  it('à la souris : le pointeur est posé sur une ligne, une flèche sélectionne celle du dessus, puis appui et relâchement sans bouger', async () => {
    const app = await openPalette();
    await typeIdentifiers(app);
    const row = rowOf(app.dialog, 'c3');
    await app.user.hover(row);
    await waitFor(() => expect(row.getAttribute('aria-selected')).toBe('true'));
    await app.user.keyboard('{ArrowUp}');

    expect(await changesBetweenPressAndClick(() => app.user.pointer({ keys: '[MouseLeft]', target: row }))).toEqual([]);
  });

  it('au toucher : appui, relâchement, puis le clic que le navigateur envoie, après la frappe', async () => {
    const app = await openPalette();
    await typeIdentifiers(app);
    const row = rowOf(app.dialog, 'c3');

    const press = () => {
      fireEvent.pointerDown(row, { pointerType: 'touch', pointerId: 7, isPrimary: true });
      fireEvent.pointerUp(row, { pointerType: 'touch', pointerId: 7, isPrimary: true });
      fireEvent.mouseDown(row);
      fireEvent.mouseUp(row);
      fireEvent.click(row);
    };

    expect(await changesBetweenPressAndClick(press)).toEqual([]);
  });
});

describe('la palette : le clic, ou le toucher, ouvre la ligne sur laquelle il tombe', () => {
  const opens = async (tag: string) => {
    const panel = await screen.findByRole('dialog', { name: new RegExp(`Ticket ${tag}`) });
    expect(panel).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Palette de commandes' })).toBeNull();
  };

  it('après des flèches : la ligne cliquée, non la ligne sélectionnée', async () => {
    const app = await openPalette();
    await typeIdentifiers(app);
    await app.user.keyboard('{ArrowDown}{ArrowDown}');

    await app.user.click(rowOf(app.dialog, 'c4'));

    await opens('c4');
  });

  it('le pointeur est sur une ligne, la flèche haut sélectionne celle du dessus, et le clic part sans bouger : la ligne sous le pointeur', async () => {
    const app = await openPalette();
    await typeIdentifiers(app);
    const target = rowOf(app.dialog, 'c3');
    await app.user.hover(target);
    await waitFor(() => expect(target.getAttribute('aria-selected')).toBe('true'));

    await app.user.keyboard('{ArrowUp}');
    await app.user.click(target);

    await opens('c3');
  });

  it('au toucher, après la frappe : la ligne touchée, quelle que soit la ligne sélectionnée (la première, d’office)', async () => {
    const app = await openPalette();
    await typeIdentifiers(app);
    const row = rowOf(app.dialog, 'c3');

    fireEvent.pointerDown(row, { pointerType: 'touch', pointerId: 7, isPrimary: true });
    fireEvent.pointerUp(row, { pointerType: 'touch', pointerId: 7, isPrimary: true });
    fireEvent.mouseDown(row);
    fireEvent.mouseUp(row);
    fireEvent.click(row);

    await opens('c3');
  });
});
