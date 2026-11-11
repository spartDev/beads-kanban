import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { metricsFixture, stubChartWidth, stubMetricsApi, warmUpMetricsPages, type MetricsReply } from '../metrics/testing';
import { bdeskIssues, mpmIssues, projectsResponse } from '../test/fixtures';
import { renderApp } from '../test/render';
import { installFakeResizeObserver, type FakeResizeObservers } from '../test/resizeObserver';
import { withTimeZone } from '../test/timeZone';

/**
 * bdesk-38k.81 (1) : quand le fuseau du navigateur change, le squelette remplace les chiffres de l'ancien fuseau (bdesk-38k.79) et la page rétrécissait : le défilement était perdu.
 * Le squelette garde donc la hauteur des chiffres qu'il remplace, le temps de la réponse, et les chiffres qui arrivent ne laissent pas l'ancrage du défilement suivre leur première mise en page.
 * Dans jsdom, rien n'a de taille : le test dit à la page quelle hauteur le navigateur a mesurée pour ses chiffres (`ResizeObserver`), et lit ce qu'elle demande à la mise en page.
 * Ce que Chromium en fait est mesuré dans la preuve de bdesk-38k.81.
 */

const api = (reply: (url: URL) => MetricsReply | Promise<MetricsReply>) => stubMetricsApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } }, reply);

warmUpMetricsPages();

// Le navigateur est à Paris, comme les fixtures ; il changera de fuseau (`process.env.TZ`, celui de `Date`, que la page lit à chaque rendu).
withTimeZone('Europe/Paris');

let resize: FakeResizeObservers;

// Seule `Date` est figée (le 2 novembre 2026, 20:00 à Paris, l'instant des fixtures) : les minuteries de React Query restent réelles.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T19:00:15.242Z'));
  stubChartWidth(640);
  resize = installFakeResizeObserver();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.env.TZ = 'Europe/Paris';
});

const skeleton = () => screen.findByRole('status', { name: 'Chargement des métriques' });
const noSkeleton = () => expect(screen.queryByRole('status', { name: 'Chargement des métriques' })).toBeNull();
/** Le nœud que la page mesure : l'enveloppe des chiffres, dont le premier enfant porte `aria-busy`. */
const figures = () => {
  const node = screen.getByRole('heading', { level: 2, name: 'Indicateurs' }).closest('[aria-busy]')?.parentElement;
  if (!node) throw new Error('Les chiffres ne sont pas à l’écran.');
  return node;
};

/** Le serveur compte dans le fuseau qu'on lui demande ; les réponses des fuseaux de `held` attendent que le test les libère. */
function serverHolding(...held: string[]) {
  const releases = new Map<string, () => void>();
  api((url) => {
    const timeZone = url.searchParams.get('timeZone') ?? 'Europe/Paris';
    const answer = metricsFixture({ timeZone });
    return held.includes(timeZone) ? new Promise<MetricsReply>((resolve) => releases.set(timeZone, () => resolve(answer))) : answer;
  });
  return { release: (timeZone: string) => act(async () => releases.get(timeZone)?.()) };
}

async function loaded(path = '/p/bdesk/metrics', { strict = false }: { strict?: boolean } = {}) {
  const app = renderApp(path, { strict });
  await screen.findByRole('heading', { level: 2, name: 'Indicateurs' });
  return app;
}

/** Le navigateur change de fuseau ; la page le voit au rendu suivant, que « Actualiser » provoque sans rien changer d'autre (la période, le Projet, l'adresse restent). */
async function travelTo(timeZone: string, user: ReturnType<typeof renderApp>['user']) {
  process.env.TZ = timeZone;
  await user.click(screen.getByRole('button', { name: 'Actualiser les métriques' }));
}

