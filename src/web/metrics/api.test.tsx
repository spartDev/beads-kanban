import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../data/client';
import { createQueryClient, useProjects } from '../data/hooks';
import { projectsResponse } from '../test/fixtures';
import { metricsKey, metricsQuery, useMetrics, type MetricsRequest } from './api';
import { metricsFixture } from './testing';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

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
  it('range sous le Projet (`*` pour la Vue globale), puis la période', () => {
    expect(metricsKey({ project: 'bdesk', period: { kind: 'preset', range: '7d' } })).toEqual(['metrics', 'bdesk', '7d']);
    expect(metricsKey({ period: { kind: 'custom', from: '2026-10-01', to: '2026-10-15' } })).toEqual(['metrics', '*', '2026-10-01..2026-10-15']);
  });
});

describe('useMetrics', () => {
  it('demande GET /api/metrics pour le Projet et la période, et rend la réponse', async () => {
    const data = metricsFixture();
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => json(data));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useMetrics({ project: 'bdesk', period: { kind: 'preset', range: '7d' } }), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(data));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/metrics?project=bdesk&range=7d');
  });

  it('demande la Vue globale sans Projet, plage personnalisée en « from » et « to »', async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => json(metricsFixture()));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useMetrics({ period: { kind: 'custom', from: '2026-10-01', to: '2026-10-15' } }), { wrapper });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/metrics?from=2026-10-01&to=2026-10-15');
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
      initialProps: { request: { project: 'bdesk', period: { kind: 'preset', range: '7d' } } as MetricsRequest },
    });
    await waitFor(() => expect(result.current.data?.range).toBe('7d'));

    rerender({ request: { project: 'bdesk', period: { kind: 'preset', range: '30d' } } });

    // En attente de la nouvelle période : l'ancienne reste affichée, marquée comme provisoire.
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(true));
    expect(result.current.data?.range).toBe('7d');

    release?.();
    await waitFor(() => expect(result.current.data?.range).toBe('30d'));
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
      initialProps: { request: { project: 'bdesk', period: { kind: 'preset', range: '7d' } } as MetricsRequest },
    });
    await waitFor(() => expect(result.current.data?.projects[0]?.id).toBe('bdesk'));

    rerender({ request: { project: 'mpm', period: { kind: 'preset', range: '7d' } } });

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

    const { result } = renderHook(() => useMetrics({ period: { kind: 'custom', from: '2025-01-01', to: '2026-02-05' } }), { wrapper });

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
      () => ({ metrics: useMetrics({ project: 'bdesk', period: { kind: 'preset', range: '7d' } }), projects: useProjects() }),
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
    const options = metricsQuery({ project: 'bdesk', period: { kind: 'preset', range: '7d' } });

    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.refetchOnReconnect).toBe(false);
    expect(options.refetchInterval).toBeFalsy();
  });
});
