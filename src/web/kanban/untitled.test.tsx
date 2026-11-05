import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Issue } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { BLANK_TITLES, UNTITLED } from '../test/blankTitles';
import { issue, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

/**
 * La carte d'un ticket sans titre (bdesk-38k.50). Le lien d'une carte est son titre, étiré sur toute la carte : un titre vide (ou fait d'espaces,
 * une base modifiée à la main) en fait un lien sans nom accessible (axe `link-name`, WCAG 2.4.4 et 4.1.2), que le clavier et les lecteurs d'écran
 * ne savent pas annoncer. La carte le nomme comme le panneau du ticket (bdesk-38k.39) : « Sans titre », puisque son identifiant est déjà dit juste
 * au-dessus, dans la même carte (le nommer deux fois n'apprendrait rien). Une Epic n'est jamais une carte : sa règle, l'identifiant, est celle de
 * `epicName` (`epics.test.ts`).
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

const ISSUES: Issue[] = [
  issue({ id: 'bdesk-pret', title: '', status: 'open' }),
  issue({ id: 'bdesk-cours', title: '   ', status: 'in_progress' }),
  issue({ id: 'bdesk-bloque', title: '', status: 'blocked' }),
  issue({ id: 'bdesk-livre', title: '', status: 'closed', closedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
  issue({ id: 'bdesk-titre', title: 'Un ticket qui a un titre' }),
];

async function openBoard(issues: Issue[] = ISSUES) {
  stubApi({ projects: projectsResponse, issues: { bdesk: issues } });
  const app = renderApp('/p/bdesk/kanban');
  await screen.findByRole('region', { name: 'Prêt' });
  const card = (id: string) => {
    const item = document.querySelector<HTMLElement>(`li[data-card-id="${id}"]`);
    if (!item) throw new Error(`carte de « ${id} » introuvable`);
    return item;
  };
  return { ...app, card };
}

describe('le lien de la carte d’un ticket sans titre', () => {
  it.each(BLANK_TITLES)('est nommé « Sans titre » quand le titre est %s', async (_kind, title) => {
    const { card } = await openBoard([issue({ id: 'bdesk-vide', title }), issue({ id: 'bdesk-titre', title: 'Un ticket qui a un titre' })]);

    const link = within(card('bdesk-vide')).getByRole('link', { name: UNTITLED });

    expect(link.textContent).toBe(UNTITLED);
    expect(link.getAttribute('href')).toBe('/p/bdesk/t/bdesk-vide');
  });

  it('a un nom dans chaque colonne : prêt, en cours, bloqué, terminé', async () => {
    const { card } = await openBoard();

    for (const id of ['bdesk-pret', 'bdesk-cours', 'bdesk-bloque', 'bdesk-livre']) {
      const link = within(card(id)).getByRole('link', { name: UNTITLED });
      expect(link.getAttribute('href'), id).toBe(`/p/bdesk/t/${id}`);
    }
    expect(screen.getAllByText(UNTITLED)).toHaveLength(4); // les quatre cartes sans titre, et aucune autre
  });

  it('laisse à un ticket qui a un titre son titre pour nom : « Sans titre » ne le remplace pas', async () => {
    const { card } = await openBoard();

    const link = within(card('bdesk-titre')).getByRole('link', { name: 'Un ticket qui a un titre' });

    expect(link.textContent).toBe('Un ticket qui a un titre');
    expect(within(card('bdesk-titre')).queryByText(UNTITLED)).toBeNull();
  });

  it('laisse à un titre qui contient un caractère sans largeur, mais aussi du texte, ce titre : seul un titre fait uniquement de blancs est remplacé', async () => {
    const title = 'Un titre\u200b avec une césure\u00ad';
    const { card } = await openBoard([issue({ id: 'bdesk-zw', title })]);

    const link = card('bdesk-zw').querySelector('a[data-card-link]');

    expect(link?.textContent).toBe(title);
    expect(within(card('bdesk-zw')).queryByText(UNTITLED)).toBeNull();
  });

  it('rogne les blancs autour d’un titre qui a du texte, comme le panneau le faisait déjà : ni espace ni saut de ligne en tête ou en queue du lien', async () => {
    const { card } = await openBoard([issue({ id: 'bdesk-marge', title: ' \n Un titre entouré de blancs\t ' })]);

    const link = card('bdesk-marge').querySelector('a[data-card-link]');

    expect(link?.textContent).toBe('Un titre entouré de blancs');
  });

  it('laisse chaque lien de chaque carte avec un nom, la pastille d’Epic comprise : aucun lien sans nom sur le tableau', async () => {
    const epic = issue({ id: 'bdesk-epic', title: 'Une Epic', type: 'epic' });
    const { card } = await openBoard([...ISSUES, epic, issue({ id: 'bdesk-fils', title: '', parentId: epic.id })]);

    const cards = [...document.querySelectorAll<HTMLElement>('li[data-card-id]')];
    expect(cards).toHaveLength(6);
    for (const item of cards) {
      const links = item.querySelectorAll('a');
      expect(links.length, item.dataset.cardId).toBeGreaterThan(0);
      expect(within(item).getAllByRole('link', { name: /\S/ }), item.dataset.cardId).toHaveLength(links.length);
    }
    expect(within(card('bdesk-fils')).getByRole('link', { name: 'Epic : Une Epic' })).toBeTruthy(); // la pastille de l'Epic, nommée de son titre
  });

  it('ouvre un panneau qui porte le même nom : « Sans titre », sous l’identifiant', async () => {
    const { card, user } = await openBoard();

    await user.click(within(card('bdesk-pret')).getByRole('link', { name: UNTITLED }));

    const dialog = await screen.findByRole('dialog', { name: `bdesk-pret ${UNTITLED}` });
    expect(within(dialog).getByRole('heading', { level: 2, name: UNTITLED })).toBeTruthy();
  });

  it('ouvre, pour un titre sans largeur, un panneau dont le titre de niveau 2 n’est pas invisible : « Sans titre » aussi', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: [issue({ id: 'bdesk-zw', title: '\u200b' })] } });
    renderApp('/p/bdesk/t/bdesk-zw');

    const dialog = await screen.findByRole('dialog', { name: `bdesk-zw ${UNTITLED}` });

    expect(within(dialog).getByRole('heading', { level: 2, name: UNTITLED })).toBeTruthy();
  });
});

/**
 * Plusieurs cartes sans titre ont le même nom, « Sans titre » : au Tab, ou dans la liste des liens d'un lecteur d'écran, rien ne les départage (axe
 * `identical-links-same-purpose`, WCAG 2.4.9). L'identifiant est dit juste avant le lien, dans la carte, et le lire dans le nom du lien le ferait dire
 * deux fois (lecture continue) : le lien est donc décrit par lui (`aria-describedby`) : le nom ne change pas, et un lien focalisé annonce
 * « Sans titre, lien, bdesk-pret ». Au curseur de VoiceOver, qui lit la description après le nom, l'identifiant reste dit deux fois : compromis connu.
 */
describe('le lien d’une carte est décrit par l’identifiant de sa carte', () => {
  const linkOf = (item: HTMLElement) => {
    const link = item.querySelector<HTMLAnchorElement>('a[data-card-link]');
    if (!link) throw new Error(`lien de la carte de « ${item.dataset.cardId} » introuvable`);
    return link;
  };
  /** Ce que le lien déclare pour description : le texte des éléments qu'il désigne. */
  const described = (link: HTMLElement) =>
    (link.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id));

  it('pointe, pour chaque carte, vers l’identifiant écrit dans cette même carte', async () => {
    const { card } = await openBoard();

    for (const id of ['bdesk-pret', 'bdesk-cours', 'bdesk-bloque', 'bdesk-livre', 'bdesk-titre']) {
      const targets = described(linkOf(card(id)));
      expect(targets, id).toHaveLength(1);
      expect(targets[0]?.textContent, id).toBe(id);
      expect(card(id).contains(targets[0] ?? null), id).toBe(true);
    }
  });

  it('distingue ainsi plusieurs cartes « Sans titre » : une description différente chacune', async () => {
    const { card } = await openBoard();

    const links = ['bdesk-pret', 'bdesk-cours', 'bdesk-bloque', 'bdesk-livre'].map((id) => linkOf(card(id)));

    expect(links.map((link) => link.textContent)).toEqual([UNTITLED, UNTITLED, UNTITLED, UNTITLED]);
    expect(links.map((link) => described(link)[0]?.textContent)).toEqual(['bdesk-pret', 'bdesk-cours', 'bdesk-bloque', 'bdesk-livre']);
  });

  it('distingue de même deux tickets qui portent le même titre', async () => {
    const { card } = await openBoard([issue({ id: 'bdesk-a', title: 'Corriger le bug' }), issue({ id: 'bdesk-b', title: 'Corriger le bug' })]);

    expect(described(linkOf(card('bdesk-a')))[0]?.textContent).toBe('bdesk-a');
    expect(described(linkOf(card('bdesk-b')))[0]?.textContent).toBe('bdesk-b');
  });

  it('ne donne à deux cartes aucun identifiant d’élément en commun : une référence ne désigne qu’un élément', async () => {
    const { card } = await openBoard();

    const references = ['bdesk-pret', 'bdesk-cours', 'bdesk-bloque', 'bdesk-livre', 'bdesk-titre'].map((id) => linkOf(card(id)).getAttribute('aria-describedby'));

    expect(references.every(Boolean)).toBe(true);
    expect(new Set(references).size).toBe(references.length);
    for (const reference of references) expect(document.querySelectorAll(`[id="${reference}"]`)).toHaveLength(1);
  });

  it('laisse au lien son nom : l’identifiant le décrit, il ne le prolonge pas', async () => {
    const { card } = await openBoard();

    expect(within(card('bdesk-pret')).getByRole('link', { name: UNTITLED })).toBe(linkOf(card('bdesk-pret')));
    expect(within(card('bdesk-titre')).getByRole('link', { name: 'Un ticket qui a un titre' })).toBe(linkOf(card('bdesk-titre')));
  });
});

describe('le titre d’une carte range ses espaces comme celui d’une Epic', () => {
  it('replie les espaces intérieurs en une seule : « Un   titre » se lit « Un titre »', async () => {
    const { card } = await openBoard([issue({ id: 'bdesk-esp', title: ' Un   titre \n\t à   espaces  ' })]);

    expect(card('bdesk-esp').querySelector('a[data-card-link]')?.textContent).toBe('Un titre à espaces');
  });
});
