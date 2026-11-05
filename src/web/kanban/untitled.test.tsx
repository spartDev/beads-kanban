import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Issue } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
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

/** Ce que l'interface écrit à la place du titre d'un ticket qui n'en a pas : le panneau (`IssuePanel.untitledEpic.test.tsx`) l'écrit de même. */
const UNTITLED = 'Sans titre';

/**
 * Les titres qui ne disent rien : vide, espaces, tabulation et saut de ligne, espace insécable (que `trim` retire aussi), et les caractères sans
 * largeur, que `trim` ne retire pas (catégorie Unicode `Cf` : U+200B à U+200D, U+2060, U+00AD) et qu'axe ne voit pas non plus : un lien nommé d'une
 * espace sans largeur n'a aucun nom pour un lecteur d'écran, sans qu'aucune règle automatique ne le signale.
 */
const BLANK_TITLES = [
  ['vide', ''],
  ['fait d’espaces', '   '],
  ['fait d’une tabulation et d’un saut de ligne', '\t\n '],
  ['fait d’une espace insécable', '\u00a0'],
  ['fait d’une espace sans largeur (U+200B)', '\u200b'],
  ['fait d’une marque d’ordre des octets (U+FEFF)', '\ufeff'],
  ['fait d’un antiliant et d’un liant sans chasse (U+200C, U+200D)', '\u200c\u200d'],
  ['fait d’un lien de mots (U+2060)', '\u2060'],
  ['fait d’un trait d’union conditionnel (U+00AD)', '\u00ad'],
  ['mêlé d’espaces et de caractères sans largeur', ' \u200b\t\u2060\u00a0'],
] as const;

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
