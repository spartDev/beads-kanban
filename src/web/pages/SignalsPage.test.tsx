import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('l’accueil : la page « À regarder » de tous les Projets', () => {
  it('groupe les Signaux de tous les Projets par sorte, dans l’ordre Dérive, Blocage long, Prêt qui stagne, WIP inhabituel', async () => {
    stubSignals();
    renderApp('/');

    await screen.findByRole('region', { name: 'WIP inhabituel' });
    const titled = screen.getAllByRole('region').filter((group) => group.hasAttribute('data-signal-group'));

    expect(screen.getByRole('heading', { level: 1, name: 'À regarder' })).toBeTruthy();

    expect(titled.map((group) => group.querySelector('h2')?.textContent)).toEqual(['Dérive', 'Blocage long', 'Prêt qui stagne', 'WIP inhabituel']);
  });

  it('nomme le Projet de chaque Signal, mène au ticket et dit de combien il dépasse la normale', async () => {
    stubSignals();
    renderApp('/');

    const drift = await screen.findByRole('region', { name: 'Dérive' });
    const link = within(drift).getByRole('link', { name: 'Titre de bdesk-w' });
    expect(link.getAttribute('href')).toBe('/p/bdesk/t/bdesk-w');
    expect(text(drift)).toContain('beads-desktop');
    expect(text(drift)).toContain('12 j de Cycle Time en cours, au-delà de 8,7 j, le P85 des Livraisons du même type');
    expect(text(screen.getByRole('region', { name: 'Blocage long' }))).toContain('bloqué en cours de travail depuis 4 j');
    expect(text(screen.getByRole('region', { name: 'Prêt qui stagne' }))).toContain('Prêt depuis 20 j');
    expect(text(screen.getByRole('region', { name: 'WIP inhabituel' }))).toContain(
      'Mon-Pommier-Malin : 6 tickets en cours, au-delà de 4, le P85 du WIP quotidien des 90 derniers jours',
    );
  });

  it('dit quels Projets n’ont pas pu être lus', async () => {
    stubSignals();
    renderApp('/');

    await screen.findByRole('region', { name: 'Dérive' });
    expect(text(document.body)).toContain('legacy-api');
  });

  it('dit qu’il n’y a rien à regarder quand aucun Signal n’est levé', async () => {
    stubSignals({});
    renderApp('/');

    expect(await screen.findByText(/Rien à regarder/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Dérive' })).toBeNull();
  });

  it('est la première entrée de la barre latérale, avant la Vue globale, qui a désormais sa propre adresse', async () => {
    stubSignals();
    const { user, router } = renderApp('/p/bdesk/kanban');

    const nav = await screen.findByRole('navigation', { name: 'Navigation principale' });
    const [home, overview] = within(nav).getAllByRole('link').slice(0, 2);
    expect(home?.textContent).toMatch(/^À regarder/);
    expect(overview?.textContent).toMatch(/^Vue globale/);
    await user.click(home!);
    expect(router.state.location.pathname).toBe('/');
    expect(home?.getAttribute('aria-current')).toBe('page');
    await user.click(overview!);
    expect(router.state.location.pathname).toBe('/overview');
    expect(await screen.findByRole('heading', { level: 1, name: 'Vue globale' })).toBeTruthy();
  });

  it('l’ancienne adresse, /signals, mène à l’accueil sans rester dans l’historique', async () => {
    stubSignals();
    const { router } = renderApp('/signals');

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await screen.findByRole('heading', { level: 1, name: 'À regarder' })).toBeTruthy();
  });

  it.each(['?range=90d&by=type', '?from=2026-10-01&to=2026-10-31', '?by=status'])(
    'un ancien lien de la Vue globale (/%s) mène à /overview, paramètres compris',
    async (search) => {
      stubSignals();
      const { router } = renderApp(`/${search}`);

      await waitFor(() => expect(router.state.location.pathname + router.state.location.search).toBe(`/overview${search}`));
      expect(router.state.historyAction).toBe('REPLACE');
      expect(await screen.findByRole('heading', { level: 1, name: 'Vue globale' })).toBeTruthy();
    },
  );

  it('garde l’accueil quand les paramètres de l’adresse ne sont pas ceux de la Vue globale', async () => {
    stubSignals();
    const { router } = renderApp('/?utm=lettre');

    expect(await screen.findByRole('heading', { level: 1, name: 'À regarder' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/');
  });

  it('porte en tête « Depuis votre dernière visite », avant les Signaux ; la page d’un Projet ne le porte pas', async () => {
    stubSignals();
    const app = renderApp('/');

    const since = await screen.findByRole('region', { name: 'Depuis votre dernière visite' });
    const drift = await screen.findByRole('region', { name: 'Dérive' });
    expect(since.compareDocumentPosition(drift) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    app.unmount();

    renderApp('/p/bdesk/signals');
    await screen.findByRole('region', { name: 'Dérive' });
    expect(screen.queryByRole('region', { name: 'Depuis votre dernière visite' })).toBeNull();
  });
});

describe('« À regarder » : les Signaux de relais', () => {
  const RELAYED: ApiSignal[] = [
    { kind: 'sendBackLoop', project: 'bdesk', ticket: ticketOf('bdesk-l'), sendBacks: 4 },
    { kind: 'waitingValidation', project: 'bdesk', ticket: ticketOf('bdesk-v'), since: '2026-10-20T18:00:00.000Z', duration: 3 * DAY },
  ];

  it('montre la Validation qui attend puis la Boucle de Retours en derniers groupes, chacune avec ce qu’elle dit et son aide', async () => {
    stubSignals({ bdesk: [...BDESK, ...RELAYED], mpm: MPM });
    renderApp('/');

    const loop = await screen.findByRole('region', { name: 'Boucle de Retours' });
    const titled = screen.getAllByRole('region').filter((group) => group.hasAttribute('data-signal-group'));
    expect(titled.map((group) => group.querySelector('h2')?.textContent)).toEqual([
      'Dérive',
      'Blocage long',
      'Prêt qui stagne',
      'WIP inhabituel',
      'Validation qui attend',
      'Boucle de Retours',
    ]);
    expect(within(loop).getByRole('link', { name: 'Titre de bdesk-l' }).getAttribute('href')).toBe('/p/bdesk/t/bdesk-l');
    expect(text(loop)).toContain('beads-desktop · 4 Retours au développement, sans être fermé');

    await userEvent.setup().hover(within(loop).getByRole('button', { name: 'À propos de Boucle de Retours' }));
    expect(text(await screen.findByRole('tooltip'))).toContain('au moins 3 fois au développement');
  });

  // PROVISOIRE (bdesk-3e9.6) : la File de décisions remplacera ce groupe par une marque sur la ligne du ticket.
  it('fait un groupe de la Validation qui attend, avec son aide : un Projet qui n’a qu’elle a quelque chose à regarder', async () => {
    stubSignals({ bdesk: RELAYED.filter(({ kind }) => kind === 'waitingValidation') });
    renderApp('/p/bdesk/signals');

    const waiting = await screen.findByRole('region', { name: 'Validation qui attend' });
    expect(screen.queryByText(/Rien à regarder/)).toBeNull();
    expect(within(waiting).getByRole('link', { name: 'Titre de bdesk-v' }).getAttribute('href')).toBe('/p/bdesk/t/bdesk-v');
    expect(text(waiting)).toContain('beads-desktop · À valider depuis 3 j');

    await userEvent.setup().hover(within(waiting).getByRole('button', { name: 'À propos de Validation qui attend' }));
    expect(text(await screen.findByRole('tooltip'))).toContain('plus de 24 heures de Durée écoulée');
  });

  it('laisse les autres groupes sans aide', async () => {
    stubSignals();
    renderApp('/');

    const drift = await screen.findByRole('region', { name: 'Dérive' });
    expect(within(drift).queryByRole('button')).toBeNull();
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