describe('la page Métriques quand le fuseau du navigateur change', () => {
  it('garde la hauteur des chiffres que le squelette remplace : la page ne rétrécit pas le temps de la réponse', async () => {
    const server = serverHolding('Asia/Tokyo');
    const { user } = await loaded();
    resize.emit(figures(), 4090); // le navigateur a mesuré les chiffres à l'écran

    await travelTo('Asia/Tokyo', user);

    expect((await skeleton()).style.minHeight).toBe('4090px');
    await server.release('Asia/Tokyo');
    expect(await screen.findByRole('heading', { level: 2, name: 'Indicateurs' })).toBeTruthy();
    noSkeleton(); // la réponse arrive : le squelette part, et la hauteur qu'il gardait avec lui
  });

  it('garde la hauteur sous StrictMode, où le développement monte, démonte et remonte la page : la mesure survit aux observateurs de trop', async () => {
    const server = serverHolding('Asia/Tokyo');
    const { user } = await loaded('/p/bdesk/metrics', { strict: true });
    resize.emit(figures(), 4090);

    await travelTo('Asia/Tokyo', user);

    expect((await skeleton()).style.minHeight).toBe('4090px');
    await server.release('Asia/Tokyo');
    expect(await screen.findByRole('heading', { level: 2, name: 'Indicateurs' })).toBeTruthy();
    noSkeleton();
  });

  it('garde aussi la hauteur des chiffres de la Vue globale, que le Projet ou la page ne change pas', async () => {
    const server = serverHolding('Asia/Tokyo');
    const { user } = await loaded('/');
    resize.emit(figures(), 3174);

    await travelTo('Asia/Tokyo', user);

    expect((await skeleton()).style.minHeight).toBe('3174px');
    await server.release('Asia/Tokyo');
  });

  it('garde la dernière hauteur mesurée, pas la première : les chiffres ont pu changer de hauteur depuis (une table ouverte, une fenêtre redimensionnée)', async () => {
    const server = serverHolding('Asia/Tokyo');
    const { user } = await loaded();
    resize.emit(figures(), 3300);
    resize.emit(figures(), 4268);

    await travelTo('Asia/Tokyo', user);

    expect((await skeleton()).style.minHeight).toBe('4268px');
    await server.release('Asia/Tokyo');
  });

  it('mesure de nouveau les chiffres qui sont revenus : un second changement de fuseau garde leur hauteur, pas celle des premiers', async () => {
    const server = serverHolding('Asia/Tokyo', 'Pacific/Honolulu');
    const { user } = await loaded();
    resize.emit(figures(), 4090);
    await travelTo('Asia/Tokyo', user);
    expect((await skeleton()).style.minHeight).toBe('4090px');
    await server.release('Asia/Tokyo');
    await screen.findByRole('heading', { level: 2, name: 'Indicateurs' });
    resize.emit(figures(), 2500); // les chiffres de Tokyo sont moins hauts

    await travelTo('Pacific/Honolulu', user);

    expect((await skeleton()).style.minHeight).toBe('2500px');
    await server.release('Pacific/Honolulu');
  });

  it('exclut les chiffres qui arrivent de l’ancrage du défilement jusqu’à leur première mesure : leur première mise en page n’est pas la dernière', async () => {
    const server = serverHolding('Asia/Tokyo');
    const { user } = await loaded();
    resize.emit(figures(), 4090);
    await travelTo('Asia/Tokyo', user);
    await skeleton();

    await server.release('Asia/Tokyo');
    await screen.findByRole('heading', { level: 2, name: 'Indicateurs' });
    expect(figures().style.overflowAnchor).toBe('none'); // le navigateur ne les a pas encore mesurés : leurs graphiques tiennent encore leur place par un fond de chargement

    resize.emit(figures(), 4090);

    expect(figures().style.overflowAnchor).toBe(''); // mesurés : l'ancrage leur est rendu, comme à toute la page
  });

  it('ne réserve rien à l’ouverture : sans chiffres avant lui, le squelette du premier calcul est celui de toujours', async () => {
    api(() => new Promise<MetricsReply>(() => undefined));
    renderApp('/p/bdesk/metrics');

    expect((await skeleton()).getAttribute('style')).toBeNull();
  });

  it('ne réserve rien pour un autre Projet : la hauteur des chiffres de l’un ne vaut pas pour ceux de l’autre', async () => {
    api((url) => (url.searchParams.get('project') === 'mpm' ? new Promise<MetricsReply>(() => undefined) : metricsFixture()));
    const { router } = await loaded('/p/bdesk/metrics');
    resize.emit(figures(), 4090);

    await act(async () => void router.navigate('/p/mpm/metrics'));

    expect((await skeleton()).getAttribute('style')).toBeNull();
  });

  it('ne réserve rien à la Vue globale que l’on ouvre depuis les chiffres d’un Projet', async () => {
    api((url) => (url.searchParams.get('project') === null ? new Promise<MetricsReply>(() => undefined) : metricsFixture()));
    const { router } = await loaded('/p/bdesk/metrics');
    resize.emit(figures(), 4090);

    await act(async () => void router.navigate('/'));

    expect((await skeleton()).getAttribute('style')).toBeNull();
  });

  it('ne garde plus rien quand l’attente s’est finie par une erreur : « Réessayer » ouvre un squelette ordinaire, pas une page haute comme les chiffres d’avant', async () => {
    let tokyo: 'fails' | 'hangs' = 'fails';
    api((url) => {
      if (url.searchParams.get('timeZone') !== 'Asia/Tokyo') return metricsFixture();
      return tokyo === 'fails' ? new Error('database is locked') : new Promise<MetricsReply>(() => undefined);
    });
    const { user } = await loaded();
    resize.emit(figures(), 4090);

    await travelTo('Asia/Tokyo', user);
    expect(await screen.findByRole('alert')).toBeTruthy(); // Tokyo échoue : l'erreur remplace le squelette
    tokyo = 'hangs';
    await user.click(screen.getByRole('button', { name: /Réessayer/ }));

    expect((await skeleton()).getAttribute('style')).toBeNull();
  });
});
