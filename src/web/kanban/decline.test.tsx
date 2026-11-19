import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Issue } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { issue, projectsResponse } from '../test/fixtures';
import { setBrowserLanguages } from '../test/languages';
import { renderApp, stubApi } from '../test/render';

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const closed = (overrides: Partial<Issue> & Pick<Issue, 'id' | 'title'>) =>
  issue({ status: 'closed', closedAt: ago(1), updatedAt: ago(1), ...overrides });

const ISSUES: Issue[] = [
  closed({ id: 'bdesk-1', title: 'Livré normalement' }),
  closed({ id: 'bdesk-2', title: 'Décidé de ne pas le faire', declined: true }),
  closed({ id: 'bdesk-3', title: 'Doublon du premier', abandon: { cause: 'duplicate', of: 'bdesk-1' } }),
];

/** Le kanban d'un Projet, dans la langue du navigateur ; `card` trouve la carte d'un ticket dans la colonne `done`. */
async function openDone(done: string, languageSwitch?: boolean) {
  stubApi({ projects: projectsResponse, issues: { bdesk: ISSUES } });
  renderApp('/p/bdesk/kanban', languageSwitch ? { languageSwitch } : {});
  const column = await screen.findByRole('region', { name: done });
  return (title: string) => {
    const item = within(column).getByRole('link', { name: title }).closest('li');
    if (!item) throw new Error(`carte de « ${title} » introuvable`);
    return item;
  };
}

/**
 * Un Renoncement (ADR 0008) est fermé et rangé dans Terminé, comme une Livraison ou un Abandon : sa carte porte une pastille
 * « Renoncement » pour qu'on ne le prenne ni pour du travail livré ni pour un doublon.
 */
describe('la pastille Renoncement des cartes du kanban', () => {
  it('marque un Renoncement, et dit pourquoi à l’infobulle et aux lecteurs d’écran', async () => {
    const card = await openDone('Terminé');

    const pill = within(card('Décidé de ne pas le faire')).getByText('Renoncement');

    expect(pill.getAttribute('title')).toBe('Renoncement : décidé de ne pas le faire');
    expect(pill.textContent).toBe('Renoncement : décidé de ne pas le faire');
    expect(within(card('Décidé de ne pas le faire')).queryByText('Abandon')).toBeNull();
  });

  it('ne marque ni une Livraison ni un Abandon, qui garde sa propre pastille', async () => {
    const card = await openDone('Terminé');

    expect(within(card('Livré normalement')).queryByText('Renoncement')).toBeNull();
    expect(within(card('Doublon du premier')).queryByText('Renoncement')).toBeNull();
    expect(within(card('Doublon du premier')).getByText('Abandon')).toBeTruthy();
    expect(screen.getAllByText('Renoncement')).toHaveLength(1);
  });

  it('garde le titre de la carte comme seul nom du lien qui l’ouvre', async () => {
    const card = await openDone('Terminé');

    expect(within(card('Décidé de ne pas le faire')).getByRole('link', { name: 'Décidé de ne pas le faire' }).textContent).toBe('Décidé de ne pas le faire');
  });
});

describe('the Decline pill of kanban cards, in English', () => {
  beforeEach(() => {
    setBrowserLanguages(['en-US']);
  });

  it('marks a Decline with the glossary’s term, and says why', async () => {
    const card = await openDone('Done', true);

    const pill = within(card('Décidé de ne pas le faire')).getByText('Decline');

    expect(pill.getAttribute('title')).toBe('Decline: decided not to do it');
    expect(pill.textContent).toBe('Decline: decided not to do it');
    expect(within(card('Doublon du premier')).getByText('Dropped')).toBeTruthy();
    expect(within(card('Livré normalement')).queryByText('Decline')).toBeNull();
  });
});
