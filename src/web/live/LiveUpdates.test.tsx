import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../data/hooks';
import type { Issue, IssueDetail } from '../data/types';
import { FakeEventSource, installFakeEventSource } from '../test/eventSource';
import { bdeskIssues, issueDetail, mpmIssues, projectsResponse } from '../test/fixtures';
import { failRequests, renderApp, stubApi } from '../test/render';
import { LiveUpdates } from './LiveUpdates';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Le faux serveur d'API : on remplace ses réponses entre deux lectures, comme le ferait un `bd update`. */
function serve(issues: Record<string, Issue[]> = { bdesk: bdeskIssues, mpm: mpmIssues }, details: Record<string, IssueDetail> = {}) {
  const fixture = { projects: projectsResponse, issues, details };
  const fetchMock = stubApi(fixture);
  installFakeEventSource();
  return { fixture, fetchMock };
}

const column = (name: string) => screen.getByRole('region', { name });
const titlesIn = (region: HTMLElement) => within(region).queryAllByRole('listitem').map((card) => within(card).getAllByRole('link')[0]?.textContent);
const issueReads = (fetchMock: ReturnType<typeof stubApi>, projectId = 'bdesk') =>
  fetchMock.mock.calls.filter(([input]) => String(input) === `/api/projects/${projectId}/issues`).length;

type App = ReturnType<typeof renderApp>;

/**
 * Le serveur répond au flux : l'interface relit alors ce qu'elle affichait (des commits ont pu passer avant la
 * connexion). On attend la fin de cette relecture, pour que la suite compte ses propres lectures.
 */
async function connected({ queryClient }: App) {
  await waitFor(() => expect(FakeEventSource.alive).toHaveLength(1));
  act(() => FakeEventSource.latest.open());
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
}

const STARTED = 'Kanban par Projet (lecture seule)';
const startedIssues = () => bdeskIssues.map((ticket) => (ticket.id === 'bdesk-38k.7' ? { ...ticket, status: 'in_progress' } : ticket));

