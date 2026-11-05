import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { FakeEventSource, installFakeEventSource } from '../test/eventSource';
import { bdeskIssues, issue, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

/**
 * Le panneau d'un ticket que le Projet ne connaît pas (bdesk-38k.39). Il y a deux raisons à cet avis, et il les dit toutes les deux : l'identifiant
 * est celui d'un autre Projet, ou bd n'a pas encore enregistré le ticket (l'application ne montre que ce que bd a enregistré, voir « Dernier commit »
 * dans CONTEXT.md : un ticket qu'il vient de créer ou de modifier n'y est pas encore). Dans les deux cas l'avis dit ce qu'il y a à faire, sans le jargon
 * de la base de données.
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Le ticket que le Projet ne connaît pas. */
const MISSING = 'bdesk-nouveau';
const OTHER_PROJECT = 'L’identifiant est peut-être celui d’un autre Projet : la palette (⌘K) peut chercher dans tous les Projets.';
const NOT_RECORDED_YET = 'Le ticket n’est peut-être pas encore enregistré par bd ; dans ce cas, il s’affichera ici dès qu’il le sera.';

/**
 * Le panneau d'un ticket que le Projet ne connaît pas (404), dès que le serveur l'a dit. `live` : le flux des mises à jour en direct existe
 * (jsdom n'a pas d'`EventSource` : l'application ne l'ouvre alors pas), pour que le test fasse arriver un commit.
 */
async function openMissing({ live = false } = {}) {
  const fixture = { projects: projectsResponse, issues: { bdesk: bdeskIssues } };
  stubApi(fixture);
  if (live) installFakeEventSource();
  const app = renderApp(`/p/bdesk/t/${MISSING}`);
  const dialog = await screen.findByRole('dialog', { name: `${MISSING} Ticket introuvable` });
  return { ...app, fixture, dialog };
}

describe('le panneau d’un ticket introuvable : ce qu’il explique', () => {
  it('nomme le ticket et le Projet, puis donne les deux raisons possibles : un autre Projet, ou un ticket que bd n’a pas encore enregistré', async () => {
    const { dialog } = await openMissing();

    const notice = within(dialog).getByRole('status');

    expect(within(notice).getByText(`Aucun ticket « ${MISSING} » dans beads-desktop`)).toBeTruthy();
    expect(within(notice).getByText(OTHER_PROJECT)).toBeTruthy();
    expect(within(notice).getByText(NOT_RECORDED_YET)).toBeTruthy();
  });

  it('n’emploie pas le jargon de la base : ni « commit » ni « HEAD », ni le working set, ni Dolt', async () => {
    const { dialog } = await openMissing();

    const notice = within(dialog).getByRole('status');

    expect(notice.textContent).not.toMatch(/commit|HEAD|working set|Dolt|dépôt|workspace/i);
  });

  it('garde son titre, et son bouton de retour', async () => {
    const { dialog } = await openMissing();

    expect(within(dialog).getByRole('heading', { level: 2, name: 'Ticket introuvable' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Retour au kanban' })).toBeTruthy();
  });
});

describe('le panneau d’un ticket que bd n’a pas encore enregistré', () => {
  it('montre la fiche dès que bd l’a enregistré, sans recharger la page : l’avis disait qu’il s’afficherait ici', async () => {
    const { fixture, queryClient } = await openMissing({ live: true });
    // Le serveur répond au flux du Projet : l'interface relit alors ce qu'elle affiche (le ticket est toujours inconnu).
    await waitFor(() => expect(FakeEventSource.alive).toHaveLength(1));
    act(() => FakeEventSource.latest.open());
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(screen.getByRole('heading', { level: 2, name: 'Ticket introuvable' })).toBeTruthy();
    expect(screen.getByText(NOT_RECORDED_YET)).toBeTruthy();

    fixture.issues.bdesk = [...bdeskIssues, issue({ id: MISSING, title: 'Créé depuis un terminal' })]; // bd a enregistré le ticket
    act(() => FakeEventSource.latest.emit('changed'));

    const dialog = await screen.findByRole('dialog', { name: `${MISSING} Créé depuis un terminal` });
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Créé depuis un terminal' })).toBeTruthy();
    expect(screen.queryByText(`Aucun ticket « ${MISSING} » dans beads-desktop`)).toBeNull();
    expect(screen.queryByText(NOT_RECORDED_YET)).toBeNull();
  });
});
