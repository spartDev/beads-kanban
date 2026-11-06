import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../data/client';
import { createQueryClient, useProjects } from '../data/hooks';
import { projectsResponse } from '../test/fixtures';
import { lastZoneAnswer, metricsKey, metricsQuery, useMetrics, useZoneAnswer, type MetricsRequest } from './api';
import { metricsFixture } from './testing';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Le fuseau que la page donne au serveur : celui de son navigateur (bdesk-38k.48). */
const timeZone = 'Europe/Paris';

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

/** Un seul client pour toute la durée du test : les rendus successifs partagent le cache, comme dans l'application. */
function sharedWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('metricsKey', () => {
  it('range sous le Projet (`*` pour la Vue globale), puis la période, puis le fuseau', () => {
    expect(metricsKey({ project: 'bdesk', period: { kind: 'preset', range: '7d' }, timeZone })).toEqual(['metrics', 'bdesk', '7d', 'Europe/Paris']);
    expect(metricsKey({ period: { kind: 'custom', from: '2026-10-01', to: '2026-10-15' }, timeZone })).toEqual([
      'metrics',
      '*',
      '2026-10-01..2026-10-15',
      'Europe/Paris',
    ]);
  });

  it('distingue le fuseau : des chiffres comptés dans un fuseau ne servent pas pour un autre', () => {
    const period = { kind: 'preset', range: '7d' } as const;

    expect(metricsKey({ period, timeZone: 'Europe/Paris' })).not.toEqual(metricsKey({ period, timeZone: 'Asia/Tokyo' }));
  });
});

/**
 * bdesk-38k.71 : ce que le serveur a répondu, la dernière fois, au fuseau que la page lui demandait. Le cache des requêtes le sait déjà : chaque réponse de métriques dit
 * dans quel fuseau elle a été comptée (`timeZone`) et si c'est celui qu'on demandait (`timeZoneHonoured`), quels que soient le Projet et la période. Il survit à la vue,
 * donc à la navigation d'une page de métriques à l'autre.
 */