describe('le shell suit le Projet affiché', () => {
  it('ouvre le flux du Projet de l’adresse, une fois la liste des Projets connue', async () => {
    serve();
    renderApp('/p/bdesk/kanban');
    await screen.findByRole('region', { name: 'Prêt' });

    await waitFor(() => expect(FakeEventSource.alive.map((source) => source.url)).toEqual(['/api/projects/bdesk/events']));
  });

  it('ne suit rien sur la Vue globale', async () => {
    serve();
    renderApp('/');
    const nav = await screen.findByRole('navigation', { name: 'Navigation principale' });
    await within(nav).findByRole('link', { name: /My-Prompt-Manager/ }); // la liste des Projets est chargée

    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it.each([
    ['un Projet illisible', '/p/legacy/kanban', 'Ce Projet est illisible'],
    ['un Projet inconnu', '/p/fantome/kanban', 'Projet introuvable'],
  ])('ne suit pas %s', async (_label, path, text) => {
    serve();
    renderApp(path);
    await screen.findByText(text);

    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('change de flux avec le Projet', async () => {
    serve();
    const { router } = renderApp('/p/bdesk/kanban');
    await screen.findByRole('region', { name: 'Prêt' });
    await waitFor(() => expect(FakeEventSource.alive).toHaveLength(1));

    await act(() => router.navigate('/p/mpm/kanban'));

    await waitFor(() => expect(FakeEventSource.alive.map((source) => source.url)).toEqual(['/api/projects/mpm/events']));
  });

  it('ferme le flux en quittant les pages d’un Projet', async () => {
    serve();
    const { router } = renderApp('/p/bdesk/kanban');
    await screen.findByRole('region', { name: 'Prêt' });
    await waitFor(() => expect(FakeEventSource.alive).toHaveLength(1));

    await act(() => router.navigate('/'));

    await waitFor(() => expect(FakeEventSource.alive).toHaveLength(0));
  });
});

describe('un commit du Projet met l’affichage à jour, sans rechargement de la page', () => {
  it('déplace la carte d’une colonne à l’autre : « bd update --status in_progress »', async () => {
    const { fixture, fetchMock } = serve();
    const app = renderApp('/p/bdesk/kanban');
    const { router } = app;
    await screen.findByRole('region', { name: 'Prêt' });
    await connected(app);
    expect(titlesIn(column('Prêt'))).toContain(STARTED);
    expect(titlesIn(column('En cours'))).not.toContain(STARTED);
    const reads = issueReads(fetchMock);

    fixture.issues.bdesk = startedIssues(); // bd update : un nouveau commit dans la base
    act(() => FakeEventSource.latest.emit('changed'));

    await waitFor(() => expect(titlesIn(column('En cours'))).toContain(STARTED));
    expect(titlesIn(column('Prêt'))).not.toContain(STARTED);
    expect(issueReads(fetchMock)).toBe(reads + 1);
    expect(router.state.location.pathname).toBe('/p/bdesk/kanban'); // on n'a pas bougé de page
  });

  describe('la carte qui bouge', () => {
    const animate = vi.fn();
    beforeEach(() => {
      animate.mockReset();
      Element.prototype.animate = animate as unknown as typeof Element.prototype.animate;
    });
    afterEach(() => {
      delete (Element.prototype as { animate?: unknown }).animate;
    });
    const flashed = () => animate.mock.contexts.map((element) => (element as HTMLElement).dataset.cardId);

    it('s’éclaire un instant dans sa nouvelle colonne ; les autres cartes ne bougent pas', async () => {
      const { fixture } = serve();
      const app = renderApp('/p/bdesk/kanban');
      await screen.findByRole('region', { name: 'Prêt' });
      await connected(app);
      expect(animate).not.toHaveBeenCalled(); // ni l'ouverture du tableau, ni la relecture de la connexion

      fixture.issues.bdesk = startedIssues();
      act(() => FakeEventSource.latest.emit('changed'));

      await waitFor(() => expect(titlesIn(column('En cours'))).toContain(STARTED));
      expect(flashed()).toEqual(['bdesk-38k.7']);
      const card = animate.mock.contexts[0] as HTMLElement;
      expect(column('En cours').contains(card)).toBe(true);
    });

    it('ne s’éclaire pas quand le commit ne change rien aux tickets affichés', async () => {
      const { fetchMock } = serve();
      const app = renderApp('/p/bdesk/kanban');
      await screen.findByRole('region', { name: 'Prêt' });
      await connected(app);
      const reads = issueReads(fetchMock);

      act(() => FakeEventSource.latest.emit('changed')); // un commit sans effet sur les tickets (une note de configuration, par exemple)
      await waitFor(() => expect(issueReads(fetchMock)).toBe(reads + 1));
      await waitFor(() => expect(app.queryClient.isFetching()).toBe(0));

      expect(animate).not.toHaveBeenCalled();
    });
  });

  it('fait apparaître un ticket créé, et disparaître un ticket supprimé', async () => {
    const { fixture } = serve();
    const app = renderApp('/p/bdesk/kanban');
    await screen.findByRole('region', { name: 'Prêt' });
    await connected(app);

    fixture.issues.bdesk = [
      ...bdeskIssues.filter((ticket) => ticket.id !== 'bdesk-b7q'),
      { ...bdeskIssues[2]!, id: 'bdesk-new', title: 'Créé depuis un terminal' },
    ];
    act(() => FakeEventSource.latest.emit('changed'));

    await waitFor(() => expect(titlesIn(column('Prêt'))).toContain('Créé depuis un terminal'));
    expect(titlesIn(column('Prêt'))).not.toContain('Le graphique du Débit se décale après minuit');
  });

  it('fait apparaître le premier ticket d’un Projet vide, que la page annonçait pour « quelques secondes »', async () => {
    const { fixture } = serve({ bdesk: [], mpm: mpmIssues });
    const app = renderApp('/p/bdesk/kanban');
    expect(await screen.findByText('Aucun ticket dans ce Projet')).toBeTruthy();
    expect(screen.getByText(/dans quelques secondes/)).toBeTruthy();
    expect(screen.queryByText(/prochain chargement/)).toBeNull();
    await connected(app);

    fixture.issues.bdesk = [bdeskIssues[2]!]; // bd create
    act(() => FakeEventSource.latest.emit('changed'));

    await waitFor(() => expect(titlesIn(column('Prêt'))).toEqual([STARTED]));
    expect(screen.queryByText('Aucun ticket dans ce Projet')).toBeNull();
  });

  it('met à jour la fiche d’un ticket ouverte', async () => {
    const { fixture } = serve(undefined, {
      'bdesk/bdesk-38k.7': issueDetail({ id: 'bdesk-38k.7', title: 'Titre avant le commit', parentId: 'bdesk-38k' }),
    });
    const app = renderApp('/p/bdesk/t/bdesk-38k.7');
    await screen.findByText('Titre avant le commit');
    await connected(app);

    fixture.details['bdesk/bdesk-38k.7'] = issueDetail({ id: 'bdesk-38k.7', title: 'Titre après le commit', parentId: 'bdesk-38k' });
    act(() => FakeEventSource.latest.emit('changed'));

    await screen.findByText('Titre après le commit');
    expect(screen.queryByText('Titre avant le commit')).toBeNull();
  });

  it('ne relit pas les tickets d’un autre Projet', async () => {
    const { fetchMock } = serve();
    const app = renderApp('/p/bdesk/kanban');
    await screen.findByRole('region', { name: 'Prêt' });
    await connected(app);
    const reads = issueReads(fetchMock);
    const others = issueReads(fetchMock, 'mpm');

    act(() => FakeEventSource.latest.emit('changed'));
    await waitFor(() => expect(issueReads(fetchMock)).toBe(reads + 1));

    expect(issueReads(fetchMock, 'mpm')).toBe(others);
  });
});

describe('connexion perdue', () => {
  const MESSAGE = /mises à jour en direct interrompues/i;

  it('prévient discrètement au bout de quelques secondes, et s’efface au retour de la connexion', async () => {
    serve();
    renderApp('/p/bdesk/kanban');
    await screen.findByRole('region', { name: 'Prêt' });
    await waitFor(() => expect(FakeEventSource.alive).toHaveLength(1));
    act(() => FakeEventSource.latest.open());
    expect(screen.queryByText(MESSAGE)).toBeNull();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    act(() => FakeEventSource.latest.fail({ retrying: true }));
    act(() => void vi.advanceTimersByTime(2_000));
    expect(screen.queryByText(MESSAGE)).toBeNull(); // pas encore : un redémarrage du serveur est plus court
    act(() => void vi.advanceTimersByTime(600));
    expect(screen.getByText(MESSAGE)).toBeTruthy();
    // La page reste utilisable : le kanban est toujours là.
    expect(screen.getByRole('region', { name: 'Prêt' })).toBeTruthy();

    act(() => FakeEventSource.latest.open());
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it('« Reconnecter » ouvre un nouveau flux tout de suite', async () => {
    serve();
    renderApp('/p/bdesk/kanban');
    await screen.findByRole('region', { name: 'Prêt' });
    await waitFor(() => expect(FakeEventSource.alive).toHaveLength(1));
    act(() => FakeEventSource.latest.open());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => FakeEventSource.latest.fail({ retrying: true }));
    act(() => void vi.advanceTimersByTime(3_000));
    const instances = FakeEventSource.instances.length;

    act(() => screen.getByRole('button', { name: 'Reconnecter' }).click());

    expect(FakeEventSource.instances).toHaveLength(instances + 1);
    expect(FakeEventSource.alive).toHaveLength(1);
  });
});

describe('seules les pages qui affichent des tickets suivent le Projet (relecture bdesk-38k.8)', () => {
  /** Le seul composant du shell qui suit le Projet, derrière un routeur : la page n'a pas à être montée pour savoir si on suit. */
  function renderShell(path: string) {
    const fetchMock = stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });
    installFakeEventSource();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter([{ path: '*', element: <LiveUpdates /> }], { initialEntries: [path] });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    return { router, queryClient, fetchMock };
  }
  const listed = (fetchMock: ReturnType<typeof stubApi>) => fetchMock.mock.calls.some(([input]) => String(input) === '/api/projects');

  it.each(['/p/bdesk/kanban', '/p/bdesk/kanban?epic=bdesk-38k', '/p/bdesk/epics', '/p/bdesk/t/bdesk-38k.7', '/p/bdesk'])('suit le Projet sur %s', async (path) => {
    renderShell(path);

    await waitFor(() => expect(FakeEventSource.alive.map((source) => source.url)).toEqual(['/api/projects/bdesk/events']));
  });

  it.each(['/p/bdesk/metrics', '/p/bdesk/metrics?range=7d&slice=type'])(
    'ne suit rien sur la page Métriques (%s) : rien n’y est en direct, le serveur n’a donc pas à sonder le Projet',
    async (path) => {
      const { fetchMock } = renderShell(path);
      await waitFor(() => expect(listed(fetchMock)).toBe(true));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50)); // la liste des Projets est arrivée : le Projet est connu et lisible
      });

      expect(FakeEventSource.instances).toHaveLength(0);
    },
  );

  it('ferme le flux en passant aux Métriques, et le rouvre en revenant au tableau', async () => {
    const { router } = renderShell('/p/bdesk/kanban');
    await waitFor(() => expect(FakeEventSource.alive).toHaveLength(1));
    const first = FakeEventSource.latest;

    await act(() => router.navigate('/p/bdesk/metrics'));
    await waitFor(() => expect(FakeEventSource.alive).toHaveLength(0));
    expect(first.readyState).toBe(FakeEventSource.CLOSED);

    await act(() => router.navigate('/p/bdesk/kanban'));
    await waitFor(() => expect(FakeEventSource.alive).toHaveLength(1));
    expect(FakeEventSource.alive[0]).not.toBe(first);
  });
});

