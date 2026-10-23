import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiGet, describeError } from './client';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiGet', () => {
  it('renvoie le JSON d’une réponse réussie', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ projects: [], ignored: [] })));

    await expect(apiGet('/api/projects')).resolves.toEqual({ projects: [], ignored: [] });
  });

  it('lit le message d’erreur du serveur', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Not Found', message: 'Projet inconnu' }, 404)));

    await expect(apiGet('/api/projects/x/issues')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'Projet inconnu',
    });
  });

  it('préfère la raison d’un Projet illisible (503) au message générique', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ statusCode: 503, error: 'Service Unavailable', message: 'Projet illisible', reason: 'Base Dolt verrouillée' }, 503)));

    await expect(apiGet('/api/projects/x/issues')).rejects.toMatchObject({ status: 503, message: 'Base Dolt verrouillée' });
  });

  it('garde la raison d’un Projet illisible (503) dans `reason`, absente des autres erreurs', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock.mockResolvedValueOnce(jsonResponse({ statusCode: 503, error: 'Service Unavailable', message: 'Projet illisible : x', reason: 'Base Dolt verrouillée' }, 503));
    await expect(apiGet('/api/projects/x/issues')).rejects.toMatchObject({ status: 503, reason: 'Base Dolt verrouillée' });

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Not Found', message: 'Projet inconnu' }, 404));
    const notFound = await apiGet('/api/projects/x/issues').catch((e: unknown) => e);
    expect((notFound as ApiError).reason).toBeUndefined();
  });

  it('retombe sur le code HTTP quand le corps n’est pas du JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 })));

    await expect(apiGet('/api/projects')).rejects.toMatchObject({ status: 502, message: 'Erreur HTTP 502' });
  });

  it('signale un serveur injoignable par le statut 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const error = await apiGet('/api/projects').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, message: 'Serveur injoignable' });
  });

  it('laisse remonter telle quelle une requête annulée', async () => {
    const controller = new AbortController();
    const abort = new DOMException('Aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(abort);
    }));

    await expect(apiGet('/api/projects', controller.signal)).rejects.toBe(abort);
  });
});

describe('describeError', () => {
  it('distingue serveur injoignable, erreur serveur, introuvable et autres', () => {
    expect(describeError(new ApiError('Serveur injoignable', 0)).title).toMatch(/injoignable/);
    expect(describeError(new ApiError('boom', 500))).toEqual({ title: 'Le serveur a rencontré une erreur', detail: 'boom' });
    expect(describeError(new ApiError('nope', 404)).title).toBe('Ressource introuvable');
    expect(describeError(new ApiError('Interdit', 403))).toEqual({ title: 'Chargement impossible', detail: 'Interdit' });
    expect(describeError(new Error('autre'))).toEqual({ title: 'Chargement impossible', detail: 'autre' });
  });

  it('titre un 503 accompagné d’une raison « Projet illisible » et donne la raison', () => {
    const described = describeError(new ApiError('Base Dolt verrouillée', 503, { reason: 'Base Dolt verrouillée' }));

    expect(described).toMatchObject({ title: 'Projet illisible', detail: 'Base Dolt verrouillée' });
  });

  it('garde le titre d’erreur serveur pour un 503 sans raison (passerelle, proxy…)', () => {
    expect(describeError(new ApiError('Erreur HTTP 503', 503))).toEqual({
      title: 'Le serveur a rencontré une erreur',
      detail: 'Erreur HTTP 503',
    });
  });
});
