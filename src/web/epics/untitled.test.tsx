import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Issue } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { BLANK_SAMPLE, BLANK_TITLES, UNTITLED } from '../test/blankTitles';
import { issue, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

/**
 * Les tickets sans titre dans les pages Epic (bdesk-38k.54). Une ligne d'Enfant, un élément de la liste des Epics et la note « Ce n'est pas une Epic »
 * écrivaient le titre tel quel : vide, fait d'espaces ou de caractères sans largeur, il ne laissait que l'identifiant, et un texte invisible à côté. Ils
 * disent ce que disent le panneau et la carte du kanban (bdesk-38k.50) : « Sans titre » (`ticketTitle`), puisque l'identifiant est écrit juste à côté.
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

const EPIC = issue({ id: 'bdesk-e1', title: 'Une Epic', type: 'epic', priority: 1 });
const WITNESS = 'Un Enfant qui a un titre';

/** Un Enfant de `EPIC` par genre de titre vide, et un témoin qui a un titre. */
const children: Issue[] = [
  ...BLANK_TITLES.map(([, title], index) => issue({ id: `bdesk-b${index}`, title, parentId: EPIC.id })),
  issue({ id: 'bdesk-ok', title: WITNESS, parentId: EPIC.id }),
];

/** La ligne (le lien) d'un ticket : vers son panneau, ou vers sa page quand c'est une Epic. */
const row = (href: string) => {
  const link = document.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
  if (!link) throw new Error(`ligne « ${href} » introuvable`);
  return link;
};

async function open(path: string, issues: Issue[], heading: string | RegExp) {
  stubApi({ projects: projectsResponse, issues: { bdesk: issues } });
  const app = renderApp(path);
  await screen.findByRole('heading', { level: 1, name: heading });
  return app;
}

describe.each([
  ['rangés par colonne', '/p/bdesk/epics?epic=bdesk-e1'],
  ['en arborescence', '/p/bdesk/epics?epic=bdesk-e1&view=tree'],
])('la page Epic, Enfants %s', (_view, path) => {
  it('écrit « Sans titre » pour chaque Enfant dont le titre ne dit rien, quel qu’il soit', async () => {
    await open(path, [EPIC, ...children], 'Une Epic');

    BLANK_TITLES.forEach(([kind], index) => {
      const id = `bdesk-b${index}`;
      const link = row(`/p/bdesk/t/${id}`);
      expect(within(link).getByText(UNTITLED), `${id} (${kind})`).toBeTruthy();
      expect(link.textContent, id).toContain(id);
    });
    expect(screen.getAllByText(UNTITLED)).toHaveLength(BLANK_TITLES.length); // chaque Enfant sans titre, et aucun autre
  });

  it('laisse à un Enfant qui a un titre son titre, sans « Sans titre » à côté', async () => {
    await open(path, [EPIC, ...children], 'Une Epic');

    const link = row('/p/bdesk/t/bdesk-ok');

    expect(within(link).getByText(WITNESS)).toBeTruthy();
    expect(within(link).queryByText(UNTITLED)).toBeNull();
  });

  it('nomme chaque ligne sans titre par son identifiant et « Sans titre » : un lien qui dit de quoi il s’agit', async () => {
    await open(path, [EPIC, ...children], 'Une Epic');

    // `\s*` : jsdom ne met aucune espace entre les éléments d'une ligne, que le navigateur sépare (ce sont des éléments flex).
    expect(screen.getByRole('link', { name: /bdesk-b0\s*Sans titre/ })).toBe(row('/p/bdesk/t/bdesk-b0'));
    expect(screen.getByRole('link', { name: /bdesk-b4\s*Sans titre/ })).toBe(row('/p/bdesk/t/bdesk-b4'));
  });

  it('écrit « Sans titre » pour une Epic imbriquée dont le titre ne dit rien : sa ligne mène à sa page', async () => {
    const nested = issue({ id: 'bdesk-n1', title: '​', type: 'epic', parentId: EPIC.id });
    await open(path, [EPIC, nested, issue({ id: 'bdesk-n2', title: 'Un petit-enfant', parentId: nested.id })], 'Une Epic');

    const link = row('/p/bdesk/epics?epic=bdesk-n1');

    expect(within(link).getByText(UNTITLED)).toBeTruthy();
  });

  it('range les espaces d’un titre comme ceux d’une Epic : une seule espace entre les mots, aucune autour', async () => {
    await open(path, [EPIC, issue({ id: 'bdesk-esp', title: '  Un   titre \n\t à   espaces ', parentId: EPIC.id })], 'Une Epic');

    // Sans `normalizer` : Testing Library replie déjà les espaces du texte qu'elle compare, et ne verrait pas les doubles.
    expect(within(row('/p/bdesk/t/bdesk-esp')).getByText('Un titre à espaces', { normalizer: (text) => text })).toBeTruthy();
  });
});

describe('la liste des Epics', () => {
  /** La liste, dès qu'elle est là : le titre de la page, lui, est écrit avant que les tickets arrivent. */
  async function openList(issues: Issue[]) {
    const app = await open('/p/bdesk/epics', issues, 'Epics');
    await screen.findByRole('list', { name: 'Epics ouvertes' });
    return app;
  }

  /** Une Epic par genre de titre vide, et un témoin qui a un titre. */
  const epics: Issue[] = [
    ...BLANK_TITLES.map(([, title], index) => issue({ id: `bdesk-v${index}`, title, type: 'epic' })),
    issue({ id: 'bdesk-t1', title: 'Une Epic qui a un titre', type: 'epic' }),
  ];

  it('écrit « Sans titre » pour chaque Epic dont le titre ne dit rien, à côté de son identifiant', async () => {
    await openList(epics);

    BLANK_TITLES.forEach(([kind], index) => {
      const id = `bdesk-v${index}`;
      const link = row(`/p/bdesk/epics?epic=${id}`);
      expect(within(link).getByText(UNTITLED), `${id} (${kind})`).toBeTruthy();
      expect(within(link).getByText(id), id).toBeTruthy();
    });
    expect(screen.getAllByText(UNTITLED)).toHaveLength(BLANK_TITLES.length); // chaque Epic sans titre, et aucune autre
  });

  it('laisse à une Epic qui a un titre son titre', async () => {
    await openList(epics);

    const link = row('/p/bdesk/epics?epic=bdesk-t1');

    expect(within(link).getByText('Une Epic qui a un titre')).toBeTruthy();
    expect(within(link).queryByText(UNTITLED)).toBeNull();
  });

  it('nomme le lien d’une Epic sans titre de son identifiant et de « Sans titre »', async () => {
    await openList(epics);

    // `\s*` : jsdom ne met aucune espace entre les éléments d'une ligne, que le navigateur sépare (ce sont des éléments flex).
    expect(screen.getByRole('link', { name: /Epic\s*bdesk-v0\s*Sans titre/ })).toBe(row('/p/bdesk/epics?epic=bdesk-v0'));
  });

  it('range les espaces du titre d’une Epic', async () => {
    await openList([issue({ id: 'bdesk-esp', title: '  Une   Epic \t à   espaces ', type: 'epic' })]);

    expect(within(row('/p/bdesk/epics?epic=bdesk-esp')).getByText('Une Epic à espaces', { normalizer: (text) => text })).toBeTruthy();
  });
});

describe('la note « Ce n’est pas une Epic »', () => {
  it.each(BLANK_SAMPLE)('ne laisse pas un titre %s en paragraphe vide : « Sans titre »', async (_kind, title) => {
    await open('/p/bdesk/epics?epic=bdesk-t', [issue({ id: 'bdesk-t', title })], 'Ce n’est pas une Epic');

    expect(screen.getByText(UNTITLED)).toBeTruthy();
    expect(screen.getByText(UNTITLED).tagName).toBe('P');
  });

  it('dit le titre d’un ticket qui en a un', async () => {
    await open('/p/bdesk/epics?epic=bdesk-t', [issue({ id: 'bdesk-t', title: 'Un ticket qui a un titre' })], 'Ce n’est pas une Epic');

    expect(screen.getByText('Un ticket qui a un titre')).toBeTruthy();
    expect(screen.queryByText(UNTITLED)).toBeNull();
  });
});