describe('un seul message à la fois quand les données affichées risquent d’être périmées (relecture bdesk-38k.8)', () => {
  const STALE = /Actualisation impossible/;
  const LOST = /mises à jour en direct interrompues/i;

  /** Le serveur ne répond plus à la liste des Projets : le prochain rafraîchissement échoue, les données restent. */
  async function projectsRefreshFails({ queryClient }: ReturnType<typeof renderApp>, fetchMock: ReturnType<typeof stubApi>) {
    const repair = failRequests(fetchMock, (url) => url === '/api/projects');
    await act(() => queryClient.refetchQueries({ queryKey: queryKeys.projects, exact: true }).catch(() => undefined));
    await waitFor(() => expect(queryClient.getQueryState(queryKeys.projects)?.status).toBe('error'));
    return repair;
  }

  async function opened() {
    const { fetchMock } = serve();
    const app = renderApp('/p/bdesk/kanban');
    await screen.findByRole('region', { name: 'Prêt' });
    await waitFor(() => expect(FakeEventSource.alive).toHaveLength(1));
    act(() => FakeEventSource.latest.open());
    return { app, fetchMock };
  }

  /** Le temps passe pour l'indication « interrompues » (délai de grâce) sans geler les requêtes de la page. */
  const gracePasses = () => act(() => void vi.advanceTimersByTime(2_600));
  const fakeClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });

  it('le serveur tombe alors qu’une actualisation vient d’échouer : le message des mises à jour remplace l’autre, il ne s’y ajoute pas', async () => {
    const { app, fetchMock } = await opened();
    const repair = await projectsRefreshFails(app, fetchMock);
    expect(await screen.findByText(STALE)).toBeTruthy(); // le flux est vivant : seul ce message parle
    expect(screen.queryByText(LOST)).toBeNull();
    fakeClock();

    act(() => FakeEventSource.latest.fail({ retrying: true })); // le serveur tombe
    expect(screen.queryByText(STALE)).toBeNull(); // dès la perte : un seul message, ou aucun pendant le délai de grâce
    gracePasses();

    expect(screen.getByText(LOST)).toBeTruthy();
    expect(screen.queryByText(STALE)).toBeNull();

    act(() => FakeEventSource.latest.open()); // le serveur revient, mais l'actualisation de la liste a toujours échoué
    expect(screen.queryByText(LOST)).toBeNull();
    expect(screen.getByText(STALE)).toBeTruthy(); // l'autre message reprend sa place
    repair();
  });

  it('une actualisation qui échoue pendant que les mises à jour sont interrompues n’ajoute pas un second message', async () => {
    const { app, fetchMock } = await opened();
    fakeClock();
    act(() => FakeEventSource.latest.fail({ retrying: true }));
    gracePasses();
    expect(screen.getByText(LOST)).toBeTruthy();

    await projectsRefreshFails(app, fetchMock); // le focus de la fenêtre relit la liste, le serveur est toujours en panne

    expect(screen.getByText(LOST)).toBeTruthy();
    expect(screen.queryByText(STALE)).toBeNull();
    expect(screen.getAllByRole('button', { name: /Reconnecter|Réessayer/ })).toHaveLength(1);
  });

  it('« Reconnecter » rouvre le flux ; au retour du serveur, la liste des Projets en échec est relue avec le reste', async () => {
    const { app, fetchMock } = await opened();
    const repair = await projectsRefreshFails(app, fetchMock);
    fakeClock();
    act(() => FakeEventSource.latest.fail({ retrying: true }));
    gracePasses();
    repair();

    act(() => screen.getByRole('button', { name: 'Reconnecter' }).click());
    act(() => FakeEventSource.latest.open());

    await waitFor(() => expect(screen.queryByText(STALE)).toBeNull());
    expect(screen.queryByText(LOST)).toBeNull();
    expect(app.queryClient.getQueryState(queryKeys.projects)?.status).toBe('success');
  });
});