describe('lastZoneAnswer', () => {
  const week: MetricsRequest['period'] = { kind: 'preset', range: '7d' };
  const month: MetricsRequest['period'] = { kind: 'preset', range: '30d' };
  const inUtc = metricsFixture({ timeZone: 'UTC', timeZoneHonoured: false });
  const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
  /** Une réponse déjà là, comme après une requête réussie ; `updatedAt` la date. */
  const seed = (c: QueryClient, request: MetricsRequest, data: ReturnType<typeof metricsFixture>, updatedAt?: number) =>
    c.setQueryData(metricsKey(request), data, updatedAt === undefined ? undefined : { updatedAt });

  it('ne dit rien d’un cache sans réponse', () => {
    expect(lastZoneAnswer(client(), 'Europe/Paris')).toBeUndefined();
  });

  it('rend le fuseau où le serveur a compté et dit s’il a honoré celui qu’on lui demandait', () => {
    const c = client();
    seed(c, { project: 'bdesk', period: week, timeZone: 'Europe/Paris' }, inUtc);

    expect(lastZoneAnswer(c, 'Europe/Paris')).toEqual({ counted: 'UTC', honoured: false });
  });

  it('lit aussi la réponse d’un honoré : le fuseau demandé, tel que le serveur le nomme', () => {
    const c = client();
    seed(c, { period: week, timeZone: 'Europe/Paris' }, metricsFixture({ timeZone: 'Europe/Paris', timeZoneHonoured: true }));

    expect(lastZoneAnswer(c, 'Europe/Paris')).toEqual({ counted: 'Europe/Paris', honoured: true });
  });

  it('lit la réponse d’un autre Projet, de la Vue globale ou d’une autre période : le serveur dit la même chose de son fuseau à tous', () => {
    for (const request of [
      { project: 'mpm', period: month, timeZone: 'Europe/Paris' },
      { period: week, timeZone: 'Europe/Paris' },
    ]) {
      const c = client();
      seed(c, request, inUtc);

      expect(lastZoneAnswer(c, 'Europe/Paris')).toEqual({ counted: 'UTC', honoured: false });
    }
  });

  it('ne lit pas la réponse à un autre fuseau demandé : celle d’un navigateur qui a changé de fuseau ne dit rien du nouveau', () => {
    const c = client();
    seed(c, { project: 'bdesk', period: week, timeZone: 'Europe/Paris' }, inUtc);

    expect(lastZoneAnswer(c, 'Asia/Tokyo')).toBeUndefined();
  });

  it('prend la plus récente quand elles se contredisent : un serveur mis à jour entre-temps connaît le fuseau', () => {
    const request = (period: MetricsRequest['period']): MetricsRequest => ({ project: 'bdesk', period, timeZone: 'Europe/Paris' });
    const honoured = metricsFixture({ timeZone: 'Europe/Paris', timeZoneHonoured: true });
    for (const [older, newer] of [
      [inUtc, honoured],
      [honoured, inUtc],
    ] as const) {
      const c = client();
      seed(c, request(week), older, 1_000);
      seed(c, request(month), newer, 2_000);
      // Créées dans l'ordre inverse de leur date : c'est la date qui compte, pas l'ordre du cache.
      const d = client();
      seed(d, request(month), newer, 2_000);
      seed(d, request(week), older, 1_000);

      expect(lastZoneAnswer(c, 'Europe/Paris')?.honoured).toBe(newer.timeZoneHonoured);
      expect(lastZoneAnswer(d, 'Europe/Paris')?.honoured).toBe(newer.timeZoneHonoured);
    }
  });

  it('prend, à égalité de date, la dernière arrivée dans le cache (une horloge qui ne bouge pas)', () => {
    const c = client();
    seed(c, { project: 'bdesk', period: week, timeZone: 'Europe/Paris' }, inUtc, 1_000);
    seed(c, { project: 'bdesk', period: month, timeZone: 'Europe/Paris' }, metricsFixture({ timeZone: 'Europe/Paris', timeZoneHonoured: true }), 1_000);

    expect(lastZoneAnswer(c, 'Europe/Paris')).toEqual({ counted: 'Europe/Paris', honoured: true });
  });

  it('ne lit que des réponses : une requête sans données, en attente ou en échec, ne dit rien', () => {
    const c = client();
    const pending = (request: MetricsRequest) => c.getQueryCache().build(c, { queryKey: metricsKey(request) }); // créée, jamais aboutie
    pending({ project: 'bdesk', period: week, timeZone: 'Europe/Paris' });
    seed(c, { project: 'bdesk', period: month, timeZone: 'Europe/Paris' }, inUtc, 1_000);
    pending({ project: 'mpm', period: week, timeZone: 'Europe/Paris' });

    expect(lastZoneAnswer(c, 'Europe/Paris')).toEqual({ counted: 'UTC', honoured: false });
  });

  it('ne lit pas ce qui n’est pas une requête de métriques', () => {
    const c = client();
    c.setQueryData(['projects', 'Europe/Paris'], { projects: [] });
    c.setQueryData(['metrics-autre', '*', '7d', 'Europe/Paris'], inUtc);

    expect(lastZoneAnswer(c, 'Europe/Paris')).toBeUndefined();
  });
});

describe('useZoneAnswer', () => {
  it('rend la dernière réponse du cache, et la garde quand la vue qui la demandait n’est plus là', async () => {
    const wrap = sharedWrapper();
    vi.stubGlobal('fetch', vi.fn(async () => json(metricsFixture({ timeZone: 'UTC', timeZoneHonoured: false }))));
    const first = renderHook(() => ({ metrics: useMetrics({ project: 'bdesk', period: { kind: 'preset', range: '7d' }, timeZone }), zone: useZoneAnswer(timeZone) }), { wrapper: wrap });
    expect(first.result.current.zone).toBeUndefined(); // avant la première réponse, rien ne dit que le serveur ne connaît pas le fuseau
    await waitFor(() => expect(first.result.current.metrics.isSuccess).toBe(true));
    expect(first.result.current.zone).toEqual({ counted: 'UTC', honoured: false });
    first.unmount();

    // Une autre vue, sur le même cache, sans avoir rien demandé encore : elle sait déjà (de la page d'un Projet à la Vue globale).
    const second = renderHook(() => useZoneAnswer(timeZone), { wrapper: wrap });

    expect(second.result.current).toEqual({ counted: 'UTC', honoured: false });
  });
});

