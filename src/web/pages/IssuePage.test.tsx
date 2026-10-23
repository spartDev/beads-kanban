import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { bdeskIssues, issue, mpmIssues, projectsResponse } from '../test/fixtures';
import { httpFailure, renderApp, stubApi } from '../test/render';

const stubDefaultApi = () => stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });
const requested = (fetchMock: ReturnType<typeof stubApi>) => fetchMock.mock.calls.map(([input]) => String(input));

describe('page d’un ticket', () => {
  it('charge la fiche du ticket, pas la liste de tous les tickets du Projet', async () => {
    const fetchMock = stubDefaultApi();
    renderApp('/p/bdesk/t/bdesk-38k.6');

    expect(await screen.findByRole('heading', { level: 1, name: /Shell UI façon Linear/ })).toBeTruthy();

    expect(requested(fetchMock)).toContain('/api/projects/bdesk/issues/bdesk-38k.6');
    expect(requested(fetchMock)).not.toContain('/api/projects/bdesk/issues');
  });

  it('montre le type, la priorité, le statut, et le Parent avec son titre', async () => {
    stubDefaultApi();
    renderApp('/p/bdesk/t/bdesk-38k.6');

    await screen.findByRole('heading', { level: 1, name: /Shell UI façon Linear/ });
    const facts = (await screen.findByText('Parent')).closest('dl') as HTMLElement;

    expect(within(facts).getByText('Fonctionnalité')).toBeTruthy();
    expect(within(facts).getByText('P1')).toBeTruthy();
    expect(within(facts).getByText('en cours')).toBeTruthy();
    const parent = await within(facts).findByRole('link', { name: /beads-desktop V1/ });
    // Le parent est une Epic : le lien ouvre la page Epics sur elle.
    expect(parent.getAttribute('href')).toBe('/p/bdesk/epics?epic=bdesk-38k');
  });

  it('annonce un ticket introuvable dès la réponse 404, avec le chemin du retour', async () => {
    const fetchMock = stubDefaultApi();
    renderApp('/p/bdesk/t/inexistant');

    expect(await screen.findByRole('heading', { level: 1, name: 'Ticket introuvable' })).toBeTruthy();
    expect(screen.getByText('Aucun ticket « inexistant » dans beads-desktop')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Retour au kanban' }).getAttribute('href')).toBe('/p/bdesk/kanban');
    expect(requested(fetchMock).filter((url) => url.endsWith('/issues/inexistant'))).toHaveLength(1);
  });

  it('titre « Projet illisible » un 503 avec raison, et laisse réessayer', async () => {
    const unreadable = httpFailure(503, {
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'Projet illisible : bdesk (Base Dolt verrouillée)',
      reason: 'Base Dolt verrouillée',
    });
    stubApi({
      projects: projectsResponse,
      issues: { bdesk: bdeskIssues },
      details: { 'bdesk/bdesk-38k.6': unreadable },
    });
    const { user } = renderApp('/p/bdesk/t/bdesk-38k.6');

    const alert = await screen.findByRole('alert');
    expect(alert.querySelector('p')?.textContent).toBe('Projet illisible');
    expect(alert.textContent).toContain('Base Dolt verrouillée');

    stubApi({ projects: projectsResponse, issues: { bdesk: [issue({ id: 'bdesk-38k.6', title: 'Shell UI rétabli' })] } });
    await user.click(within(alert).getByRole('button', { name: /Réessayer/ }));

    expect(await screen.findByRole('heading', { level: 1, name: /Shell UI rétabli/ })).toBeTruthy();
  });

  it('garde une page d’erreur utile pour une panne serveur (500)', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: new Error('database is locked') } });
    renderApp('/p/bdesk/t/bdesk-38k.6');

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Impossible de charger le ticket')).toBeTruthy();
    expect(within(alert).getByText('database is locked')).toBeTruthy();
  });
});
