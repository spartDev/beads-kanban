import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '../data/hooks';
import { bdeskIssues, mpmIssues, projectsResponse } from '../test/fixtures';
import { failRequests, renderApp, stubApi } from '../test/render';

/**
 * TanStack Query garde `data` quand un rafraîchissement échoue (le statut passe à « error »). Une page déjà
 * affichée ne doit pas être remplacée par l'écran d'erreur : l'erreur n'a la parole que faute de données.
 */

const stubDefaultApi = () => stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });

type App = ReturnType<typeof renderApp>;

/** Le serveur flanche : le prochain rafraîchissement de `queryKey` échoue, les données en cache restent. */
async function refreshFails(
  { queryClient }: App,
  fetchMock: ReturnType<typeof stubApi>,
  queryKey: readonly unknown[],
  endpoint: string,
) {
  const repair = failRequests(fetchMock, (url) => url === endpoint);
  await act(() => queryClient.refetchQueries({ queryKey, exact: true }).catch(() => undefined));
  await waitFor(() => expect(queryClient.getQueryState(queryKey)?.status).toBe('error'));
  expect(queryClient.getQueryData(queryKey), 'les données du cache sont toujours là').toBeTruthy();
  return repair;
}

describe('un rafraîchissement des Projets en échec', () => {
  it('garde la page du Projet : le kanban n’est pas remplacé par « Projets indisponibles »', async () => {
    const fetchMock = stubDefaultApi();
    const app = renderApp('/p/bdesk/kanban');
    expect(await screen.findByRole('heading', { level: 1, name: 'Kanban' })).toBeTruthy();

    await refreshFails(app, fetchMock, queryKeys.projects, '/api/projects');

    expect(screen.queryByRole('heading', { level: 1, name: 'Projets indisponibles' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Kanban' })).toBeTruthy();
  });

  it('garde la liste des Projets de la barre latérale, sans alerte', async () => {
    const fetchMock = stubDefaultApi();
    const app = renderApp('/p/bdesk/kanban');
    const nav = await screen.findByRole('navigation', { name: 'Navigation principale' });
    await within(nav).findByRole('link', { name: /My-Prompt-Manager/ });

    await refreshFails(app, fetchMock, queryKeys.projects, '/api/projects');

    expect(within(nav).getByRole('link', { name: /My-Prompt-Manager/ })).toBeTruthy();
    expect(within(nav).queryByRole('alert')).toBeNull();
    expect(within(nav).queryByText(/Projets indisponibles/)).toBeNull();
  });

  it('garde la liste de la Vue globale', async () => {
    const fetchMock = stubDefaultApi();
    const app = renderApp('/');
    const page = within(await screen.findByRole('main'));
    expect(await page.findByRole('link', { name: /My-Prompt-Manager/ })).toBeTruthy();

    await refreshFails(app, fetchMock, queryKeys.projects, '/api/projects');

    expect(page.getByRole('link', { name: /My-Prompt-Manager/ })).toBeTruthy();
    expect(page.queryByText('Impossible de charger les Projets')).toBeNull();
  });
});

describe('un rafraîchissement des tickets en échec', () => {
  it('garde la répartition du kanban', async () => {
    const fetchMock = stubDefaultApi();
    const app = renderApp('/p/bdesk/kanban');
    expect(await screen.findByText(/tickets, dont/)).toBeTruthy();

    await refreshFails(app, fetchMock, queryKeys.issues('bdesk'), '/api/projects/bdesk/issues');

    expect(screen.getByText(/tickets, dont/)).toBeTruthy();
    expect(screen.queryByText('Impossible de charger les tickets')).toBeNull();
  });

  it('garde le décompte de la page Epics', async () => {
    const fetchMock = stubDefaultApi();
    const app = renderApp('/p/bdesk/epics');
    expect(await screen.findByText(/Epics regroupant/)).toBeTruthy();

    await refreshFails(app, fetchMock, queryKeys.issues('bdesk'), '/api/projects/bdesk/issues');

    expect(screen.getByText(/Epics regroupant/)).toBeTruthy();
    expect(screen.queryByText('Impossible de charger les tickets')).toBeNull();
  });

  it('garde la fiche d’un ticket', async () => {
    const fetchMock = stubDefaultApi();
    const app = renderApp('/p/bdesk/t/bdesk-38k.6');
    expect(await screen.findByRole('heading', { level: 1, name: /Shell UI façon Linear/ })).toBeTruthy();

    await refreshFails(app, fetchMock, queryKeys.issue('bdesk', 'bdesk-38k.6'), '/api/projects/bdesk/issues/bdesk-38k.6');

    expect(screen.getByRole('heading', { level: 1, name: /Shell UI façon Linear/ })).toBeTruthy();
    expect(screen.queryByText('Impossible de charger le ticket')).toBeNull();
  });

  it('garde les résultats de la palette, sans « Tickets indisponibles »', async () => {
    const fetchMock = stubDefaultApi();
    const app = renderApp('/p/bdesk/kanban');
    expect(await screen.findByText(/tickets, dont/)).toBeTruthy();
    await refreshFails(app, fetchMock, queryKeys.issues('bdesk'), '/api/projects/bdesk/issues');

    await app.user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Palette de commandes' });

    expect(await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ })).toBeTruthy();
    expect(within(dialog).queryByText(/Tickets indisponibles/)).toBeNull();
    expect(within(dialog).queryByRole('option', { name: 'Réessayer' })).toBeNull();
  });
});

describe('bandeau « actualisation impossible »', () => {
  it('prévient, discrètement, que les données affichées ne sont peut-être plus à jour, puis disparaît au rétablissement', async () => {
    const fetchMock = stubDefaultApi();
    const app = renderApp('/p/bdesk/kanban');
    expect(await screen.findByText(/tickets, dont/)).toBeTruthy();
    expect(screen.queryByText(/Actualisation impossible/)).toBeNull();

    const repair = await refreshFails(app, fetchMock, queryKeys.projects, '/api/projects');

    const banner = await screen.findByText(/Actualisation impossible/);
    // Dans une zone d'annonce, pour que les lecteurs d'écran le lisent.
    expect(banner.closest('[aria-live="polite"]')).toBeTruthy();
    // La page reste utilisable derrière le bandeau.
    expect(screen.getByRole('heading', { level: 1, name: 'Kanban' })).toBeTruthy();

    repair();
    await app.user.click(screen.getByRole('button', { name: /Réessayer/ }));

    await waitFor(() => expect(screen.queryByText(/Actualisation impossible/)).toBeNull());
  });

  it('n’apparaît pas quand le premier chargement échoue : c’est la page qui porte l’erreur', async () => {
    stubApi({ projects: new Error('spawn dolt ENOENT') });
    renderApp('/');

    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Actualisation impossible/)).toBeNull();
  });
});
