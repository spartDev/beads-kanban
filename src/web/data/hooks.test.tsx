import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueDetail } from '../test/fixtures';
import { ApiError } from './client';
import { createQueryClient, issueQuery, queryKeys, shouldRetry, useIssue, useIssues } from './hooks';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const wrapperFor = (client: ReturnType<typeof createQueryClient>) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shouldRetry', () => {
  it('retente une fois une erreur réseau ou serveur (500, 502, 504…)', () => {
    for (const status of [0, 500, 502, 504]) {
      const error = new ApiError('panne', status);
      expect(shouldRetry(0, error), `HTTP ${status}`).toBe(true);
      expect(shouldRetry(1, error), `HTTP ${status}, deuxième échec`).toBe(false);
    }
    expect(shouldRetry(0, new SyntaxError('JSON invalide'))).toBe(true);
  });

  it('ne retente pas une 4xx : la même requête recevrait la même réponse', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(shouldRetry(0, new ApiError('non', status)), `HTTP ${status}`).toBe(false);
    }
  });

  it('ne retente pas un 503 : un Projet illisible le restera à la seconde suivante', () => {
    expect(shouldRetry(0, new ApiError('Base Dolt verrouillée', 503, { reason: 'Base Dolt verrouillée' }))).toBe(false);
    expect(shouldRetry(0, new ApiError('Erreur HTTP 503', 503))).toBe(false);
  });
});

describe('createQueryClient : nouvelles tentatives', () => {
  /** Le vrai client de l'application, sans l'attente d'une seconde entre deux tentatives. */
  function fastClient() {
    const client = createQueryClient();
    client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 0 } });
    return client;
  }
  async function attempts(respond: () => Promise<Response>): Promise<number> {
    const fetchMock = vi.fn(respond);
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useIssues('bdesk'), { wrapper: wrapperFor(fastClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    return fetchMock.mock.calls.length;
  }

  it.each([400, 403, 404])('ne redemande pas une réponse %i', async (status) => {
    expect(await attempts(async () => jsonResponse({ message: 'non' }, status))).toBe(1);
  });

  it('ne redemande pas un 503 (Projet illisible)', async () => {
    expect(await attempts(async () => jsonResponse({ message: 'Projet illisible', reason: 'Base Dolt verrouillée' }, 503))).toBe(1);
  });

  it.each([500, 502])('redemande une fois une réponse %i', async (status) => {
    expect(await attempts(async () => jsonResponse({ message: 'panne' }, status))).toBe(2);
  });

  it('redemande une fois quand le serveur est injoignable', async () => {
    expect(await attempts(async () => Promise.reject(new TypeError('fetch failed')))).toBe(2);
  });
});

describe('issueQuery et useIssue (détail d’un ticket)', () => {
  it('rangent le détail sous la liste des tickets du Projet', () => {
    expect(queryKeys.issue('bdesk', 'bdesk-38k.6')).toEqual(['projects', 'bdesk', 'issues', 'bdesk-38k.6']);
    expect(issueQuery('bdesk', 'bdesk-38k.6').queryKey).toEqual(['projects', 'bdesk', 'issues', 'bdesk-38k.6']);
  });

  it('demandent GET /api/projects/:id/issues/:issueId, identifiants échappés, et rendent le ticket détaillé', async () => {
    const detail = issueDetail({ id: 'a b/c', title: 'Un ticket', description: 'Du texte', labels: ['ui'] });
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => jsonResponse({ issue: detail }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useIssue('mon projet', 'a b/c'), { wrapper: wrapperFor(createQueryClient()) });

    await waitFor(() => expect(result.current.data).toEqual(detail));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/projects/mon%20projet/issues/a%20b%2Fc');
  });

  it('ne chargent rien tant que le Projet ou le ticket manque', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ issue: issueDetail({ id: 'x', title: 'x' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = wrapperFor(createQueryClient());

    const noIssue = renderHook(() => useIssue('bdesk', undefined), { wrapper });
    const noProject = renderHook(() => useIssue(undefined, 'bdesk-1'), { wrapper });

    expect(noIssue.result.current.fetchStatus).toBe('idle');
    expect(noProject.result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