describe('useMetrics', () => {
  it('demande GET /api/metrics pour le Projet et la période, et rend la réponse', async () => {
    const data = metricsFixture();
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => json(data));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useMetrics({ project: 'bdesk', period: { kind: 'preset', range: '7d' }, timeZone }), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(data));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/metrics?project=bdesk&range=7d&timeZone=Europe%2FParis');
  });

  it('demande la Vue globale sans Projet, plage personnalisée en « from » et « to »', async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => json(metricsFixture()));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useMetrics({ period: { kind: 'custom', from: '2026-10-01', to: '2026-10-15' }, timeZone }), { wrapper });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/metrics?from=2026-10-01&to=2026-10-15&timeZone=Europe%2FParis');
  });

  it('garde les chiffres précédents en attendant ceux d’une autre période du même Projet', async () => {
    const week = metricsFixture({ range: '7d' });
    const month = metricsFixture({ range: '30d' });
    let release: (() => void) | undefined;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('range=30d')) await new Promise<void>((resolve) => (release = resolve));
      return json(url.includes('range=30d') ? month : week);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(({ request }: { request: MetricsRequest }) => useMetrics(request), {
      wrapper: sharedWrapper(),
      initialProps: { request: { project: 'bdesk', period: { kind: 'preset', range: '7d' }, timeZone } as MetricsRequest },
    });
    await waitFor(() => expect(result.current.data?.range).toBe('7d'));

    rerender({ request: { project: 'bdesk', period: { kind: 'preset', range: '30d' }, timeZone } });

    // En attente de la nouvelle période : l'ancienne reste affichée, marquée comme provisoire.
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(true));
    expect(result.current.data?.range).toBe('7d');

    release?.();
    await waitFor(() => expect(result.current.data?.range).toBe('30d'));
    expect(result.current.isPlaceholderData).toBe(false);
  });

  // bdesk-38k.48 : le fuseau du navigateur peut changer pendant que la page est ouverte (un voyage, un réglage du système).
  it('redemande les chiffres dans le nouveau fuseau quand celui du navigateur change, en gardant les précédents en attendant', async () => {
    const paris = metricsFixture({ timeZone: 'Europe/Paris' });
    const tokyo = metricsFixture({ timeZone: 'Asia/Tokyo' });
    let release: (() => void) | undefined;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('Asia%2FTokyo')) await new Promise<void>((resolve) => (release = resolve));
      return json(url.includes('Asia%2FTokyo') ? tokyo : paris);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(({ request }: { request: MetricsRequest }) => useMetrics(request), {
      wrapper: sharedWrapper(),
      initialProps: { request: { project: 'bdesk', period: { kind: 'preset', range: '7d' }, timeZone: 'Europe/Paris' } as MetricsRequest },
    });
    await waitFor(() => expect(result.current.data?.timeZone).toBe('Europe/Paris'));

    rerender({ request: { project: 'bdesk', period: { kind: 'preset', range: '7d' }, timeZone: 'Asia/Tokyo' } });

    await waitFor(() => expect(result.current.isPlaceholderData).toBe(true));
    expect(result.current.data?.timeZone).toBe('Europe/Paris');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/metrics?project=bdesk&range=7d&timeZone=Europe%2FParis',
      '/api/metrics?project=bdesk&range=7d&timeZone=Asia%2FTokyo',
    ]);

    release?.();
    await waitFor(() => expect(result.current.data?.timeZone).toBe('Asia/Tokyo'));
    expect(result.current.isPlaceholderData).toBe(false);
  });

  it('ne garde pas les chiffres d’un autre Projet : ils seraient affichés sous le titre de celui-ci', async () => {
    let release: (() => void) | undefined;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('project=mpm')) await new Promise<void>((resolve) => (release = resolve));
      return json(metricsFixture({ projects: [{ id: url.includes('mpm') ? 'mpm' : 'bdesk', name: 'x' }] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(({ request }: { request: MetricsRequest }) => useMetrics(request), {
      wrapper: sharedWrapper(),
      initialProps: { request: { project: 'bdesk', period: { kind: 'preset', range: '7d' }, timeZone } as MetricsRequest },
    });
    await waitFor(() => expect(result.current.data?.projects[0]?.id).toBe('bdesk'));

    rerender({ request: { project: 'mpm', period: { kind: 'preset', range: '7d' }, timeZone } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPlaceholderData).toBe(false);

    release?.();
    await waitFor(() => expect(result.current.data?.projects[0]?.id).toBe('mpm'));
  });

  it('rend l’erreur du serveur avec son message (400 : plage refusée)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ statusCode: 400, error: 'Bad Request', message: 'La plage est trop longue : 400 jours, au plus 366.' }, 400)),
    );

    const { result } = renderHook(() => useMetrics({ period: { kind: 'custom', from: '2025-01-01', to: '2026-02-05' }, timeZone }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).status).toBe(400);
    expect(result.current.error?.message).toBe('La plage est trop longue : 400 jours, au plus 366.');
  });
});

