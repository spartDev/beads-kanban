import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueQuery, issuesQuery, projectsQuery, queryKeys, useIssue, useIssues } from '../data/hooks';
import { FakeEventSource, installFakeEventSource } from '../test/eventSource';
import { issue, issueDetail, projectsResponse } from '../test/fixtures';
import { useLiveUpdates } from './useLiveUpdates';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

/**
 * Un faux serveur d'API qui compte les requêtes par adresse. `hold` retient une réponse jusqu'à ce que le test la
 * libère : de quoi tenir une lecture « en cours ».
 */
function countingApi() {
  const calls: string[] = [];
  const held = new Map<string, () => void>();
  const hold = new Set<string>();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (hold.has(url)) await new Promise<void>((release) => held.set(url, release));
      if (url === '/api/projects') return json(projectsResponse);
      if (/\/issues\/[^/]+$/.test(url)) return json({ issue: issueDetail({ id: 'bdesk-a', title: 'Ticket' }) });
      if (url.endsWith('/issues')) return json({ issues: [issue({ id: 'bdesk-a', title: 'Ticket' })] });
      return json({ metrics: true });
    }),
  );
  return {
    calls,
    count: (url: string) => calls.filter((call) => call === url).length,
    hold: (url: string) => void hold.add(url),
    release: (url: string) => {
      hold.delete(url);
      held.get(url)?.();
      held.delete(url);
    },
  };
}

const LIST = '/api/projects/bdesk/issues';
const DETAIL = '/api/projects/bdesk/issues/bdesk-a';
const OTHER_LIST = '/api/projects/mpm/issues';
const OTHER_DETAIL = '/api/projects/mpm/issues/mpm-1';
const METRICS = '/api/metrics?project=bdesk&range=30d';
/** Clé d'une requête de métriques, de la forme de `metricsKey` (src/web/metrics/api.ts) : `['metrics', Projet, période]`. */
const METRICS_KEY = ['metrics', 'bdesk', '30d'] as const;

let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  installFakeEventSource();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

/** Le hook avec, autour, ce qu'une page ouverte fait lire : kanban, fiche, autre Projet, liste des Projets, métriques. */
function renderLive(projectId: string | undefined) {
  return renderHook(
    ({ id }: { id: string | undefined }) => {
      const live = useLiveUpdates(id);
      useIssues('bdesk');
      useIssue('bdesk', 'bdesk-a');
      useIssues('mpm');
      useIssue('mpm', 'mpm-1');
      useQuery(projectsQuery());
      useQuery({ queryKey: METRICS_KEY, queryFn: () => fetch(METRICS).then((response) => response.json()) as Promise<unknown>, staleTime: 15_000 });
      return live;
    },
    { wrapper, initialProps: { id: projectId } },
  );
}

