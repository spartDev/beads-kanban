import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { BLANK_SAMPLE, UNTITLED } from '../test/blankTitles';
import { issue, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

/**
 * Les tickets sans titre dans la palette (bdesk-38k.54). Une ligne de ticket ou d'Epic écrivait le titre tel quel : vide, fait d'espaces ou de caractères
 * sans largeur, il ne laissait qu'un texte invisible à côté de l'identifiant. La palette dit ce que disent le panneau, la carte du kanban et les listes
 * (bdesk-38k.50) : « Sans titre » (`ticketTitle`), puisque l'identifiant est écrit juste à côté.
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

describe.each(BLANK_SAMPLE)('la palette, pour des tickets dont le titre est %s', (_kind, blank) => {
  async function search(text: string) {
    stubApi({
      projects: projectsResponse,
      issues: {
        bdesk: [
          issue({ id: 'bdesk-zz1', title: blank }),
          issue({ id: 'bdesk-zze', title: blank, type: 'epic' }),
          issue({ id: 'bdesk-zzt', title: 'Un ticket qui a un titre' }),
          issue({ id: 'bdesk-zzu', title: '  Un   ticket \t à   espaces ' }),
        ],
      },
    });
    const app = renderApp('/p/bdesk/kanban');
    await screen.findByRole('navigation', { name: 'Navigation principale' });
    await app.user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    await app.user.keyboard(text);
    const listbox = within(dialog).getByRole('listbox');
    // La ligne du ticket (ou de l'Epic), pas l'action « Chercher dans tous les Projets », dont le nom cite aussi ce qu'on a tapé.
    return async (value: string) =>
      waitFor(() => {
        const option = within(listbox).getAllByRole('option').find((candidate) => candidate.getAttribute('data-value') === value);
        if (!option) throw new Error(`ligne « ${value} » absente de la palette`);
        return option;
      });
  }

  it('écrit « Sans titre » pour un ticket sans titre, à côté de son identifiant', async () => {
    const optionOf = await search('bdesk-zz1');

    const option = await optionOf('issue:bdesk/bdesk-zz1');

    expect(within(option).getByText(UNTITLED)).toBeTruthy();
    expect(within(option).getByText('bdesk-zz1')).toBeTruthy();
  });

  it('écrit « Sans titre » pour une Epic sans titre : elle a sa ligne, vers sa page', async () => {
    const optionOf = await search('bdesk-zze');

    const option = await optionOf('epic:bdesk/bdesk-zze');

    expect(within(option).getByText(UNTITLED)).toBeTruthy();
    expect(within(option).getByText('bdesk-zze')).toBeTruthy();
  });

  // Ce que la ligne affiche, la recherche le retrouve : « Sans titre » est écrit à côté de l'identifiant, on peut donc le chercher (le titre brut, lui, reste cherchable).
  it('retrouve les tickets sans titre quand on cherche « Sans titre », et eux seuls', async () => {
    const optionOf = await search('sans titre');

    await optionOf('issue:bdesk/bdesk-zz1');
    await optionOf('epic:bdesk/bdesk-zze');
    const values = screen.getAllByRole('option').map((option) => option.getAttribute('data-value'));
    expect(values).not.toContain('issue:bdesk/bdesk-zzt');
    expect(values).not.toContain('issue:bdesk/bdesk-zzu');
  });

  it('laisse à un ticket qui a un titre son titre', async () => {
    const optionOf = await search('bdesk-zzt');

    const option = await optionOf('issue:bdesk/bdesk-zzt');

    expect(within(option).getByText('Un ticket qui a un titre')).toBeTruthy();
    expect(within(option).queryByText(UNTITLED)).toBeNull();
  });

  it('range les espaces d’un titre : une seule espace entre les mots, aucune autour', async () => {
    const optionOf = await search('bdesk-zzu');

    const option = await optionOf('issue:bdesk/bdesk-zzu');

    // Sans `normalizer` : Testing Library replie déjà les espaces du texte qu'elle compare, et ne verrait pas les doubles.
    expect(within(option).getByText('Un ticket à espaces', { normalizer: (text) => text })).toBeTruthy();
  });
});