/**
 * Les métriques sont calculées à la demande : à l'ouverture de la page, à chaque réglage, au bouton « Actualiser » ; jamais
 * d'elles-mêmes. Le client de l'application relance pourtant, par défaut, toute requête périmée quand on revient sur
 * l'onglet ou que le réseau revient : un calcul de plusieurs secondes sur la Vue globale, dont les chiffres changent alors
 * sous les yeux. Ces tests utilisent le client de l'application (`createQueryClient`) et gardent la liste des Projets,
 * qui, elle, se rafraîchit, comme témoin : si le déclencheur ne partait pas, « pas de nouvelle requête » ne prouverait rien.
 */
describe('métriques à la demande : aucun rafraîchissement automatique', () => {
  afterEach(() => {
    vi.useRealTimers();
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
  });

  async function mountApp() {
    // Seule `Date` est figée : on la fait avancer d'un coup, et les minuteries de React Query restent réelles.
    vi.useFakeTimers({ toFake: ['Date'] });
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) =>
      url.startsWith('/api/metrics') ? json(metricsFixture()) : json(projectsResponse),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createQueryClient();
    const view = renderHook(
      () => ({ metrics: useMetrics({ project: 'bdesk', period: { kind: 'preset', range: '7d' }, timeZone }), projects: useProjects() }),
      { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> },
    );
    const calls = (prefix: string) => fetchMock.mock.calls.filter(([url]) => url.startsWith(prefix)).length;
    await waitFor(() => expect(view.result.current.metrics.data && view.result.current.projects.data).toBeTruthy());
    expect([calls('/api/metrics'), calls('/api/projects')]).toEqual([1, 1]);
    // Les 15 s de fraîcheur des métriques, et les 30 s de celle des Projets, sont écoulées.
    vi.setSystemTime(Date.now() + 31_000);
    return { calls };
  }

  it('ne les redemande pas au retour sur l’onglet, même périmées', async () => {
    const { calls } = await mountApp();

    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    await waitFor(() => expect(calls('/api/projects')).toBe(2));
    expect(calls('/api/metrics')).toBe(1);
  });

  it('ne les redemande pas au retour du réseau, même périmées', async () => {
    const { calls } = await mountApp();

    await act(async () => {
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });

    await waitFor(() => expect(calls('/api/projects')).toBe(2));
    expect(calls('/api/metrics')).toBe(1);
  });

  it('ne programme aucun rafraîchissement : ni au retour sur l’onglet ou du réseau, ni à intervalle', () => {
    const options = metricsQuery({ project: 'bdesk', period: { kind: 'preset', range: '7d' }, timeZone });

    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.refetchOnReconnect).toBe(false);
    expect(options.refetchInterval).toBeFalsy();
  });
});
