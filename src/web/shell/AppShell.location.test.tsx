import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { bdeskIssues, mpmIssues, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

/**
 * Le contenu principal dit quelle page il montre (`data-location`) : `focusTitleWhenReady` attend le titre d'une page, et s'arrête quand l'utilisateur va sur une autre
 * (bdesk-38k.57). Son observateur de mutations s'exécute juste après le rendu de la navigation : ce que le document dit à ce moment-là est d'une pièce, l'adresse y étant
 * écrite dans le même rendu que la page, quand un effet pourrait venir trop tard (`retryFocus.test.tsx` en vérifie l'effet sur le focus).
 */
describe('AppShell : l’adresse que le contenu principal montre', () => {
  const location = () => screen.getByRole('main', { name: 'Contenu' }).getAttribute('data-location');

  it('est le chemin et les paramètres de la page, et suit chaque navigation', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });
    const { router } = renderApp('/p/bdesk/epics?epic=bdesk-38k');
    await screen.findByRole('navigation', { name: 'Navigation principale' });
    expect(location()).toBe('/p/bdesk/epics?epic=bdesk-38k');

    await act(() => router.navigate('/p/bdesk/kanban'));
    expect(location()).toBe('/p/bdesk/kanban');

    await act(() => router.navigate('/p/bdesk/kanban?epic=bdesk-38k'));
    expect(location()).toBe('/p/bdesk/kanban?epic=bdesk-38k');
  });

  it('ne compte pas l’ancre : « Aller au contenu » ne change pas de page', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });
    const { router } = renderApp('/p/bdesk/kanban');
    await screen.findByRole('navigation', { name: 'Navigation principale' });

    await act(() => router.navigate('/p/bdesk/kanban#contenu'));

    expect(location()).toBe('/p/bdesk/kanban');
  });
});