describe('un Projet qui disparaît (le flux est refusé : 404) (relecture bdesk-38k.8)', () => {
  const GONE = /Aucun Projet n’a l’identifiant « bdesk »/;

  /** Le serveur ne connaît plus `bdesk` : la liste des Projets ne l'a plus. */
  function projectDisappears(fetchMock: ReturnType<typeof stubApi>) {
    const healthy = fetchMock.getMockImplementation();
    if (!healthy) throw new Error('attend le mock de stubApi');
    const without = { ...projectsResponse, projects: projectsResponse.projects.filter((project) => project.id !== 'bdesk') };
    fetchMock.mockImplementation(async (input) =>
      String(input) === '/api/projects'
        ? new Response(JSON.stringify(without), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : healthy(input),
    );
  }

  it('la page dit que le Projet est introuvable, plus aucun flux n’est rouvert et rien ne parle de reconnexion', async () => {
    const { fetchMock } = serve();
    renderApp('/p/bdesk/kanban');
    await screen.findByRole('region', { name: 'Prêt' });
    await waitFor(() => expect(FakeEventSource.alive).toHaveLength(1));
    act(() => FakeEventSource.latest.open());
    projectDisappears(fetchMock);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true }); // la reconnexion, si elle avait lieu, serait simulée

    act(() => FakeEventSource.latest.fail({ retrying: false })); // le navigateur abandonne : 404

    expect(await screen.findByText(GONE)).toBeTruthy();
    await waitFor(() => expect(FakeEventSource.alive).toHaveLength(0));
    const opened = FakeEventSource.instances.length;
    act(() => void vi.advanceTimersByTime(5 * 60_000));

    expect(FakeEventSource.instances).toHaveLength(opened); // pas de reconnexion indéfinie
    expect(screen.queryByText(/mises à jour en direct interrompues/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reconnecter' })).toBeNull();
  });

  it('un Projet toujours connu, dont le flux est refusé un instant (proxy en panne), est suivi à nouveau comme avant', async () => {
    serve();
    renderApp('/p/bdesk/kanban');
    await screen.findByRole('region', { name: 'Prêt' });
    await waitFor(() => expect(FakeEventSource.alive).toHaveLength(1));
    act(() => FakeEventSource.latest.open());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });

    act(() => FakeEventSource.latest.fail({ retrying: false }));
    await act(async () => void vi.advanceTimersByTime(1_100));

    expect(screen.queryByText(GONE)).toBeNull();
    expect(FakeEventSource.alive).toHaveLength(1);
    expect(FakeEventSource.instances).toHaveLength(2);
  });
});

describe('navigateur sans EventSource', () => {
  it('affiche les pages comme avant : aucune erreur, aucun bandeau', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });
    expect(typeof EventSource).toBe('undefined'); // jsdom n'en fournit pas
    renderApp('/p/bdesk/kanban');

    await screen.findByRole('region', { name: 'Prêt' });

    expect(screen.queryByText(/mises à jour en direct/i)).toBeNull();
  });
});
