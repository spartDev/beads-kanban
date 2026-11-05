import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatusSnapshot, TicketHistory } from '../../domain/flow';
import type { ApiErrorBody, Issue, MetricsResponse, Project } from '../../shared/api';
import type { ProjectService } from '../projects/service';
import { buildServer } from '../server';
import { createMetricsService } from './service';

/**
 * bdesk-38k.48 : les jours des métriques sont ceux du navigateur, que la page envoie (`timeZone`) ; le serveur ne compte dans son propre
 * fuseau que pour une requête qui n'en demande pas. Avant, il comptait toujours dans le sien : avec un serveur en UTC et un navigateur à
 * Paris, à 00:30 heure de Paris, la page acceptait une plage qui finit aujourd'hui, le serveur la refusait (400, « dans le futur »), et
 * « 7 derniers jours » s'arrêtait à la veille du jour de l'utilisateur.
 */

const at = (iso: string) => new Date(`${iso}Z`);
/** Mercredi 4 novembre 2026, 23:30 UTC : jeudi 5, 00:30 à Paris (UTC+1 depuis le 25 octobre), encore mercredi à Honolulu (UTC−10) et déjà jeudi 5 à Tokyo. */
const NOW = at('2026-11-04T23:30');
/** Livrée à 23:10 UTC : jeudi 5 à 00:10 à Paris, et un mercredi encore à Greenwich. */
const DELIVERED_AT = at('2026-11-04T23:10');

const project: Project = { id: 'p', name: 'P', path: '/p', prefix: 'p', mode: 'embedded', status: 'ok' };
const issue: Issue = {
  id: 'p-1',
  title: 'Titre de p-1',
  type: 'task',
  status: 'closed',
  priority: 2,
  assignee: null,
  parentId: null,
  createdAt: '2026-11-02T08:00:00.000Z',
  updatedAt: '2026-11-04T23:10:00.000Z',
  closedAt: '2026-11-04T23:10:00.000Z',
  blockedBy: [],
};

/** Un Projet dont le seul ticket est une Livraison, et qui compte ses lectures d'historique. */
function lateDelivery() {
  const statuses: StatusSnapshot[] = [
    { status: 'open', at: at('2026-11-02T08:00') },
    { status: 'in_progress', at: at('2026-11-03T09:00') },
    { status: 'closed', at: DELIVERED_AT },
  ];
  const history: TicketHistory = { id: 'p-1', type: 'task', statusSnapshots: statuses, dependencies: [] };
  const calls = { list: 0, histories: 0 };
  const service: ProjectService = {
    list: async () => {
      calls.list++;
      return { projects: [project], ignored: [] };
    },
    head: async () => 'h1',
    issues: async () => [issue],
    histories: async () => {
      calls.histories++;
      return [history];
    },
    issue: async () => {
      throw new Error('inutile ici');
    },
  };
  return { service, calls };
}

/** Un service de métriques dont le fuseau par défaut est UTC : le serveur lancé avec TZ=UTC, ou sans fuseau lisible. */
const serverInUtc = (projects: ProjectService) => createMetricsService(projects, { now: () => NOW, timeZone: 'UTC' });

