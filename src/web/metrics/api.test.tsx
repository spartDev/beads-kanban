import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
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

/** Un client que le test garde : il y sème des réponses, les regarde quitter le cache, et les relit par un autre rendu. */
function keptClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
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
  const inParis = () => metricsFixture({ timeZone: 'Europe/Paris', timeZoneHonoured: true });
  const parisRequest = (period: MetricsRequest['period'], project = 'bdesk'): MetricsRequest => ({ project, period, timeZone: 'Europe/Paris' });
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

  // bdesk-38k.79 (R-d) : « la dernière arrivée » était faux. Des réponses que la page voit d'un coup (à l'ouverture d'une vue sur un cache déjà rempli, des réponses semées par un test) n'ont pas
  // d'ordre d'arrivée : elles se départagent par leur date, puis par l'ordre du cache, celui de la création des requêtes (une requête relue garde sa place). Ce test fait arriver en dernier la
  // première requête créée, et ne lit qu'après : si le commentaire de `lastZoneAnswer` redevenait faux, c'est elle qui l'emporterait ici. Lues l'une après l'autre, c'est la dernière vue qui
  // l'emporte (voir plus bas).
  it('départage deux réponses de même date, vues d’un coup, par l’ordre du cache : la dernière requête créée', () => {
    const c = client();
    const first = metricsKey({ project: 'bdesk', period: week, timeZone: 'Europe/Paris' });
    const second = metricsKey({ project: 'bdesk', period: month, timeZone: 'Europe/Paris' });
    c.getQueryCache().build(c, { queryKey: first });
    c.getQueryCache().build(c, { queryKey: second });
    c.setQueryData(second, inParis(), { updatedAt: 1_000 });
    c.setQueryData(first, inUtc, { updatedAt: 1_000 }); // la première requête créée répond en dernier, au même instant

    expect(lastZoneAnswer(c, 'Europe/Paris')).toEqual({ counted: 'Europe/Paris', honoured: true }); // celle de la seconde
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

  // bdesk-38k.79 (R-b) : le cache retire une requête cinq minutes après que plus aucune vue ne l'observe. Ce que le serveur a dit d'un fuseau ne vieillit pas avec elle :
  // `lastZoneAnswer` garde ce qu'elle a lu, par client, tant que la page est ouverte.
  describe('ce qu’elle a lu reste connu quand la requête qui le portait quitte le cache', () => {
    const paris = parisRequest;

    it('rend la réponse que la requête retirée du cache avait donnée', () => {
      const c = client();
      seed(c, paris(week), inUtc);
      expect(lastZoneAnswer(c, 'Europe/Paris')).toEqual({ counted: 'UTC', honoured: false });

      c.removeQueries({ queryKey: metricsKey(paris(week)) });

      expect(c.getQueryCache().findAll({ queryKey: ['metrics'] })).toHaveLength(0);
      expect(lastZoneAnswer(c, 'Europe/Paris')).toEqual({ counted: 'UTC', honoured: false });
    });

    it('rend le même objet tant que rien de nouveau n’a été dit : une vue qui le lit n’a pas à se redessiner', () => {
      const c = client();
      seed(c, paris(week), inUtc);
      const first = lastZoneAnswer(c, 'Europe/Paris');
      seed(c, paris(month), metricsFixture({ timeZone: 'UTC', timeZoneHonoured: false })); // une autre requête, la même réponse

      expect(lastZoneAnswer(c, 'Europe/Paris')).toBe(first);
      c.removeQueries({ queryKey: ['metrics'] });
      expect(lastZoneAnswer(c, 'Europe/Paris')).toBe(first);
    });

    it('rend le même objet d’un appel à l’autre même quand deux requêtes de même date se contredisent : une vue qui la lit ne boucle pas', () => {
      const c = client();
      seed(c, paris(week), inUtc, 1_000);
      seed(c, paris(month), metricsFixture({ timeZone: 'Europe/Paris', timeZoneHonoured: true }), 1_000);
      const first = lastZoneAnswer(c, 'Europe/Paris');

      expect(first).toEqual({ counted: 'Europe/Paris', honoured: true }); // la dernière requête créée
      expect(lastZoneAnswer(c, 'Europe/Paris')).toBe(first);
      expect(lastZoneAnswer(c, 'Europe/Paris')).toBe(first);
    });

    it('cède à une réponse plus récente, même quand elle contredit la retenue : un serveur mis à jour entre-temps connaît le fuseau', () => {
      const c = client();
      seed(c, paris(week), inUtc, 1_000);
      expect(lastZoneAnswer(c, 'Europe/Paris')?.honoured).toBe(false);
      c.removeQueries({ queryKey: ['metrics'] });

      seed(c, paris(month), metricsFixture({ timeZone: 'Europe/Paris', timeZoneHonoured: true }), 2_000);

      expect(lastZoneAnswer(c, 'Europe/Paris')).toEqual({ counted: 'Europe/Paris', honoured: true });
    });

    it('retient fuseau par fuseau : un navigateur qui change de fuseau n’hérite pas de la retenue de l’autre', () => {
      const c = client();
      seed(c, paris(week), inUtc);
      expect(lastZoneAnswer(c, 'Europe/Paris')).toEqual({ counted: 'UTC', honoured: false });
      c.removeQueries({ queryKey: ['metrics'] });

      expect(lastZoneAnswer(c, 'Asia/Tokyo')).toBeUndefined();
      expect(lastZoneAnswer(c, 'Europe/Paris')).toEqual({ counted: 'UTC', honoured: false });
    });

    it('ne partage rien d’un client à l’autre : chaque cache a sa retenue', () => {
      const a = client();
      const b = client();
      seed(a, paris(week), inUtc);
      expect(lastZoneAnswer(a, 'Europe/Paris')).toEqual({ counted: 'UTC', honoured: false });

      expect(lastZoneAnswer(b, 'Europe/Paris')).toBeUndefined();
    });
  });

  // bdesk-38k.79 (relecture, B1) : l'ordre des réponses ne dépend pas de l'horloge. `dataUpdatedAt` est `Date.now()` : une correction d'horloge (NTP, réglage manuel, machine virtuelle
  // reprise) la fait reculer, et une réponse toute neuve porte alors une date antérieure à celle d'une réponse plus ancienne. Comparer les dates faisait ignorer toute réponse pendant
  // l'écart, même celle de la requête que la page affiche : l'avis restait à côté de chiffres comptés dans le fuseau. La page ordonne ce qu'elle voit : chaque réponse a le rang où elle
  // a été vue la première fois, et la plus haute l'emporte.
  describe('l’ordre des réponses est celui où la page les voit, pas celui de l’horloge', () => {
    const TEN_MINUTES = 600_000;
    const paris = parisRequest;

    it('la requête relue après un recul de l’horloge remplace sa réponse, bien que sa date soit plus ancienne', () => {
      const c = client();
      seed(c, paris(week), inUtc, 2_000_000);
      expect(lastZoneAnswer(c, 'Europe/Paris')).toEqual({ counted: 'UTC', honoured: false });

      seed(c, paris(week), inParis(), 2_000_000 - TEN_MINUTES); // l'horloge a reculé de dix minutes, le serveur a été mis à jour : la même requête, relue, répond autrement

      expect(c.getQueryCache().findAll({ queryKey: ['metrics'] })).toHaveLength(1); // le cache ne porte plus que la réponse honorée
      expect(lastZoneAnswer(c, 'Europe/Paris')).toEqual({ counted: 'Europe/Paris', honoured: true });
    });

    it('une autre requête qui répond après un recul de l’horloge l’emporte aussi', () => {
      const c = client();
      seed(c, paris(week), inUtc, 2_000_000);
      expect(lastZoneAnswer(c, 'Europe/Paris')?.honoured).toBe(false);

      seed(c, paris(month), inParis(), 2_000_000 - TEN_MINUTES);

      expect(lastZoneAnswer(c, 'Europe/Paris')).toEqual({ counted: 'Europe/Paris', honoured: true });
    });

    it('la réponse vue la dernière l’emporte, même créée avant l’autre et de même date', () => {
      const c = client();
      c.getQueryCache().build(c, { queryKey: metricsKey(paris(week)) });
      c.getQueryCache().build(c, { queryKey: metricsKey(paris(month)) });
      c.setQueryData(metricsKey(paris(month)), inParis(), { updatedAt: 1_000 });
      expect(lastZoneAnswer(c, 'Europe/Paris')?.honoured).toBe(true); // la seconde requête créée répond la première, et la page la voit

      c.setQueryData(metricsKey(paris(week)), inUtc, { updatedAt: 1_000 }); // la première requête créée répond ensuite, au même instant

      expect(lastZoneAnswer(c, 'Europe/Paris')).toEqual({ counted: 'UTC', honoured: false });
    });

    it('une relecture qui dit la même chose est la plus récente des réponses : elle ne change ni de contenu ni de date', () => {
      const c = client();
      seed(c, paris(week), inUtc, 1_000);
      seed(c, paris(month), inParis(), 1_000);
      expect(lastZoneAnswer(c, 'Europe/Paris')?.honoured).toBe(true); // vues d'un coup, à date égale : la dernière requête créée

      seed(c, paris(week), metricsFixture({ timeZone: 'UTC', timeZoneHonoured: false }), 1_000); // les 7 jours, relus : la même réponse, au même instant (une horloge figée)

      expect(lastZoneAnswer(c, 'Europe/Paris')).toEqual({ counted: 'UTC', honoured: false });
    });

    it('une requête réinitialisée, puis qui répond de nouveau, est vue de nouveau : son compteur de réponses repart de zéro', () => {
      const c = client();
      seed(c, paris(week), inUtc, 1_000);
      seed(c, paris(month), inParis(), 2_000);
      expect(lastZoneAnswer(c, 'Europe/Paris')?.honoured).toBe(true); // vues d'un coup : la plus récente par la date

      c.getQueryCache().find({ queryKey: metricsKey(paris(week)) })?.reset(); // `resetQueries`, `QueryErrorResetBoundary` : la requête redevient neuve, son compteur de réponses à zéro
      seed(c, paris(week), metricsFixture({ timeZone: 'UTC', timeZoneHonoured: false }), 1_000); // et répond comme la première fois : le compteur vaut un, comme alors

      expect(lastZoneAnswer(c, 'Europe/Paris')).toEqual({ counted: 'UTC', honoured: false });
    });

    it('lire ne classe pas : tant que rien de nouveau n’arrive, la gagnante ne change pas', () => {
      const c = client();
      seed(c, paris(week), inUtc, 1_000);
      seed(c, paris(month), inParis(), 2_000);
      const first = lastZoneAnswer(c, 'Europe/Paris');

      for (let reads = 0; reads < 3; reads++) expect(lastZoneAnswer(c, 'Europe/Paris')).toBe(first);
      expect(first).toEqual({ counted: 'Europe/Paris', honoured: true });
    });

    it('ne cède pas à une réponse que la page avait vue avant la retenue, même plus récente par la date', () => {
      const c = client();
      seed(c, paris(week), inParis(), 3_000_000);
      expect(lastZoneAnswer(c, 'Europe/Paris')?.honoured).toBe(true); // vue la première
      seed(c, paris(month), inUtc, 3_000_000 - TEN_MINUTES); // l'horloge a reculé : la page voit cette réponse ensuite
      expect(lastZoneAnswer(c, 'Europe/Paris')?.honoured).toBe(false);

      c.removeQueries({ queryKey: metricsKey(paris(month)) }); // celle qui portait la retenue quitte le cache ; l'ancienne reste, avec une date plus récente

      expect(lastZoneAnswer(c, 'Europe/Paris')).toEqual({ counted: 'UTC', honoured: false });
    });
  });
});