const settled = async (api: ReturnType<typeof countingApi>) => {
  await waitFor(() => {
    for (const url of [LIST, DETAIL, OTHER_LIST, OTHER_DETAIL, '/api/projects', METRICS]) expect(api.count(url), url).toBeGreaterThan(0);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};

describe('sans flux possible', () => {
  it('ne s’ouvre pas sans Projet à suivre : la Vue globale, un Projet inconnu ou illisible', () => {
    countingApi();

    const { result } = renderLive(undefined);

    expect(FakeEventSource.instances).toHaveLength(0);
    expect(result.current.status).toBe('off');
  });

  it('ne fait rien — et ne plante pas — là où EventSource n’existe pas', () => {
    countingApi();
    vi.stubGlobal('EventSource', undefined);

    const { result } = renderLive('bdesk');

    expect(result.current.status).toBe('off');
    expect(() => result.current.reconnect()).not.toThrow();
  });
});

describe('connexion', () => {
  it('ouvre le flux du Projet et suit son état', () => {
    countingApi();
    const { result } = renderLive('bdesk');

    expect(FakeEventSource.latest.url).toBe('/api/projects/bdesk/events');
    expect(result.current.status).toBe('connecting');

    act(() => FakeEventSource.latest.open());
    expect(result.current.status).toBe('live');

    act(() => FakeEventSource.latest.fail({ retrying: true }));
    expect(result.current.status).toBe('lost');
  });

  it('encode l’identifiant du Projet dans l’adresse', () => {
    countingApi();
    renderLive('mon projet/é');

    expect(FakeEventSource.latest.url).toBe('/api/projects/mon%20projet%2F%C3%A9/events');
  });

  it('change de flux avec le Projet : l’ancien est fermé, le nouveau ouvert', () => {
    countingApi();
    const { rerender, result } = renderLive('bdesk');
    const first = FakeEventSource.latest;
    act(() => first.open());

    rerender({ id: 'mpm' });

    expect(first.readyState).toBe(FakeEventSource.CLOSED);
    expect(FakeEventSource.alive.map((source) => source.url)).toEqual(['/api/projects/mpm/events']);
    expect(result.current.status).toBe('connecting');
  });

  it('ferme le flux quand il n’y a plus de Projet à suivre, et quand le composant disparaît', () => {
    countingApi();
    const { rerender, unmount, result } = renderLive('bdesk');

    rerender({ id: undefined });
    expect(FakeEventSource.alive).toHaveLength(0);
    expect(result.current.status).toBe('off');

    rerender({ id: 'bdesk' });
    expect(FakeEventSource.alive).toHaveLength(1);
    unmount();
    expect(FakeEventSource.alive).toHaveLength(0);
  });

  it('rouvre tout de suite à la demande (bouton « Reconnecter »)', () => {
    countingApi();
    const { result } = renderLive('bdesk');
    act(() => FakeEventSource.latest.fail({ retrying: true }));

    act(() => result.current.reconnect());

    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.alive).toHaveLength(1);
  });

  // `status` ne répète pas « perdue » : un essai qui échoue alors que la connexion est déjà perdue ne le change pas, et un simple compteur d'échecs ne dirait pas de quel essai ils sont : quand
  // « Reconnecter » est pressé dans le même rendu qu'un échec, on ne saurait pas si c'est celui de l'essai demandé. Le hook rend donc le numéro du dernier essai qui a échoué, et `reconnect`
  // celui de l'essai qu'il lance (bdesk-38k.57).
  it('dit le numéro du dernier essai qui a échoué (0 au départ), et reconnect rend celui de l’essai qu’il lance', () => {
    countingApi();
    const { result } = renderLive('bdesk');
    expect(result.current.failedAttempt).toBe(0);
    act(() => FakeEventSource.latest.open());
    expect(result.current.failedAttempt).toBe(0);

    act(() => FakeEventSource.latest.fail({ retrying: true }));
    expect(result.current.failedAttempt).toBe(1);

    let attempt: number | undefined;
    act(() => {
      attempt = result.current.reconnect();
    });
    expect(attempt).toBe(2);
    expect(result.current.failedAttempt).toBe(1); // l'essai 2 n'a pas d'issue
    act(() => FakeEventSource.latest.fail({ retrying: true }));

    expect(result.current.failedAttempt).toBe(2);
  });

  it('un autre Projet repart de zéro : ses essais ont leur propre numérotation, un échec de l’autre ne vaut pas pour eux', () => {
    countingApi();
    const { result, rerender } = renderLive('bdesk');
    act(() => FakeEventSource.latest.fail({ retrying: true }));
    act(() => result.current.reconnect());
    act(() => FakeEventSource.latest.fail({ retrying: true }));
    expect(result.current.failedAttempt).toBe(2);

    rerender({ id: 'mpm' });

    expect(result.current.failedAttempt).toBe(0);
    act(() => FakeEventSource.latest.fail({ retrying: true }));
    expect(result.current.failedAttempt).toBe(1); // l'essai 1 du nouveau flux, et non un « 2 » de l'ancien
  });

  it('ne change pas pour ce qui aboutit, ni pour l’échec d’un flux que la connexion a remplacé', () => {
    countingApi();
    const { result } = renderLive('bdesk');
    const first = FakeEventSource.latest;
    act(() => first.fail({ retrying: true }));
    act(() => result.current.reconnect());

    act(() => first.fail({ retrying: true })); // un retard du flux remplacé
    act(() => FakeEventSource.latest.open());

    expect(result.current.failedAttempt).toBe(1);
    expect(result.current.status).toBe('live');
  });
});

describe('un commit du Projet (événement « changed »)', () => {
  it('relit la liste des tickets et la fiche affichées, celles de ce Projet seulement', async () => {
    const api = countingApi();
    renderLive('bdesk');
    await settled(api);
    act(() => FakeEventSource.latest.open());
    await settled(api);
    const before = { ...Object.fromEntries([LIST, DETAIL, OTHER_LIST, OTHER_DETAIL, '/api/projects', METRICS].map((url) => [url, api.count(url)])) };

    act(() => FakeEventSource.latest.emit('changed'));
    await waitFor(() => expect(api.count(LIST)).toBe(before[LIST]! + 1));
    await waitFor(() => expect(api.count(DETAIL)).toBe(before[DETAIL]! + 1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    // Les tickets d'un autre Projet, la liste des Projets et les métriques (calculées à la demande) ne bougent pas.
    expect(api.count(OTHER_LIST)).toBe(before[OTHER_LIST]);
    expect(api.count(OTHER_DETAIL)).toBe(before[OTHER_DETAIL]);
    expect(api.count('/api/projects')).toBe(before['/api/projects']);
    expect(api.count(METRICS)).toBe(before[METRICS]);
  });

  it('marque périmées les données que personne n’affiche, sans les relire : elles seront relues à l’affichage', async () => {
    const api = countingApi();
    await client.prefetchQuery(issuesQuery('bdesk'));
    await client.prefetchQuery(issueQuery('bdesk', 'bdesk-a'));
    await client.prefetchQuery(issuesQuery('mpm'));
    renderHook(() => useLiveUpdates('bdesk'), { wrapper });
    act(() => FakeEventSource.latest.open());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const reads = api.calls.length;

    act(() => FakeEventSource.latest.emit('changed'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(client.getQueryState(queryKeys.issues('bdesk'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.issue('bdesk', 'bdesk-a'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.issues('mpm'))?.isInvalidated).toBe(false);
    expect(api.calls).toHaveLength(reads);
  });

  it('ne coupe pas une lecture déjà en cours : elle s’achève, puis une seule relecture suit (elle a pu précéder le commit)', async () => {
    const api = countingApi();
    renderLive('bdesk');
    await settled(api);
    act(() => FakeEventSource.latest.open());
    await settled(api);
    api.hold(LIST);
    const before = api.count(LIST);
    await act(async () => void client.refetchQueries({ queryKey: queryKeys.issues('bdesk'), exact: true }));
    await waitFor(() => expect(api.count(LIST)).toBe(before + 1));

    act(() => FakeEventSource.latest.emit('changed'));
    act(() => FakeEventSource.latest.emit('changed'));
    act(() => FakeEventSource.latest.emit('changed'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(api.count(LIST)).toBe(before + 1); // la lecture en cours n'est pas relancée

    api.release(LIST);
    await waitFor(() => expect(api.count(LIST)).toBe(before + 2)); // la relecture qui rattrape les trois commits
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(api.count(LIST)).toBe(before + 2);
  });

  it('ne coupe pas non plus la lecture de la fiche quand les commits se succèdent : la liste, elle, n’attend personne', async () => {
    const api = countingApi();
    renderLive('bdesk');
    await settled(api);
    act(() => FakeEventSource.latest.open());
    await settled(api);
    api.hold(DETAIL);
    const before = { list: api.count(LIST), detail: api.count(DETAIL) };

    act(() => FakeEventSource.latest.emit('changed')); // la fiche part en lecture (lente), la liste est relue
    await waitFor(() => expect(api.count(DETAIL)).toBe(before.detail + 1));
    act(() => FakeEventSource.latest.emit('changed')); // un autre commit pendant que la fiche se lit
    await waitFor(() => expect(api.count(LIST)).toBe(before.list + 2)); // la liste, elle, n'attend personne
    expect(api.count(DETAIL)).toBe(before.detail + 1);

    api.release(DETAIL);
    await waitFor(() => expect(api.count(DETAIL)).toBe(before.detail + 2));
  });
});

describe('flux refusé par le serveur (404 d’un Projet disparu, 502 du proxy…) (relecture bdesk-38k.8)', () => {
  it('relit la liste des Projets : le Projet a peut-être disparu, et l’écran doit le dire plutôt que de reconnecter indéfiniment', async () => {
    const api = countingApi();
    renderLive('bdesk');
    await settled(api);
    act(() => FakeEventSource.latest.open());
    await settled(api);
    const before = { projects: api.count('/api/projects'), list: api.count(LIST), detail: api.count(DETAIL) };

    act(() => FakeEventSource.latest.fail({ retrying: false }));

    await waitFor(() => expect(api.count('/api/projects')).toBe(before.projects + 1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    // La liste des Projets, et elle seule : pas les tickets des Projets (leurs clés commencent aussi par « projects »).
    expect(api.count(LIST)).toBe(before.list);
    expect(api.count(DETAIL)).toBe(before.detail);
  });

  it('ne la relit pas pour une coupure en route : le navigateur retente de lui-même', async () => {
    const api = countingApi();
    renderLive('bdesk');
    await settled(api);
    act(() => FakeEventSource.latest.open());
    await settled(api);
    const before = api.count('/api/projects');

    act(() => FakeEventSource.latest.fail({ retrying: true }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(api.count('/api/projects')).toBe(before);
  });
});

describe('à l’ouverture du flux : les données affichées peuvent dater d’avant', () => {
  it('relit ce qui est au repos, sans interrompre ce qui se lit déjà', async () => {
    const api = countingApi();
    renderLive('bdesk');
    await settled(api);
    const idle = { list: api.count(LIST), detail: api.count(DETAIL), other: api.count(OTHER_LIST), metrics: api.count(METRICS) };
    api.hold(DETAIL);
    await act(async () => void client.refetchQueries({ queryKey: queryKeys.issue('bdesk', 'bdesk-a'), exact: true }));
    await waitFor(() => expect(api.count(DETAIL)).toBe(idle.detail + 1)); // la fiche est en cours de lecture

    act(() => FakeEventSource.latest.open());

    await waitFor(() => expect(api.count(LIST)).toBe(idle.list + 1)); // au repos : relue
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(api.count(DETAIL)).toBe(idle.detail + 1); // en cours : laissée à sa lecture
    expect(api.count(OTHER_LIST)).toBe(idle.other);
    expect(api.count(METRICS)).toBe(idle.metrics);
    api.release(DETAIL);
  });

  it('relit de même quand le flux se rouvre après une coupure', async () => {
    const api = countingApi();
    renderLive('bdesk');
    await settled(api);
    act(() => FakeEventSource.latest.open());
    await settled(api);
    const before = api.count(LIST);
    act(() => FakeEventSource.latest.fail({ retrying: true }));

    act(() => FakeEventSource.latest.open());

    await waitFor(() => expect(api.count(LIST)).toBe(before + 1));
  });
});

describe('onglet caché', () => {
  const setVisibility = (state: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  it('ferme le flux quand l’onglet se cache, le rouvre quand il revient, et relit alors ses données', async () => {
    const api = countingApi();
    renderLive('bdesk');
    await settled(api);
    act(() => FakeEventSource.latest.open());
    await settled(api);
    const before = api.count(LIST);

    act(() => setVisibility('hidden'));
    expect(FakeEventSource.alive).toHaveLength(0);

    act(() => setVisibility('visible'));
    expect(FakeEventSource.alive).toHaveLength(1);
    act(() => FakeEventSource.latest.open());

    await waitFor(() => expect(api.count(LIST)).toBe(before + 1));
  });

  it('n’ouvre rien tant que l’onglet est caché au départ', () => {
    countingApi();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });

    renderLive('bdesk');
    expect(FakeEventSource.alive).toHaveLength(0);

    act(() => setVisibility('visible'));
    expect(FakeEventSource.alive).toHaveLength(1);
  });

  it('retire son écouteur de visibilité du document à la disparition du composant : aucun écouteur ne survit', () => {
    countingApi();
    const added: EventListenerOrEventListenerObject[] = [];
    const removed: EventListenerOrEventListenerObject[] = [];
    const add = document.addEventListener.bind(document);
    const remove = document.removeEventListener.bind(document);
    vi.spyOn(document, 'addEventListener').mockImplementation(((type: string, listener: EventListenerOrEventListenerObject, options?: unknown) => {
      if (type === 'visibilitychange') added.push(listener);
      add(type, listener, options as AddEventListenerOptions);
    }) as typeof document.addEventListener);
    vi.spyOn(document, 'removeEventListener').mockImplementation(((type: string, listener: EventListenerOrEventListenerObject, options?: unknown) => {
      if (type === 'visibilitychange') removed.push(listener);
      remove(type, listener, options as EventListenerOptions);
    }) as typeof document.removeEventListener);

    const { unmount } = renderLive('bdesk');
    expect(added).toHaveLength(1);
    unmount();

    expect(removed).toEqual(added);
    vi.restoreAllMocks();
  });

  it('cesse d’écouter la visibilité quand le composant disparaît', () => {
    countingApi();
    const { unmount } = renderLive('bdesk');
    unmount();

    act(() => setVisibility('visible'));
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));

    expect(FakeEventSource.alive).toHaveLength(0);
  });
});
