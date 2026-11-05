import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { bdeskIssues, mpmIssues, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

/**
 * Les régions de statut de la palette portent un nom (bdesk-38k.65). Elle en a trois : l'attente des tickets, le message qui dit pourquoi la liste est vide (ou que les Projets n'ont pas chargé),
 * et le décompte que seuls les lecteurs d'écran lisent (« 12 résultats »). Sans nom, aucune ne dit de quoi elle rend compte. Les deux messages visibles disent « l'état de la recherche » (ils ne
 * sont jamais là ensemble : la palette attend ses tickets, ou n'a rien à montrer) ; le décompte en est un autre, et se nomme « Nombre de résultats » (la liste de résultats, elle, est nommée
 * « Suggestions » par cmdk). Les alertes de la palette (« Tickets indisponibles ») restent sans nom : une alerte se lit en entier, et un nom la ferait précéder d'un mot de trop.
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openPalette() {
  const app = renderApp('/');
  await screen.findByRole('navigation', { name: 'Navigation principale' });
  await app.user.keyboard('{Control>}k{/Control}');
  const dialog = await screen.findByRole('dialog', { name: 'Palette de commandes' });
  return { ...app, dialog };
}

const SEARCH_STATE = 'État de la recherche';
const RESULT_COUNT = 'Nombre de résultats';

describe('les régions de statut de la palette', () => {
  it('l’attente des tickets est « État de la recherche »', async () => {
    const fetchMock = stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });
    const healthy = fetchMock.getMockImplementation()!;
    // Les tickets n'arrivent jamais : la palette reste en attente.
    fetchMock.mockImplementation((input) => (String(input).endsWith('/issues') ? new Promise<Response>(() => undefined) : healthy(input)));

    const { dialog } = await openPalette();

    const loading = await within(dialog).findByRole('status', { name: SEARCH_STATE });
    expect(loading.textContent).toBe('Chargement des tickets…');
    expect(within(dialog).queryAllByRole('status', { name: '' })).toEqual([]);
  });

  it('le message de la liste vide est « État de la recherche », et le décompte « Nombre de résultats »', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });

    const { dialog, user } = await openPalette();
    await user.keyboard('zzzzzz');

    const empty = await within(dialog).findByRole('status', { name: SEARCH_STATE });
    expect(empty.textContent).toBe('Aucun résultat pour « zzzzzz ».');
    expect(within(dialog).getByRole('status', { name: RESULT_COUNT }).textContent).toBe('0 résultats');
    expect(within(dialog).queryAllByRole('status', { name: '' })).toEqual([]);
  });

  it('des Projets qui ne chargent pas : le message est « État de la recherche »', async () => {
    stubApi({ projects: new Error('serveur muet'), issues: {} });

    // Les commandes restent listées sans saisie : c'est une saisie sans résultat qui laisse la place au message.
    const { dialog, user } = await openPalette();
    await user.keyboard('zzzzzz');

    const failed = await within(dialog).findByRole('status', { name: SEARCH_STATE });
    expect(failed.textContent).toBe('Impossible de charger les Projets : le serveur ne répond pas.');
    expect(within(dialog).queryAllByRole('status', { name: '' })).toEqual([]);
  });

  it('avec des résultats, le décompte est « Nombre de résultats », et il n’y a pas d’autre statut', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });

    const { dialog, user } = await openPalette();
    await user.keyboard('shell');
    await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });

    const statuses = within(dialog).getAllByRole('status');
    expect(statuses.map((status) => status.getAttribute('aria-label'))).toEqual([RESULT_COUNT]);
    expect(statuses[0]?.textContent).toMatch(/^\d+ résultats$/);
  });

  it('sans saisie, le décompte est vide mais nommé : une région vide n’a rien d’anonyme', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });

    const { dialog } = await openPalette();

    const count = within(dialog).getByRole('status', { name: RESULT_COUNT });
    expect(count.textContent).toBe('');
  });

  it('les alertes restent sans nom : elles se lisent en entier', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: new Error('database is locked'), mpm: mpmIssues } });

    const { dialog } = await openPalette();

    const alert = await within(dialog).findByRole('alert');
    expect(alert.getAttribute('aria-label')).toBeNull();
    expect(alert.getAttribute('aria-labelledby')).toBeNull();
  });
});