describe('useZoneAnswer', () => {
  type Props = { request: MetricsRequest };

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

  // bdesk-38k.79 (R-b) : la vue lit la réponse d'une requête qu'elle a quittée (la période précédente, la page d'un Projet) tant que la sienne n'a pas abouti. Si la sienne
  // échoue plus de cinq minutes, le cache retire l'autre (`gcTime`) : l'avis ne doit pas s'en aller, rien n'a dit que le serveur connaît le fuseau.
  describe('quand la requête de la vue échoue plus de cinq minutes', () => {
    const week: MetricsRequest['period'] = { kind: 'preset', range: '7d' };
    const month: MetricsRequest['period'] = { kind: 'preset', range: '30d' };
    const inUtc = () => metricsFixture({ timeZone: 'UTC', timeZoneHonoured: false });
    const FIVE_MINUTES = 5 * 60_000;

    afterEach(() => {
      vi.useRealTimers();
    });

    /** La vue d'une page de Projet, sa période puis l'autre : la première répond, la seconde échoue, durablement. */
    async function weekAnswersMonthFails() {
      // Avant tout rendu : les minuteries du ramasse-miettes de TanStack Query sont posées au moment où une requête perd son dernier observateur.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
      const { client, wrapper } = keptClient();
      vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('range=30d') ? json({ message: 'database is locked' }, 500) : json(inUtc()))));
      const view = renderHook(({ request }: Props) => ({ metrics: useMetrics(request), zone: useZoneAnswer(timeZone) }), {
        wrapper,
        initialProps: { request: { project: 'bdesk', period: week, timeZone } as MetricsRequest },
      });
      await waitFor(() => expect(view.result.current.metrics.isSuccess).toBe(true));
      expect(view.result.current.zone).toEqual({ counted: 'UTC', honoured: false });

      const failing: Props = { request: { project: 'bdesk', period: month, timeZone } };
      view.rerender(failing);
      await waitFor(() => expect(view.result.current.metrics.isError).toBe(true));
      return { client, view, failing };
    }

    it('garde la réponse de la période précédente quand le cache la retire : le rendu suivant sait encore', async () => {
      const { client, view, failing } = await weekAnswersMonthFails();
      expect(view.result.current.zone).toEqual({ counted: 'UTC', honoured: false });

      act(() => void vi.advanceTimersByTime(FIVE_MINUTES + 1_000));
      expect(client.getQueryCache().findAll({ queryKey: ['metrics', 'bdesk', '7d'] })).toHaveLength(0); // le ramasse-miettes a bien eu lieu
      view.rerender(failing);

      expect(view.result.current.metrics.isError).toBe(true); // la requête de la vue échoue toujours
      expect(view.result.current.zone).toEqual({ counted: 'UTC', honoured: false });
    });

    it('la garde tant qu’une vue la lit, aussi longtemps que cela dure : une demi-heure sans réponse', async () => {
      const { view, failing } = await weekAnswersMonthFails();

      act(() => void vi.advanceTimersByTime(30 * 60_000));
      view.rerender(failing);

      expect(view.result.current.metrics.isError).toBe(true);
      expect(view.result.current.zone).toEqual({ counted: 'UTC', honoured: false });
    });

    it('n’en prête rien à un autre fuseau demandé', async () => {
      const { client, view, failing } = await weekAnswersMonthFails();
      act(() => void vi.advanceTimersByTime(FIVE_MINUTES + 1_000));
      view.rerender(failing);

      const tokyo = renderHook(() => useZoneAnswer('Asia/Tokyo'), {
        wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
      });

      expect(tokyo.result.current).toBeUndefined();
    });
  });

  // bdesk-38k.79 (relecture, R3) : ce que le serveur a dit de son fuseau ne vaut que tant qu'il n'a pas pu changer. Un serveur ne change de fuseau qu'en redémarrant, ce que la page ne voit pas
  // (le flux en direct ne suit ni la Vue globale ni les pages de métriques). La retenue suit donc la règle des requêtes : elle reste tant qu'une vue la lit, puis cinq minutes (le `gcTime` par
  // défaut) ; au-delà, la page ne sait plus rien du serveur jusqu'à sa première réponse, comme à l'ouverture.
  describe('la retenue vit tant qu’une vue la lit, puis cinq minutes', () => {
    const FIVE_MINUTES = 5 * 60_000;
    const request: MetricsRequest = { project: 'bdesk', period: { kind: 'preset', range: '7d' }, timeZone };
    const answer = { counted: 'UTC', honoured: false };

    afterEach(() => {
      vi.useRealTimers();
    });

    /** Un cache où une vue vient de lire une réponse, que le cache a retirée aussitôt : seule la retenue la porte. Le temps est simulé avant tout rendu. */
    function readThenCacheForgets() {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
      const { client } = keptClient();
      client.setQueryData(metricsKey(request), metricsFixture({ timeZone: 'UTC', timeZoneHonoured: false }));
      const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
      const reader = () => renderHook(() => useZoneAnswer(timeZone), { wrapper });
      const first = reader();
      expect(first.result.current).toEqual(answer);
      client.removeQueries({ queryKey: ['metrics'] });
      expect(client.getQueryCache().findAll({ queryKey: ['metrics'] })).toHaveLength(0);
      return { client, reader, first };
    }

    it('l’oublie cinq minutes après que la dernière vue qui la lit est partie : le serveur a pu être mis à jour entre-temps', () => {
      const { reader, first } = readThenCacheForgets();
      first.unmount();

      act(() => void vi.advanceTimersByTime(FIVE_MINUTES - 1_000));
      const early = reader();
      expect(early.result.current).toEqual(answer); // moins de cinq minutes : la page sait encore
      early.unmount();

      act(() => void vi.advanceTimersByTime(FIVE_MINUTES + 1_000));
      const late = reader();

      expect(late.result.current).toBeUndefined(); // plus de cinq minutes sans vue : comme à l'ouverture
    });

    it('une vue qui revient avant l’échéance annule l’oubli, qui compte cinq minutes de plus après son propre départ', () => {
      const { reader, first } = readThenCacheForgets();
      first.unmount();
      act(() => void vi.advanceTimersByTime(FIVE_MINUTES - 1_000));
      const back = reader();

      act(() => void vi.advanceTimersByTime(3 * FIVE_MINUTES)); // elle est là : l'échéance de la première vue passe sans rien oublier
      back.rerender();
      expect(back.result.current).toEqual(answer);
      back.unmount();
      act(() => void vi.advanceTimersByTime(FIVE_MINUTES - 1_000));
      const again = reader();
      expect(again.result.current).toEqual(answer);
      again.unmount();
      act(() => void vi.advanceTimersByTime(FIVE_MINUTES + 1_000));

      expect(reader().result.current).toBeUndefined();
    });

    it('n’oublie rien tant qu’une des vues qui la lisent est là', () => {
      const { reader, first } = readThenCacheForgets();
      const second = reader();
      first.unmount();

      act(() => void vi.advanceTimersByTime(2 * FIVE_MINUTES));
      second.rerender();
      expect(second.result.current).toEqual(answer);
      second.unmount();
      act(() => void vi.advanceTimersByTime(FIVE_MINUTES + 1_000));

      expect(reader().result.current).toBeUndefined();
    });

    it('n’oublie rien sous StrictMode, qui monte, démonte et remonte la vue : elle est là', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
      const { client } = keptClient();
      client.setQueryData(metricsKey(request), metricsFixture({ timeZone: 'UTC', timeZoneHonoured: false }));
      const strict = ({ children }: { children: ReactNode }) => (
        <StrictMode>
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        </StrictMode>
      );
      const view = renderHook(() => useZoneAnswer(timeZone), { wrapper: strict });
      client.removeQueries({ queryKey: ['metrics'] });

      act(() => void vi.advanceTimersByTime(2 * FIVE_MINUTES));
      view.rerender();

      expect(view.result.current).toEqual(answer);
    });
  });

  // La vue se redessine quand ce que le cache sait du serveur change, même si ce n'est pas sa propre requête qui a changé (lu sans abonnement, une réponse qui arrive ailleurs ne la
  // ferait pas se redessiner). TanStack Query prévient ses abonnés une minuterie plus tard (`notifyManager`) : ces tests attendent la notification.
  describe('suit le cache', () => {
    const request: MetricsRequest = { project: 'bdesk', period: { kind: 'preset', range: '7d' }, timeZone };

    it('se redessine quand la réponse du cache change, sans autre rendu', async () => {
      const { client, wrapper } = keptClient();
      client.setQueryData(metricsKey(request), metricsFixture({ timeZone: 'UTC', timeZoneHonoured: false }));
      const view = renderHook(() => useZoneAnswer(timeZone), { wrapper });
      expect(view.result.current).toEqual({ counted: 'UTC', honoured: false });

      act(() => void client.setQueryData(metricsKey(request), metricsFixture({ timeZone: 'Europe/Paris', timeZoneHonoured: true }))); // le serveur a été mis à jour

      await waitFor(() => expect(view.result.current).toEqual({ counted: 'Europe/Paris', honoured: true }));
    });

    it('se redessine quand une première réponse arrive dans le cache', async () => {
      const { client, wrapper } = keptClient();
      const view = renderHook(() => useZoneAnswer(timeZone), { wrapper });
      expect(view.result.current).toBeUndefined();

      act(() => void client.setQueryData(metricsKey(request), metricsFixture({ timeZone: 'UTC', timeZoneHonoured: false })));

      await waitFor(() => expect(view.result.current).toEqual({ counted: 'UTC', honoured: false }));
    });

    it('ne boucle pas quand deux requêtes de même date se contredisent (une horloge figée)', () => {
      const { client, wrapper } = keptClient();
      client.setQueryData(metricsKey(request), metricsFixture({ timeZone: 'UTC', timeZoneHonoured: false }), { updatedAt: 1_000 });
      client.setQueryData(metricsKey({ ...request, period: { kind: 'preset', range: '30d' } }), metricsFixture({ timeZone: 'Europe/Paris', timeZoneHonoured: true }), { updatedAt: 1_000 });
      let renders = 0;
      const view = renderHook(
        () => {
          renders += 1;
          return useZoneAnswer(timeZone);
        },
        { wrapper },
      );

      expect(view.result.current).toEqual({ counted: 'Europe/Paris', honoured: true });
      expect(renders).toBe(1);
    });

    it('ne se redessine pas pour ce qu’il ne lit pas : un autre fuseau, une autre requête, la même réponse', async () => {
      const { client, wrapper } = keptClient();
      client.setQueryData(metricsKey(request), metricsFixture({ timeZone: 'UTC', timeZoneHonoured: false }));
      let renders = 0;
      renderHook(
        () => {
          renders += 1;
          return useZoneAnswer(timeZone);
        },
        { wrapper },
      );
      const before = renders;

      act(() => void client.setQueryData(metricsKey({ ...request, timeZone: 'Asia/Tokyo' }), metricsFixture({ timeZone: 'Asia/Tokyo' })));
      act(() => void client.setQueryData(metricsKey({ ...request, period: { kind: 'preset', range: '30d' } }), metricsFixture({ timeZone: 'UTC', timeZoneHonoured: false })));
      act(() => void client.setQueryData(['projects'], { projects: [] }));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20)); // le temps que TanStack Query prévienne ses abonnés
      });

      expect(renders).toBe(before);
    });
  });

  // bdesk-38k.79 : pourquoi la page retient la réponse, et ne s'abonne pas à la requête qui la porte. Un observateur retient aussi la lecture en cours de cette requête :
  // TanStack Query n'annule une lecture que quand son dernier observateur part, et le serveur calculerait pour une période que personne ne regarde plus.
  it('n’empêche pas d’annuler la relecture d’une période que la vue quitte', async () => {
    const aborted: Record<string, boolean> = {};
    const reads: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        reads.push(url);
        if (reads.length === 1) return Promise.resolve(json(metricsFixture({ timeZone: 'UTC', timeZoneHonoured: false })));
        // Les relectures et les lectures suivantes ne finissent pas : seule leur annulation compte.
        return new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => {
            aborted[url] = true;
            reject(new DOMException('annulée', 'AbortError'));
          }),
        );
      }),
    );
    const { wrapper } = keptClient();
    const view = renderHook(({ request }: Props) => ({ metrics: useMetrics(request), zone: useZoneAnswer(timeZone) }), {
      wrapper,
      initialProps: { request: { project: 'bdesk', period: { kind: 'preset', range: '7d' }, timeZone } as MetricsRequest },
    });
    await waitFor(() => expect(view.result.current.zone).toEqual({ counted: 'UTC', honoured: false }));

    act(() => void view.result.current.metrics.refetch()); // « Actualiser » : la relecture de la période part, et ne finit pas
    await waitFor(() => expect(reads).toHaveLength(2));
    view.rerender({ request: { project: 'bdesk', period: { kind: 'preset', range: '30d' }, timeZone } }); // l'utilisateur change de période pendant la relecture

    await waitFor(() => expect(aborted[reads[1] as string]).toBe(true));
    expect(view.result.current.zone).toEqual({ counted: 'UTC', honoured: false }); // et la réponse de la période quittée est toujours connue
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
  // bdesk-38k.79 (R-a) : les chiffres du fuseau précédent ne restent pas à l'écran en attendant : jours, semaines et heures y sont comptés autrement, et ils passaient sans avis
  // (l'avis suit la dernière réponse au fuseau du navigateur, pas à celui d'avant). Même règle que pour un autre Projet : mieux vaut le squelette que des chiffres qui ne sont pas les siens.
  it('redemande les chiffres dans le nouveau fuseau quand celui du navigateur change, sans garder ceux du précédent en attendant', async () => {
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

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPlaceholderData).toBe(false);
    expect(result.current.isPending).toBe(true);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/metrics?project=bdesk&range=7d&timeZone=Europe%2FParis',
      '/api/metrics?project=bdesk&range=7d&timeZone=Asia%2FTokyo',
    ]);

    release?.();
    await waitFor(() => expect(result.current.data?.timeZone).toBe('Asia/Tokyo'));
    expect(result.current.isPlaceholderData).toBe(false);
  });

  it('ne garde pas non plus les chiffres du fuseau précédent quand la période change en même temps', async () => {
    let release: (() => void) | undefined;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('Asia%2FTokyo')) await new Promise<void>((resolve) => (release = resolve));
      return json(metricsFixture({ timeZone: url.includes('Asia%2FTokyo') ? 'Asia/Tokyo' : 'Europe/Paris' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(({ request }: { request: MetricsRequest }) => useMetrics(request), {
      wrapper: sharedWrapper(),
      initialProps: { request: { project: 'bdesk', period: { kind: 'preset', range: '7d' }, timeZone: 'Europe/Paris' } as MetricsRequest },
    });
    await waitFor(() => expect(result.current.data?.timeZone).toBe('Europe/Paris'));

    rerender({ request: { project: 'bdesk', period: { kind: 'preset', range: '30d' }, timeZone: 'Asia/Tokyo' } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPlaceholderData).toBe(false);

    release?.();
    await waitFor(() => expect(result.current.data?.timeZone).toBe('Asia/Tokyo'));
  });

  it('rend au contraire, tout de suite, les chiffres déjà en cache du fuseau retrouvé', async () => {
    const fetchMock = vi.fn(async (url: string) => json(metricsFixture({ timeZone: url.includes('Asia%2FTokyo') ? 'Asia/Tokyo' : 'Europe/Paris' })));
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(({ request }: { request: MetricsRequest }) => useMetrics(request), {
      wrapper: sharedWrapper(),
      initialProps: { request: { project: 'bdesk', period: { kind: 'preset', range: '7d' }, timeZone: 'Europe/Paris' } as MetricsRequest },
    });
    await waitFor(() => expect(result.current.data?.timeZone).toBe('Europe/Paris'));
    rerender({ request: { project: 'bdesk', period: { kind: 'preset', range: '7d' }, timeZone: 'Asia/Tokyo' } });
    await waitFor(() => expect(result.current.data?.timeZone).toBe('Asia/Tokyo'));

    rerender({ request: { project: 'bdesk', period: { kind: 'preset', range: '7d' }, timeZone: 'Europe/Paris' } });

    expect(result.current.data?.timeZone).toBe('Europe/Paris'); // le cache de ce fuseau, compté dans ce fuseau : ce n'est pas un provisoire
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