describe('service de métriques : le fuseau que la requête demande (bdesk-38k.48)', () => {
  const week = { projects: [], period: { range: '7d' as const } };

  it('compte les jours dans le fuseau demandé : à 00:30 à Paris, « 7 derniers jours » finit aujourd’hui, jeudi 5', async () => {
    const response = await serverInUtc(lateDelivery().service).compute({ ...week, timeZone: 'Europe/Paris' });

    expect(response.timeZone).toBe('Europe/Paris');
    expect(response.period).toMatchObject({ from: '2026-10-30', to: '2026-11-05', days: 7 });
  });

  it('compte dans le sien quand la requête n’en demande pas : mercredi 4, le jour d’UTC', async () => {
    const response = await serverInUtc(lateDelivery().service).compute(week);

    expect(response.timeZone).toBe('UTC');
    expect(response.period).toMatchObject({ from: '2026-10-29', to: '2026-11-04', days: 7 });
  });

  it('accepte la plage qui finit aujourd’hui pour le navigateur, que le serveur refuserait dans son fuseau (« dans le futur »)', async () => {
    const metrics = serverInUtc(lateDelivery().service);
    const endsToday = { projects: [], period: { from: '2026-10-30', to: '2026-11-05' } };

    await expect(metrics.compute(endsToday)).rejects.toMatchObject({ name: 'InvalidPeriodError' });
    await expect(metrics.compute({ ...endsToday, timeZone: 'Europe/Paris' })).resolves.toMatchObject({
      timeZone: 'Europe/Paris',
      period: { from: '2026-10-30', to: '2026-11-05' },
    });
  });

  it('refuse la plage qui finit demain pour le navigateur : dans son fuseau, elle est dans le futur', async () => {
    // Jeudi 5 est déjà là à Paris et à Tokyo, pas à Honolulu, où il est 13:30 le mercredi 4.
    const endsOnThe5th = { projects: [], period: { from: '2026-10-30', to: '2026-11-05' } };

    await expect(serverInUtc(lateDelivery().service).compute({ ...endsOnThe5th, timeZone: 'Pacific/Honolulu' })).rejects.toMatchObject({
      name: 'InvalidPeriodError',
    });
  });

  it('range la Livraison de 00:10 à Paris dans le jour et dans l’heure du navigateur : jeudi 5, 0 h', async () => {
    const metrics = serverInUtc(lateDelivery().service);

    const paris = await metrics.compute({ ...week, timeZone: 'Europe/Paris' });
    const utc = await metrics.compute(week);

    expect(paris.buckets.at(-1)).toMatchObject({ from: '2026-11-05', deliveries: 1 });
    expect(paris.health.activity.cells[3]?.[0]).toBe(1); // jeudi (3), 0 h
    expect(utc.buckets.at(-1)).toMatchObject({ from: '2026-11-04', deliveries: 1 });
    expect(utc.health.activity.cells[2]?.[23]).toBe(1); // mercredi (2), 23 h
  });

  it('sert deux fuseaux avec une seule lecture de l’historique : l’analyse d’un Projet ne dépend pas du fuseau', async () => {
    const { service, calls } = lateDelivery();
    const metrics = serverInUtc(service);

    const [paris, tokyo, honolulu] = [
      await metrics.compute({ ...week, timeZone: 'Europe/Paris' }),
      await metrics.compute({ ...week, timeZone: 'Asia/Tokyo' }),
      await metrics.compute({ ...week, timeZone: 'Pacific/Honolulu' }),
    ];

    expect([paris.period.to, tokyo.period.to, honolulu.period.to]).toEqual(['2026-11-05', '2026-11-05', '2026-11-04']);
    expect(calls.histories).toBe(1);
  });
});

