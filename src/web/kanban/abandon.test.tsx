import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Issue } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { issue, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const closed = (overrides: Partial<Issue> & Pick<Issue, 'id' | 'title'>) =>
  issue({ status: 'closed', closedAt: ago(1), updatedAt: ago(1), ...overrides });

/**
 * Un Abandon (doublon, remplacé) est fermé comme une Livraison et rangé dans Terminé avec elles : la carte porte donc une
 * pastille « Abandon » pour qu'on ne le prenne pas pour du travail livré (relecture de bdesk-38k.7).
 */
describe('la pastille Abandon des cartes du kanban', () => {
  const ISSUES: Issue[] = [
    closed({ id: 'bdesk-1', title: 'Livré normalement' }),
    closed({ id: 'bdesk-2', title: 'Doublon du premier', abandon: { cause: 'duplicate', of: 'bdesk-1' } }),
    closed({ id: 'bdesk-3', title: 'Remplacé par un autre', abandon: { cause: 'superseded', of: 'bdesk-9' } }),
    issue({ id: 'bdesk-4', title: 'Encore ouvert' }),
  ];

  async function openDone() {
    stubApi({ projects: projectsResponse, issues: { bdesk: ISSUES } });
    renderApp('/p/bdesk/kanban');
    const done = await screen.findByRole('region', { name: 'Terminé' });
    const card = (title: string) => {
      const link = within(done).getByRole('link', { name: title });
      const item = link.closest('li');
      if (!item) throw new Error(`carte de « ${title} » introuvable`);
      return item;
    };
    return { card };
  }

  it('marque un doublon, et dit de quel ticket', async () => {
    const { card } = await openDone();

    const pill = within(card('Doublon du premier')).getByText('Abandon');

    expect(pill.getAttribute('title')).toBe('Abandon : doublon de bdesk-1');
    expect(within(card('Doublon du premier')).getByText(/doublon de bdesk-1/).textContent).toBe(' : doublon de bdesk-1');
  });

  it('marque un ticket remplacé, et dit par lequel', async () => {
    const { card } = await openDone();

    const pill = within(card('Remplacé par un autre')).getByText('Abandon');

    expect(pill.getAttribute('title')).toBe('Abandon : remplacé par bdesk-9');
  });

  it('laisse une Livraison sans pastille, comme un ticket qui n’est pas fermé', async () => {
    const { card } = await openDone();

    expect(within(card('Livré normalement')).queryByText('Abandon')).toBeNull();
    expect(screen.getAllByText('Abandon')).toHaveLength(2);
  });

  // WCAG 2.2, 2.5.8 (cible de 24 px au moins) : sur un écran étroit, un titre qui tient sur une ligne (18 px de haut) fait un lien trop
  // petit pour axe, que la pastille ou non. jsdom ne mesure rien : ce test garde la classe qui corrige la cause ; la mesure (axe, 375 px)
  // se fait en vrai navigateur, voir la preuve de bdesk-38k.10.
  it('donne au lien du titre une hauteur d’au moins 24 px, même quand le titre tient sur une ligne', async () => {
    const { card } = await openDone();

    for (const title of ['Livré normalement', 'Doublon du premier']) {
      const link = within(card(title)).getByRole('link', { name: title });
      expect(link.classList.contains('block'), title).toBe(true);
      expect(link.classList.contains('min-h-6'), title).toBe(true);
    }
  });

  it('garde le titre de la carte comme seul nom du lien qui l’ouvre : la pastille n’en fait pas partie', async () => {
    const { card } = await openDone();

    const link = within(card('Doublon du premier')).getByRole('link', { name: 'Doublon du premier' });

    expect(link.textContent).toBe('Doublon du premier');
    expect(link.getAttribute('href')).toBe('/p/bdesk/t/bdesk-2');
  });
});
