import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ApiSignal } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';
import { withTimeZone } from '../test/timeZone';

withAsyncTimeout(5_000);
withTimeZone('Europe/Paris');

const DAY = 86_400_000;
const NBSP = ' ';
const ticketOf = (id: string) => ({ id, title: `Titre de ${id}`, type: 'task', priority: 2 });

const BDESK: ApiSignal[] = [
  { kind: 'drift', project: 'bdesk', ticket: ticketOf('bdesk-w'), cycleTime: 12 * DAY, reference: 8.65 * DAY, scope: 'type' },
  { kind: 'longBlockage', project: 'bdesk', ticket: ticketOf('bdesk-b'), since: '2026-10-19T18:00:00.000Z', duration: 4 * DAY },
  { kind: 'stagnantReady', project: 'bdesk', ticket: ticketOf('bdesk-r'), since: '2026-10-03T18:00:00.000Z', age: 20 * DAY },
];
const MPM: ApiSignal[] = [{ kind: 'unusualWip', project: 'mpm', wip: 6, threshold: 4 }];

const stubSignals = (signals: Record<string, ApiSignal[]> = { bdesk: BDESK, mpm: MPM }) =>
  stubApi({ projects: projectsResponse, issues: { bdesk: [], mpm: [] }, signals });
const text = (element: Element) => element.textContent?.replaceAll(NBSP, ' ') ?? '';
const requested = (fetchMock: ReturnType<typeof stubApi>) => fetchMock.mock.calls.map(([input]) => String(input));

describe('la page « À regarder » de la Vue globale', () => {
  it('groupe les Signaux de tous les Projets par sorte, dans l’ordre Dérive, Blocage long, Prêt qui stagne, WIP inhabituel', async () => {
    stubSignals();
    renderApp('/signals');

    await screen.findByRole('region', { name: 'WIP inhabituel' });
    const titled = screen.getAllByRole('region').filter((group) => group.hasAttribute('data-signal-group'));

    expect(screen.getByRole('heading', { level: 1, name: 'À regarder' })).toBeTruthy();

    expect(titled.map((group) => group.querySelector('h2')?.textContent)).toEqual(['Dérive', 'Blocage long', 'Prêt qui stagne', 'WIP inhabituel']);
  });

  it('nomme le Projet de chaque Signal, mène au ticket et dit de combien il dépasse la normale', async () => {
    stubSignals();
    renderApp('/signals');

    const drift = await screen.findByRole('region', { name: 'Dérive' });
    const link = within(drift).getByRole('link', { name: 'Titre de bdesk-w' });
    expect(link.getAttribute('href')).toBe('/p/bdesk/t/bdesk-w');
    expect(text(drift)).toContain('beads-desktop');
    expect(text(drift)).toContain('12 j de Cycle Time en cours, au-delà de 8,7 j, le P85 des Livraisons du même type');
    expect(text(screen.getByRole('region', { name: 'Blocage long' }))).toContain('bloqué en cours de travail depuis 4 j');
    expect(text(screen.getByRole('region', { name: 'Prêt qui stagne' }))).toContain('Prêt depuis 20 j');
    expect(text(screen.getByRole('region', { name: 'WIP inhabituel' }))).toContain(
      'My-Prompt-Manager : 6 tickets en cours, au-delà de 4, le P85 du WIP quotidien des 90 derniers jours',
    );
  });

  it('dit quels Projets n’ont pas pu être lus', async () => {
    stubSignals();
    renderApp('/signals');

    await screen.findByRole('region', { name: 'Dérive' });
    expect(text(document.body)).toContain('legacy-api');
  });

  it('dit qu’il n’y a rien à regarder quand aucun Signal n’est levé', async () => {
    stubSignals({});
    renderApp('/signals');

    expect(await screen.findByText(/Rien à regarder/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Dérive' })).toBeNull();
  });

  it('s’ouvre depuis la barre latérale, sous la Vue globale', async () => {
    stubSignals();
    const { user, router } = renderApp('/');

    const nav = await screen.findByRole('navigation', { name: 'Navigation principale' });
    await user.click(within(nav).getByRole('link', { name: /^À regarder/ }));

    expect(router.state.location.pathname).toBe('/signals');
  });
});

describe('la page « À regarder » d’un Projet', () => {
  it('ne demande et ne montre que les Signaux du Projet, dans le fuseau du navigateur', async () => {
    const fetchMock = stubSignals();
    renderApp('/p/bdesk/signals');

    await screen.findByRole('region', { name: 'Dérive' });
    await waitFor(() => expect(requested(fetchMock)).toContain('/api/signals?project=bdesk&timeZone=Europe%2FParis'));
    expect(screen.queryByRole('region', { name: 'WIP inhabituel' })).toBeNull();
  });

  it('est un onglet du Projet, entre Kanban et Epics', async () => {
    stubSignals();
    renderApp('/p/bdesk/signals');

    const nav = await screen.findByRole('navigation', { name: 'Navigation principale' });
    // La liste des onglets du Projet, sous son nom (le lien du nom mène à l'onglet courant : il n'en fait pas partie).
    const list = (await within(nav).findByRole('link', { name: /^Kanban/ })).closest('ul') as HTMLElement;
    const sections = ['/p/bdesk/kanban', '/p/bdesk/signals', '/p/bdesk/epics', '/p/bdesk/metrics'];
    const tabs = within(list)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href') ?? '')
      .filter((href) => sections.includes(href));

    expect(tabs).toEqual(sections);
  });
});