describe('GET /api/metrics?timeZone=… (bdesk-38k.48)', () => {
  const config = { roots: [], projects: [], hiddenProjects: [] };
  const apps: { close(): Promise<unknown> }[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  function serve() {
    const { service, calls } = lateDelivery();
    const app = buildServer({ config, projects: service, metrics: serverInUtc(service) });
    apps.push(app);
    const get = (url: string) => app.inject({ method: 'GET', url });
    return { get, calls };
  }

  it('compte « 7 derniers jours » dans le fuseau du navigateur : ils finissent jeudi 5, pas mercredi 4', async () => {
    const { get } = serve();

    const res = await get('/api/metrics?range=7d&timeZone=Europe%2FParis');

    expect(res.statusCode).toBe(200);
    expect(res.json<MetricsResponse>()).toMatchObject({ timeZone: 'Europe/Paris', period: { from: '2026-10-30', to: '2026-11-05' } });
  });

  it('accepte à 00:30 à Paris la plage de la page, qu’il refusait (400) quand il ne connaissait pas le fuseau du navigateur', async () => {
    const { get } = serve();
    const range = 'from=2026-10-30&to=2026-11-05';

    const before = await get(`/api/metrics?${range}`);
    const after = await get(`/api/metrics?${range}&timeZone=Europe%2FParis`);

    expect(before.statusCode).toBe(400);
    expect(before.json<ApiErrorBody>().message).toContain('dans le futur');
    expect(after.statusCode).toBe(200);
    expect(after.json<MetricsResponse>()).toMatchObject({ timeZone: 'Europe/Paris', period: { to: '2026-11-05' } });
  });

  it('garde le fuseau du serveur pour une requête qui n’en demande pas', async () => {
    const { get } = serve();

    const res = await get('/api/metrics?range=7d');

    expect(res.json<MetricsResponse>()).toMatchObject({ timeZone: 'UTC', period: { to: '2026-11-04' } });
  });

  // Relecture, bug 1 : Chromium connaît `America/Coyhaique` (tz 2025b) et Node 22.13 non (ICU 76.1, tz 2024b). Avec un 400, la page Métriques et la Vue
  // globale restaient hors service pour ce navigateur, alors que HEAD y marchait. Le serveur compte maintenant dans son fuseau et le dit.
  describe('un fuseau que le serveur ne connaît pas (Node 22.13 pour America/Coyhaique)', () => {
    it.each([
      ['un fuseau bien formé qu’aucune base ne connaît', 'Mars%2FPhobos'],
      ['le nom que le moteur donne à un fuseau qu’il ne connaît pas', 'Etc%2FUnknown'],
      ['une faute de frappe', 'Europe%2FPariss'],
    ])('%s : 200, compté dans le fuseau du serveur, que la réponse nomme', async (_why, zone) => {
      const { get } = serve();

      const res = await get(`/api/metrics?range=7d&timeZone=${zone}`);

      expect(res.statusCode).toBe(200);
      expect(res.json<MetricsResponse>()).toMatchObject({ timeZone: 'UTC', period: { from: '2026-10-29', to: '2026-11-04' } });
    });

    it('ne refuse pas non plus la plage du jour du serveur : la page, qui compte « aujourd’hui » dans le fuseau de la réponse, la demande ensuite', async () => {
      const { get } = serve();

      const res = await get('/api/metrics?from=2026-10-29&to=2026-11-04&timeZone=Mars%2FPhobos');

      expect(res.statusCode).toBe(200);
      expect(res.json<MetricsResponse>()).toMatchObject({ timeZone: 'UTC', period: { from: '2026-10-29', to: '2026-11-04' } });
    });

    it('lit les Projets et sert les mêmes chiffres que sans fuseau demandé', async () => {
      const { get, calls } = serve();

      const unknown = (await get('/api/metrics?range=7d&timeZone=Mars%2FPhobos')).json<MetricsResponse>();
      const none = (await get('/api/metrics?range=7d')).json<MetricsResponse>();

      expect({ ...unknown, generatedAt: '' }).toEqual({ ...none, generatedAt: '' });
      expect(calls.list).toBe(2);
    });
  });

  // Relecture, bug 2 : `Intl` accepte un nom quelle que soit sa casse ; le serveur le renvoyait tel quel, et gardait des formateurs par orthographe.
  describe('un fuseau écrit autrement : la réponse le nomme comme le moteur', () => {
    it.each([
      ['eUrOpE%2FpArIs', 'Europe/Paris'],
      ['EUROPE%2FPARIS', 'Europe/Paris'],
      ['europe%2Fparis', 'Europe/Paris'],
      ['utc', 'UTC'],
      ['etc%2Futc', 'UTC'],
    ])('timeZone=%s : « timeZone » vaut %s dans la réponse', async (zone, canonical) => {
      const { get } = serve();

      const res = await get(`/api/metrics?range=7d&timeZone=${zone}`);

      expect(res.statusCode).toBe(200);
      expect(res.json<MetricsResponse>().timeZone).toBe(canonical);
    });

    it('sert la même réponse, jours compris, à toutes les casses d’un fuseau', async () => {
      const { get } = serve();

      const bodies = [];
      for (const zone of ['Europe%2FParis', 'eUrOpE%2FpArIs', 'EUROPE%2FPARIS']) {
        bodies.push({ ...(await get(`/api/metrics?range=7d&timeZone=${zone}`)).json<MetricsResponse>(), generatedAt: '' });
      }

      expect(bodies[1]).toEqual(bodies[0]);
      expect(bodies[2]).toEqual(bodies[0]);
      expect(bodies[0]).toMatchObject({ timeZone: 'Europe/Paris', period: { to: '2026-11-05' } });
    });
  });

  // Ce qui reste refusé : une requête mal faite, pas un fuseau que le serveur ignore.
  it.each([
    ['vide', 'timeZone=', 'ne peut pas être vide'],
    ['répété', 'timeZone=UTC&timeZone=Europe%2FParis', 'une fois'],
  ])('refuse un fuseau %s par un 400 qui le dit, sans lire un seul Projet', async (_why, query, fragment) => {
    const { get, calls } = serve();

    const res = await get(`/api/metrics?range=7d&${query}`);

    expect(res.statusCode).toBe(400);
    expect(res.json<ApiErrorBody>().message).toContain(fragment);
    expect(calls.list).toBe(0);
  });
});
