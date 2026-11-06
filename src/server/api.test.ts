import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { inspect } from 'node:util';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvalidPeriodError } from '../domain/calendar';
import type { TicketHistory } from '../domain/flow';
import type { Issue, IssueDetail, MetricsResponse, Project } from '../shared/api';
import { ReadAborted } from './abort';
import { createMetricsService, type MetricsQuery, type MetricsService } from './metrics/service';
import {
  IssueNotFoundError,
  ProjectNotFoundError,
  type ProjectService,
  ProjectUnreadableError,
} from './projects/service';
import { buildServer } from './server';

const config = { roots: [], projects: [], hiddenProjects: [] };

const project: Project = {
  id: 'beads-desktop',
  name: 'beads-desktop',
  path: '/Users/someone/Developer/beads-desktop',
  prefix: 'bdesk',
  mode: 'embedded',
  status: 'ok',
};

const issue: Issue = {
  id: 'bdesk-38k.4',
  title: 'Découverte des Projets',
  type: 'feature',
  status: 'in_progress',
  priority: 1,
  assignee: 'spartDev',
  parentId: 'bdesk-38k',
  createdAt: '2026-10-19T16:46:39.000Z',
  updatedAt: '2026-10-20T10:39:21.000Z',
  closedAt: null,
  blockedBy: [],
};

const detail: IssueDetail = {
  ...issue,
  description: 'd',
  design: '',
  acceptanceCriteria: 'ac',
  notes: '',
  closeReason: '',
  labels: ['backend'],
  dependencies: [{ to: 'bdesk-38k.1', type: 'blocks' }],
  dependents: [{ from: 'bdesk-38k.7', type: 'blocks' }],
  linked: {},
  epic: null,
  comments: [{ author: 'tom', text: 'ok', createdAt: '2026-10-20T12:00:00.000Z' }],
};

function serviceWith(overrides: Partial<ProjectService> = {}): ProjectService {
  return {
    list: async () => ({ projects: [project], ignored: [{ path: '/Users/someone/Developer/bd-dashboard', reason: 'SQLite' }] }),
    issues: async () => [issue],
    issue: async () => detail,
    histories: async () => [],
    head: async () => 'h1',
    ...overrides,
  };
}

const get = (projects: ProjectService, url: string) => buildServer({ config, projects }).inject({ method: 'GET', url });

/**
 * Ce que le test voit d'un serveur sans en être le client : les codes des réponses qu'il envoie (`sent`), y compris celles qu'aucun client ne
 * lira (un `inject` abandonné rejette), et de quoi attendre que la connexion d'un client parti soit vue fermée côté serveur (`left`). À poser
 * avant la première requête.
 */
function watch(app: FastifyInstance) {
  const sent: number[] = [];
  const replies: FastifyReply[] = [];
  app.addHook('onRequest', async (_req, reply) => {
    replies.push(reply);
  });
  app.addHook('onSend', async (_req, reply, payload) => {
    sent.push(reply.statusCode);
    return payload;
  });
  const left = () => vi.waitFor(() => expect(replies[0]?.raw.destroyed).toBe(true), { timeout: 5_000 });
  return { sent, left };
}

describe('API des Projets', () => {
  it('GET /api/projects renvoie les Projets et les dossiers ignorés', async () => {
    const res = await get(serviceWith(), '/api/projects');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      projects: [project],
      ignored: [{ path: '/Users/someone/Developer/bd-dashboard', reason: 'SQLite' }],
    });
  });

  it('GET /api/projects/:projectId/issues renvoie { issues }', async () => {
    const seen: string[] = [];
    const res = await get(
      serviceWith({
        issues: async (projectId) => {
          seen.push(projectId);
          return [issue];
        },
      }),
      '/api/projects/beads-desktop/issues',
    );

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ issues: [issue] });
    expect(seen).toEqual(['beads-desktop']);
  });

  it('GET /api/projects/:projectId/issues/:issueId renvoie { issue }, identifiant à point compris', async () => {
    const seen: string[][] = [];
    const res = await get(
      serviceWith({
        issue: async (projectId, issueId) => {
          seen.push([projectId, issueId]);
          return detail;
        },
      }),
      '/api/projects/beads-desktop/issues/bdesk-38k.4',
    );

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ issue: detail });
    expect(seen).toEqual([['beads-desktop', 'bdesk-38k.4']]);
  });

  it('GET …/issues/:issueId sert l’Epic que la fiche nomme, telle quelle : son identifiant et son titre (bdesk-38k.29)', async () => {
    const named: IssueDetail = { ...detail, epic: { id: 'bdesk-38k', title: 'beads-desktop V1 : suivi des tickets et métriques de flux' } };

    const res = await get(serviceWith({ issue: async () => named }), '/api/projects/beads-desktop/issues/bdesk-38k.4');

    expect(res.json<{ issue: IssueDetail }>().issue.epic).toEqual({ id: 'bdesk-38k', title: 'beads-desktop V1 : suivi des tickets et métriques de flux' });
    expect(res.json<{ issue: IssueDetail }>().issue.linked).toEqual({});
  });

  it('renvoie 404 en JSON pour un Projet inconnu', async () => {
    const res = await get(
      serviceWith({
        issues: async (projectId) => {
          throw new ProjectNotFoundError(projectId);
        },
      }),
      '/api/projects/nope/issues',
    );

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toEqual({ statusCode: 404, error: 'Not Found', message: 'Projet inconnu : nope' });
  });

  it('renvoie 404 en JSON pour un ticket inconnu', async () => {
    const res = await get(
      serviceWith({
        issue: async (projectId, issueId) => {
          throw new IssueNotFoundError(projectId, issueId);
        },
      }),
      '/api/projects/beads-desktop/issues/bdesk-zzz',
    );

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ statusCode: 404, error: 'Not Found', message: expect.stringContaining('bdesk-zzz') });
  });

  it.each(['/api/projects/hcp/issues', '/api/projects/hcp/issues/b-1'])(
    'renvoie 503 avec la raison quand le Projet est illisible : %s',
    async (url) => {
      const unreadable = async () => {
        throw new ProjectUnreadableError('hcp', 'Base Dolt absente de ce poste');
      };

      const res = await get(serviceWith({ issues: unreadable, issue: unreadable }), url);

      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'Projet illisible : Base Dolt absente de ce poste',
        reason: 'Base Dolt absente de ce poste',
      });
    },
  );

  it('renvoie 500 en JSON pour une erreur inattendue', async () => {
    const res = await get(
      serviceWith({
        list: async () => {
          throw new Error('boum');
        },
      }),
      '/api/projects',
    );

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ statusCode: 500, error: 'Internal Server Error', message: 'boum' });
  });
});

describe('API de la chronologie d’un ticket', () => {
  const history = (id: string): TicketHistory => ({
    id,
    type: 'task',
    statusSnapshots: [
      { status: 'open', at: new Date('2026-10-01T09:00:00Z') },
      { status: 'in_progress', at: new Date('2026-10-02T09:00:00Z') },
      { status: 'closed', at: new Date('2026-10-03T21:00:00Z') },
    ],
    dependencies: [],
  });
  const URL = '/api/projects/beads-desktop/issues/bdesk-38k.4/chronology';

  it('GET …/issues/:issueId/chronology renvoie { chronology } tirée de l’historique du Projet', async () => {
    const seen: string[] = [];
    const res = await get(
      serviceWith({
        histories: async (projectId) => {
          seen.push(projectId);
          return [history('bdesk-38k.4')];
        },
      }),
      URL,
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toEqual({
      chronology: {
        source: 'history',
        transitions: [
          { status: 'open', at: '2026-10-01T09:00:00.000Z', duration: 86_400_000 },
          { status: 'in_progress', at: '2026-10-02T09:00:00.000Z', duration: 129_600_000 },
          { status: 'closed', at: '2026-10-03T21:00:00.000Z', duration: null },
        ],
        blockages: [],
        outcome: { kind: 'delivered', at: '2026-10-03T21:00:00.000Z' },
        leadTime: 216_000_000,
        cycleTime: 129_600_000,
        blockedTime: 0,
        reopenings: 0,
      },
    });
    expect(seen).toEqual(['beads-desktop']);
  });

  it('renvoie 404 en JSON pour un ticket qui n’est dans le Projet ni dans l’historique', async () => {
    const res = await get(serviceWith({ histories: async () => [history('autre')], issues: async () => [] }), URL);

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ statusCode: 404, error: 'Not Found', message: expect.stringContaining('bdesk-38k.4') });
  });

  it('renvoie 404 en JSON pour un Projet inconnu', async () => {
    const res = await get(
      serviceWith({
        head: async (projectId) => {
          throw new ProjectNotFoundError(projectId);
        },
      }),
      '/api/projects/nope/issues/x/chronology',
    );

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ statusCode: 404, error: 'Not Found', message: 'Projet inconnu : nope' });
  });

  it('renvoie 503 avec la raison quand l’historique du Projet est illisible, comme pour la fiche', async () => {
    const res = await get(
      serviceWith({
        histories: async () => {
          throw new ProjectUnreadableError('beads-desktop', 'Historique trop long (plus de 10 000 commits)');
        },
      }),
      URL,
    );

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'Projet illisible : Historique trop long (plus de 10 000 commits)',
      reason: 'Historique trop long (plus de 10 000 commits)',
    });
  });
});

describe('API des métriques', () => {
  const NOW = new Date('2026-10-23T18:00:00Z'); // vendredi 23 octobre 2026, 20:00 à Paris

  /** Le vrai service de métriques, sur les Projets factices, à l'heure et dans le fuseau d'un jour fixe. */
  const metricsOver = (projects: ProjectService) => createMetricsService(projects, { now: () => NOW, timeZone: 'Europe/Paris' });
  const getMetrics = (query = '', projects = serviceWith(), metrics: MetricsService = metricsOver(projects)) =>
    buildServer({ config, projects, metrics }).inject({ method: 'GET', url: `/api/metrics${query}` });
  /** Un service de métriques qui note la demande reçue. */
  const spy = (): MetricsService & { queries: MetricsQuery[] } => {
    const queries: MetricsQuery[] = [];
    return {
      queries,
      async compute(query) {
        queries.push(query);
        return metricsOver(serviceWith()).compute(query);
      },
    };
  };

  it('GET /api/metrics sert la Vue globale des 30 derniers jours, en JSON', async () => {
    const res = await getMetrics();

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = res.json<MetricsResponse>();
    expect(body).toMatchObject({
      generatedAt: NOW.toISOString(),
      timeZone: 'Europe/Paris',
      timeZoneHonoured: false, // la requête ne demande pas de fuseau : le serveur compte dans le sien (bdesk-38k.71)
      range: '30d',
      projects: [{ id: 'beads-desktop', name: 'beads-desktop' }],
      unreadable: [],
      bucket: 'day',
    });
    expect(body.period).toMatchObject({ from: '2026-09-24', to: '2026-10-23', days: 30 });
    expect(body.cfd).toHaveLength(30);
    expect(Object.keys(body).sort()).toEqual(
      [
        'asOf', 'bucket', 'buckets', 'cfd', 'cycleTimeScatter', 'generatedAt', 'health', 'inProgress', 'period', 'previousAsOf', 'previousPeriod',
        'projects', 'range', 'slices', 'tiles', 'timeZone', 'timeZoneHonoured', 'unreadable',
      ].sort(),
    );
    // Santé du flux (bdesk-38k.13) : un ajout au contrat, les clés précédentes sont inchangées.
    expect(Object.keys(body.health).sort()).toEqual(['abandonment', 'activity', 'efficiency', 'leadTimeBreakdown', 'readyAges', 'reopening']);
  });

  it('transmet les Projets (paramètre répété) et la période au service', async () => {
    const metrics = spy();

    await getMetrics('?project=a&project=b&range=90d', serviceWith(), metrics);
    await getMetrics('?from=2026-10-01&to=2026-10-15', serviceWith(), metrics);
    await getMetrics('', serviceWith(), metrics);

    expect(metrics.queries).toEqual([
      { projects: ['a', 'b'], period: { range: '90d' } },
      { projects: [], period: { from: '2026-10-01', to: '2026-10-15' } },
      { projects: [], period: { range: '30d' } },
    ]);
  });

  it('mesure une plage personnalisée, avec sa période précédente', async () => {
    const res = await getMetrics('?from=2026-10-01&to=2026-10-15');

    expect(res.statusCode).toBe(200);
    expect(res.json<MetricsResponse>()).toMatchObject({
      range: 'custom',
      period: { from: '2026-10-01', to: '2026-10-15', days: 15 },
      previousPeriod: { from: '2026-09-16', to: '2026-09-30', days: 15 },
    });
  });

  it.each([
    ['un préréglage inconnu', '?range=1d'],
    ['un préréglage et une plage', '?range=7d&from=2026-10-01&to=2026-10-15'],
    ['une plage incomplète', '?from=2026-10-01'],
    ['un paramètre inconnu', '?foo=1'],
    ['un Projet vide', '?project='],
    ['un jour mal formé', '?from=2026-1-5&to=2026-10-15'],
    ['un jour qui n’existe pas', '?from=2026-02-30&to=2026-03-05'],
    ['un début après la fin', '?from=2026-10-15&to=2026-10-01'],
    ['une fin dans le futur', '?from=2026-10-01&to=2026-10-24'],
    ['plus d’un an', '?from=2025-01-01&to=2026-10-23'],
    ['une plage d’avant le 1er janvier 1970', '?from=1969-12-31&to=1970-01-15'],
    ['une plage dans l’an 20', '?from=0020-01-01&to=0020-01-31'],
  ])('renvoie 400 en JSON pour %s', async (_name, query) => {
    const res = await getMetrics(query);

    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toMatchObject({ statusCode: 400, error: 'Bad Request', message: expect.any(String) });
  });

  it('renvoie 400 avec le message du domaine quand la période est refusée', async () => {
    const refusing: MetricsService = {
      async compute() {
        throw new InvalidPeriodError('La plage est trop longue : 400 jours, au plus 366.');
      },
    };

    const res = await getMetrics('', serviceWith(), refusing);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ statusCode: 400, error: 'Bad Request', message: 'La plage est trop longue : 400 jours, au plus 366.' });
  });

  it.each([
    ['le 31 décembre 1969, le dernier jour d’avant', '1969-12-31', '1970-01-15'],
    ['en l’an 20, un jour qui existe', '0020-01-01', '0020-01-31'],
    ['en l’an 0', '0000-01-01', '0000-01-31'],
    ['le 1er janvier de l’an 100, dont la période précédente se calculait avec 1900 ans d’écart', '0100-01-01', '0100-01-31'],
  ])('renvoie 400 avec la règle de la page pour une plage qui commence %s, sans rien lire ni calculer', async (_name, from, to) => {
    const reads: string[] = [];
    const projects = serviceWith({
      list: async () => {
        reads.push('list');
        return { projects: [project], ignored: [] };
      },
      head: async () => {
        reads.push('head');
        return 'h1';
      },
      histories: async () => {
        reads.push('histories');
        return [];
      },
    });

    const res = await getMetrics(`?from=${from}&to=${to}`, projects);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: `La plage doit commencer le 1er janvier 1970 ou après : « from » (${from}) est trop tôt.`,
    });
    expect(reads).toEqual([]); // refusée avant de lire un seul Projet
  });

  it('mesure une plage qui commence le 1er janvier 1970, la borne basse comprise', async () => {
    const res = await getMetrics('?from=1970-01-01&to=1970-01-31');

    expect(res.statusCode).toBe(200);
    expect(res.json<MetricsResponse>()).toMatchObject({
      range: 'custom',
      period: { from: '1970-01-01', to: '1970-01-31', days: 31 },
      previousPeriod: { from: '1969-12-01', to: '1969-12-31', days: 31 },
    });
  });

  it('renvoie 404 en JSON pour un Projet inconnu', async () => {
    const res = await getMetrics('?project=nope');

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toEqual({ statusCode: 404, error: 'Not Found', message: 'Projet inconnu : nope' });
  });

  it('liste un Projet illisible dans la réponse, sans faire échouer le reste', async () => {
    const unreadable: Project = { ...project, id: 'hcp', name: 'hcp', status: 'unreadable', reason: 'Base Dolt absente de ce poste' };
    const projects = serviceWith({ list: async () => ({ projects: [project, unreadable], ignored: [] }) });

    const res = await getMetrics('?range=7d', projects);

    expect(res.statusCode).toBe(200);
    expect(res.json<MetricsResponse>()).toMatchObject({
      projects: [{ id: 'beads-desktop' }],
      unreadable: [{ id: 'hcp', name: 'hcp', reason: 'Base Dolt absente de ce poste' }],
    });
  });

  it('liste dans la réponse un Projet qui disparaît pendant le calcul, au lieu de répondre 404', async () => {
    const vanishing: Project = { ...project, id: 'vanishing', name: 'vanishing' };
    const projects = serviceWith({
      list: async () => ({ projects: [project, vanishing], ignored: [] }),
      head: async (id) => {
        if (id === 'vanishing') throw new ProjectNotFoundError(id); // listé il y a un instant, introuvable à la lecture
        return 'h1';
      },
    });

    for (const query of ['?range=7d', '?project=vanishing&range=7d']) {
      const res = await getMetrics(query, projects);

      expect(res.statusCode, query).toBe(200);
      expect(res.json<MetricsResponse>().unreadable, query).toEqual([
        { id: 'vanishing', name: 'vanishing', reason: expect.stringContaining('disparu') },
      ]);
    }
    // Un identifiant que la liste ne connaissait pas reste un 404.
    expect((await getMetrics('?project=nope', projects)).statusCode).toBe(404);
  });

  it('expose le nombre de jours de chaque seau : les semaines des bords sont tronquées, l’interface les normalise', async () => {
    const res = await getMetrics('?range=90d');

    const body = res.json<MetricsResponse>();
    expect(body.bucket).toBe('week');
    // Du dimanche 26 juillet au vendredi 23 octobre : un dimanche seul, douze semaines pleines, puis lundi à vendredi.
    expect(body.buckets.map((b) => b.days)).toEqual([1, ...Array<number>(12).fill(7), 5]);
    expect(body.buckets.reduce((total, b) => total + b.days, 0)).toBe(body.period.days);
    expect(body.buckets[0]).toMatchObject({ from: '2026-07-26', to: '2026-07-26' });
    expect(body.buckets.at(-1)).toMatchObject({ from: '2026-10-19', to: '2026-10-23' });
    expect((await getMetrics('?range=7d')).json<MetricsResponse>().buckets.every((b) => b.days === 1)).toBe(true);
  });

  it('expose, pour chaque découpage, la Couverture sur laquelle repose son Taux d’échec et s’il est significatif', async () => {
    const delivered: TicketHistory = {
      id: 'bdesk-1',
      type: 'task',
      statusSnapshots: [
        { status: 'open', at: new Date('2026-10-20T10:00:00Z') },
        { status: 'closed', at: new Date('2026-10-21T10:00:00Z') },
      ],
      dependencies: [],
    };
    const projects = serviceWith({ histories: async () => [delivered], issues: async () => [{ ...issue, id: 'bdesk-1', status: 'closed' }] });

    const body = (await getMetrics('?range=7d', projects)).json<MetricsResponse>();

    const unreliable = { coverage: { bugs: 0, linked: 0, ratio: null }, significant: false }; // aucun bug : trop peu pour conclure
    expect(body.tiles.failureRate).toMatchObject({ coverage: unreliable.coverage, significant: false });
    expect(body.slices.type).toMatchObject([{ key: 'task', failureRate: 0, ...unreliable }]);
    expect(body.slices.priority).toMatchObject([{ key: '1', failureRate: 0, ...unreliable }]);
    expect(body.slices.project).toMatchObject([{ key: 'beads-desktop', failureRate: 0, ...unreliable }]);
  });

  it('renvoie 500 en JSON pour une erreur inattendue', async () => {
    const res = await getMetrics('', serviceWith({ head: async () => { throw new Error('boum'); } }));

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ statusCode: 500, error: 'Internal Server Error', message: 'boum' });
  });
});

describe('API : requêtes abandonnées par le client (bdesk-38k.20)', () => {
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** Un service qui ne répond que quand le test le décide, et qui note le signal reçu ; il finit en AbortError si ce signal est abandonné. */
  function hanging() {
    const seen: { signal?: AbortSignal; calls: number; answer: () => void } = { calls: 0, answer: () => {} };
    const wait = <T>(value: T) => (_projectId: string, ...rest: unknown[]) => {
      const options = rest.at(-1) as { signal?: AbortSignal } | undefined;
      seen.calls++;
      seen.signal = options?.signal;
      return new Promise<T>((resolve, reject) => {
        seen.answer = () => resolve(value);
        options?.signal?.addEventListener('abort', () => reject(new ReadAborted()));
      });
    };
    return { seen, wait };
  }

  const ROUTES: [string, string, (wait: ReturnType<typeof hanging>['wait']) => Partial<ProjectService>][] = [
    ['la liste des tickets', '/api/projects/beads-desktop/issues', (wait) => ({ issues: wait([issue]) })],
    ['la fiche d’un ticket', '/api/projects/beads-desktop/issues/bdesk-38k.4', (wait) => ({ issue: wait(detail) })],
    ['la chronologie d’un ticket', '/api/projects/beads-desktop/issues/bdesk-38k.4/chronology', (wait) => ({ histories: wait([]) })],
  ];

  it.each(ROUTES)('%s : le service reçoit un signal, abandonné quand le client part et pas avant', async (_name, url, stub) => {
    const { seen, wait } = hanging();
    const app = buildServer({ config, projects: serviceWith(stub(wait)) });
    const controller = new AbortController();
    const reading = app.inject({ method: 'GET', url, signal: controller.signal }).catch((e: unknown) => e);
    await sleep(30);
    expect(seen.calls).toBeGreaterThan(0);
    expect(seen.signal).toBeInstanceOf(AbortSignal);
    expect(seen.signal?.aborted).toBe(false); // le client attend toujours

    controller.abort();
    await reading;

    // La lecture de l'historique d'une chronologie n'est abandonnée qu'après le délai de grâce de son analyse (ANALYSIS_GRACE_MS, 1 s) :
    // le parcours rapide des tickets la redemande aussitôt (le délai lui-même est gardé, en temps simulé, par chronology/service.test.ts).
    await vi.waitFor(() => expect(seen.signal?.aborted).toBe(true), { timeout: 10_000 });
    await app.close();
  });

  it('GET /api/metrics donne aussi le signal au service de métriques', async () => {
    let received: AbortSignal | undefined;
    const metrics: MetricsService = {
      compute: (_query, options) => {
        received = options?.signal;
        return new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new ReadAborted())));
      },
    };
    const app = buildServer({ config, projects: serviceWith(), metrics });
    const controller = new AbortController();
    const reading = app.inject({ method: 'GET', url: '/api/metrics', signal: controller.signal }).catch((e: unknown) => e);
    await sleep(30);
    expect(received?.aborted).toBe(false);

    controller.abort();
    await reading;
    await sleep(10);

    expect(received?.aborted).toBe(true);
    await app.close();
  });

  it('un client qui attend jusqu’au bout reçoit sa réponse, le signal n’ayant pas été abandonné', async () => {
    const { seen, wait } = hanging();
    const app = buildServer({ config, projects: serviceWith({ issue: wait(detail) }) });
    const response = app.inject({ method: 'GET', url: '/api/projects/beads-desktop/issues/bdesk-38k.4' });
    await sleep(30);

    seen.answer();
    const res = await response;

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ issue: detail });
    expect(seen.signal?.aborted).toBe(false);
    await app.close();
  });

  it('sur une vraie connexion : le service est interrompu quand le client ferme la sienne, et le serveur n’écrit rien au journal (ni erreur, ni avertissement)', async () => {
    const { seen, wait } = hanging();
    const logs: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        logs.push(chunk.toString());
        done();
      },
    });
    // Le journal doit rester vide : un `TZ` vide (ou que le moteur ne sait pas nommer) lui ferait écrire l'avertissement de démarrage du fuseau du
    // serveur (bdesk-38k.38), qui n'est pas ce que ce test regarde. `TZ=UTC`, un nom que le moteur connaît, ne dit rien (bdesk-38k.48).
    vi.stubEnv('TZ', 'UTC');
    const app = buildServer({ config, projects: serviceWith({ issue: wait(detail) }), logger: { level: 'warn', stream } });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const client = request({ host: '127.0.0.1', port, path: '/api/projects/beads-desktop/issues/bdesk-38k.4' });
    client.on('error', () => undefined);
    client.end();
    for (let waited = 0; seen.calls === 0; waited += 5) {
      if (waited > 2_000) throw new Error('le serveur n’a pas appelé le service');
      await sleep(5);
    }
    expect(seen.signal?.aborted).toBe(false);

    client.destroy(); // le navigateur annule son fetch : la connexion se ferme
    for (let waited = 0; seen.signal?.aborted === false; waited += 5) {
      if (waited > 2_000) throw new Error('le signal n’a pas été abandonné');
      await sleep(5);
    }
    await sleep(30);

    expect(seen.signal?.aborted).toBe(true);
    expect(logs).toEqual([]);
    await app.close();
  });

  it('un abandon n’est pas une panne : la réponse que personne ne lira est un 499, ni 500 ni 503', async () => {
    const { wait } = hanging();
    const app = buildServer({ config, projects: serviceWith({ issue: wait(detail) }) });
    const { sent } = watch(app);
    const controller = new AbortController();
    const reading = app
      .inject({ method: 'GET', url: '/api/projects/beads-desktop/issues/bdesk-38k.4', signal: controller.signal })
      .catch(() => undefined);
    await sleep(30);

    controller.abort(); // le service est interrompu par le signal et rejette par une ReadAborted
    await reading;

    await vi.waitFor(() => expect(sent).toEqual([499]), { timeout: 5_000 });
    await app.close();
  });
});

/**
 * bdesk-38k.49 : le gestionnaire d'erreurs de l'API répondait 500 sans rien écrire : un 500 en production ne laissait aucune trace. Le
 * journal du serveur (le `logger` de Fastify, que le CLI laisse au niveau `warn`) reçoit désormais une ligne par réponse qui est une panne
 * du serveur, et rien de ce qui est la faute de la requête ou l'abandon du client.
 */
describe('API : journal des erreurs (bdesk-38k.49)', () => {
  const WARN = 40;
  const ERROR = 50;

  /** Une ligne du journal du serveur : Fastify l'écrit par pino, en JSON, une par message. */
  interface LogLine {
    level: number;
    msg: string;
    reqId?: string;
    method?: string;
    route?: string;
    err?: { type: string; message: string; stack: string };
    original?: { type?: string; message?: string };
  }

  /** Un journal que le test lit (`logger: { level, stream }`) : ce que le serveur écrit, ligne par ligne ou en bloc. */
  function journal() {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        chunks.push(chunk.toString());
        done();
      },
    });
    const text = () => chunks.join('');
    const lines = () =>
      text()
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as LogLine);
    return { stream, text, lines };
  }

  const apps: { close(): Promise<unknown> }[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  /**
   * Un serveur dont le journal est capté, au niveau du CLI (`warn` : les erreurs et les avertissements, pas les lignes d'accès de Fastify).
   * Les métriques ont leur fuseau : celui de la machine, quand le moteur ne le reconnaît pas, ajouterait son avertissement au journal.
   */
  function serve(stub: Partial<ProjectService> = {}, level = 'warn') {
    const { stream, text, lines } = journal();
    const projects = serviceWith(stub);
    const metrics = createMetricsService(projects, { now: () => new Date('2026-10-23T18:00:00Z'), timeZone: 'Europe/Paris' });
    const app = buildServer({ config, projects, metrics, logger: { level, stream } });
    apps.push(app);
    return { app, text, lines };
  }

  const boom = async (): Promise<never> => {
    throw new Error('boum');
  };

  /** Chaque route de l'API, avec ce qui la fait échouer sans qu'elle l'ait prévu, et son modèle de route (ce que le journal en dit). */
  const FAILING: [name: string, url: string, route: string, stub: Partial<ProjectService>][] = [
    ['la liste des Projets', '/api/projects', '/api/projects', { list: boom }],
    ['la liste des tickets', '/api/projects/beads-desktop/issues', '/api/projects/:projectId/issues', { issues: boom }],
    ['la fiche d’un ticket', '/api/projects/beads-desktop/issues/bdesk-38k.4', '/api/projects/:projectId/issues/:issueId', { issue: boom }],
    [
      'la chronologie d’un ticket',
      '/api/projects/beads-desktop/issues/bdesk-38k.4/chronology',
      '/api/projects/:projectId/issues/:issueId/chronology',
      { histories: boom },
    ],
    ['les métriques', '/api/metrics?range=7d', '/api/metrics', { head: boom }],
    ['le flux en direct', '/api/projects/beads-desktop/events', '/api/projects/:projectId/events', { list: boom }],
  ];

  it.each(FAILING)('%s : une erreur inattendue (500) laisse une ligne `error` avec le message, la pile, la méthode et la route', async (_name, url, route, stub) => {
    const { app, lines } = serve(stub);

    const res = await app.inject({ method: 'GET', url });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ statusCode: 500, error: 'Internal Server Error', message: 'boum' }); // la réponse, elle, ne change pas
    const [line, ...others] = lines();
    expect(others).toEqual([]); // une seule ligne
    // `msg` est fixe : l'erreur, elle, est dans `err` (un message écrit trois fois, dans `msg`, `err.message` et la pile, triplait la ligne)
    expect(line).toMatchObject({ level: ERROR, method: 'GET', route, msg: 'Erreur inattendue', err: { type: 'Error', message: 'boum' } });
    expect(line?.err?.stack).toContain('Error: boum');
    expect(line?.err?.stack).toContain('api.test.ts'); // la pile de l'erreur d'origine
    expect(line?.reqId).toEqual(expect.any(String)); // de quoi la retrouver parmi les lignes d'accès, que le niveau `info` écrit
  });

  it('une erreur, une ligne : Fastify ne l’écrit pas une seconde fois, même quand le journal garde tout', async () => {
    const { app, lines } = serve({ list: boom }, 'trace');

    await app.inject({ method: 'GET', url: '/api/projects' });
    await app.inject({ method: 'GET', url: '/api/projects' });

    const failures = lines().filter((line) => line.level >= WARN);
    expect(failures).toHaveLength(2); // une par réponse
    expect(new Set(failures.map((line) => line.reqId)).size).toBe(2);
    expect(lines().filter((line) => JSON.stringify(line).includes('boum'))).toHaveLength(2); // et aucune autre ligne ne cite l'erreur
  });

  it('n’écrit ni l’adresse avec sa requête, ni les en-têtes, ni le corps : l’erreur, la méthode et la route seulement', async () => {
    const { app, lines, text } = serve({ list: boom });

    await app.inject({
      method: 'GET',
      url: '/api/projects?token=s3cret-requete',
      headers: { authorization: 'Bearer s3cret-en-tete', cookie: 'session=s3cret-cookie' },
      payload: 's3cret-corps',
    });

    expect(text()).not.toContain('s3cret');
    const [line] = lines();
    expect(line?.route).toBe('/api/projects'); // le modèle de la route, pas l'adresse demandée
    expect(Object.keys(line ?? {}).sort()).toEqual(['err', 'hostname', 'level', 'method', 'msg', 'pid', 'reqId', 'route', 'time']);
    expect(Object.keys(line?.err ?? {}).sort()).toEqual(['message', 'stack', 'type']);
  });

  it('un code 5xx autre que 500 est une panne du serveur aussi : une ligne `error`', async () => {
    const { app, lines } = serve({
      list: async () => {
        throw Object.assign(new Error('passerelle'), { statusCode: 502 });
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/projects' });

    expect(res.statusCode).toBe(502);
    expect(lines()).toMatchObject([
      { level: ERROR, method: 'GET', route: '/api/projects', msg: 'Erreur inattendue', err: { type: 'Error', message: 'passerelle', statusCode: 502 } },
    ]);
  });

  // Rien n'oblige le code à lever une `Error` : une valeur sans message, sans code ni pile (`throw 'x'`, `throw null`) est une erreur imprévue comme une autre.
  it.each([
    ['une chaîne', 'boum-texte', "'boum-texte'"],
    ['un nombre', 42, '42'],
    ['un objet', { code: 'E_BOUM' }, "{ code: 'E_BOUM' }"],
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
  ])('lever %s (et non une Error) : 500 et une ligne `error` qui dit la valeur, sans l’adresse', async (_name, thrown, shown) => {
    const { app, lines, text } = serve({
      list: async () => {
        throw thrown;
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/projects?token=s3cret-requete' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ statusCode: 500, error: 'Internal Server Error', message: 'Erreur inattendue.' }); // un message, pas la valeur levée
    const [line, ...others] = lines();
    expect(others).toEqual([]); // une seule ligne, même quand le gestionnaire de Fastify prend le relais
    expect(line).toMatchObject({
      level: ERROR,
      method: 'GET',
      route: '/api/projects',
      msg: `Erreur inattendue (valeur levée qui n'est pas une Error) : ${shown}`,
    });
    expect(Object.keys(line ?? {}).sort()).toEqual(['hostname', 'level', 'method', 'msg', 'pid', 'reqId', 'route', 'time']); // pas de pile à écrire
    expect(text()).not.toContain('s3cret'); // le gestionnaire de Fastify, lui, écrit l'adresse avec sa requête
  });

  it('un code 4xx est la faute de la requête, pas une panne du serveur : rien au journal', async () => {
    const { app, lines } = serve({
      list: async () => {
        throw Object.assign(new Error('théière'), { statusCode: 418 });
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/projects' });

    expect(res.statusCode).toBe(418);
    expect(lines()).toEqual([]);
  });

  it.each([
    ['la liste des tickets', '/api/projects/hcp/issues', '/api/projects/:projectId/issues'],
    ['la fiche d’un ticket', '/api/projects/hcp/issues/b-1', '/api/projects/:projectId/issues/:issueId'],
    ['la chronologie d’un ticket', '/api/projects/hcp/issues/b-1/chronology', '/api/projects/:projectId/issues/:issueId/chronology'],
  ])('%s : un Projet illisible (503) laisse une ligne `warn` avec sa raison, sans pile', async (_name, url, route) => {
    const unreadable = async (): Promise<never> => {
      throw new ProjectUnreadableError('hcp', 'database is locked by another dolt process');
    };
    const { app, lines } = serve({ issues: unreadable, issue: unreadable, histories: unreadable });

    const res = await app.inject({ method: 'GET', url });

    expect(res.statusCode).toBe(503);
    const [line, ...others] = lines();
    expect(others).toEqual([]);
    expect(line).toMatchObject({ level: WARN, method: 'GET', route, msg: 'Projet illisible : hcp (database is locked by another dolt process)' });
    expect(line).not.toHaveProperty('err'); // une panne de lecture, pas un bogue : la pile partirait du service et n'apprendrait rien
  });

  const QUIET: { name: string; url: string; stub?: Partial<ProjectService>; headers?: Record<string, string>; status: number }[] = [
    {
      name: 'un Projet inconnu',
      url: '/api/projects/nope/issues',
      stub: {
        issues: async () => {
          throw new ProjectNotFoundError('nope');
        },
      },
      status: 404,
    },
    {
      name: 'un ticket inconnu',
      url: '/api/projects/beads-desktop/issues/bdesk-zzz',
      stub: {
        issue: async () => {
          throw new IssueNotFoundError('beads-desktop', 'bdesk-zzz');
        },
      },
      status: 404,
    },
    { name: 'un Projet inconnu des métriques', url: '/api/metrics?project=nope', status: 404 },
    { name: 'une requête de métriques refusée', url: '/api/metrics?range=1d', status: 400 },
    { name: 'une plage que le domaine refuse', url: '/api/metrics?from=2026-10-15&to=2026-10-01', status: 400 },
    { name: 'une origine que le flux refuse', url: '/api/projects/beads-desktop/events', headers: { origin: 'https://evil.example' }, status: 403 },
  ];

  it.each(QUIET)('$name ($status) : une réponse attendue, rien au journal', async ({ url, stub, headers, status }) => {
    const { app, lines } = serve(stub);

    const res = await app.inject({ method: 'GET', url, headers });

    expect(res.statusCode).toBe(status);
    expect(lines()).toEqual([]);
  });

  /**
   * bdesk-38k.52 (relecture finale de .49, m1) : un message de 200 000 caractères donnait une ligne de 600 000 (dans `msg`, `err.message` et la
   * pile). Chaque texte écrit au journal est plafonné, et le message n'est plus écrit qu'à sa place, dans `err`.
   */
  describe('taille de la ligne (bdesk-38k.52)', () => {
    const HUGE = 200_000;
    // Le plafond d'un texte est de l'ordre de quelques milliers de caractères ; une ligne ne dépend plus de la taille de l'erreur. La borne
    // du test est large (une ligne entière, tous champs compris) : ce qu'elle vérifie, c'est que 200 000 caractères n'en font pas 600 000.
    const LINE_MAX = 20_000;

    const failing = (error: unknown): Partial<ProjectService> => ({
      list: async () => {
        throw error;
      },
    });

    it('un message de 200 000 caractères : une ligne bornée, au début du message, avec `msg` fixe', async () => {
      const { app, lines, text } = serve(failing(new Error(`début-${'x'.repeat(HUGE)}-fin`)));

      const res = await app.inject({ method: 'GET', url: '/api/projects' });

      expect(res.statusCode).toBe(500);
      expect(text().length).toBeLessThan(LINE_MAX);
      const [line, ...others] = lines();
      expect(others).toEqual([]);
      expect(line).toMatchObject({ level: ERROR, msg: 'Erreur inattendue', err: { type: 'Error' } });
      expect(line?.err?.message.startsWith(`début-${'x'.repeat(1_000)}`)).toBe(true); // le début du message, de quoi reconnaître l'erreur
      expect(line?.err?.message.length).toBeLessThan(HUGE / 10);
      expect(line?.err?.message).not.toContain('-fin'); // la fin est coupée : le plafond est visible
      expect(line?.err?.stack.length).toBeLessThan(HUGE / 10); // la pile commence par le message
    });

    it('un Projet illisible (503) : la ligne `warn` est bornée aussi, quelle que soit la longueur de la raison', async () => {
      const { app, lines, text } = serve({
        list: async () => {
          throw new ProjectUnreadableError('hcp', `début-${'r'.repeat(HUGE)}`);
        },
      });

      const res = await app.inject({ method: 'GET', url: '/api/projects' });

      expect(res.statusCode).toBe(503);
      expect(text().length).toBeLessThan(LINE_MAX);
      const [line, ...others] = lines();
      expect(others).toEqual([]);
      expect(line).toMatchObject({ level: WARN, method: 'GET', route: '/api/projects' });
      expect(line?.msg.startsWith('Projet illisible : hcp (début-rrr')).toBe(true);
    });

    it('un message plus court que le plafond est écrit en entier', async () => {
      const message = `un message de taille raisonnable : ${'y'.repeat(1_500)}`;
      const { app, lines } = serve(failing(new Error(message)));

      await app.inject({ method: 'GET', url: '/api/projects' });

      expect(lines()[0]?.err?.message).toBe(message);
    });

    it('la `cause` est suivie, mais ses textes sont plafonnés eux aussi, et la chaîne ne dépend pas de sa longueur', async () => {
      let error = new Error(`dernière-${'z'.repeat(HUGE)}`);
      for (let depth = 0; depth < 10; depth++) error = new Error(`niveau ${depth} ${'c'.repeat(HUGE)}`, { cause: error });
      const { app, lines, text } = serve(failing(error));

      await app.inject({ method: 'GET', url: '/api/projects' });

      expect(text().length).toBeLessThan(LINE_MAX * 4);
      expect(lines()).toHaveLength(1);
      const message = lines()[0]?.err?.message ?? '';
      expect(message).toContain('niveau 9'); // l'erreur
      expect(message).toContain('niveau 8'); // sa cause, que la ligne suit
      expect(message).not.toContain('niveau 0'); // mais pas dix niveaux de suite
    });

    it('les propriétés de l’erreur : les valeurs simples restent (`code`), les textes sont plafonnés, les objets (réponse, en-têtes d’un client HTTP) ne sont pas écrits', async () => {
      const { app, lines, text } = serve(
        failing(
          Object.assign(new Error('boum'), {
            code: 'E_BOUM',
            errno: -2,
            retryable: false,
            attempts: 10n,
            parent: null,
            stdout: `sortie-${'o'.repeat(HUGE)}`,
            response: { headers: { authorization: 'Bearer s3cret-reponse' }, body: 'b'.repeat(HUGE) },
          }),
        ),
      );

      await app.inject({ method: 'GET', url: '/api/projects' });

      expect(text().length).toBeLessThan(LINE_MAX);
      expect(text()).not.toContain('s3cret');
      const err = lines()[0]?.err as Record<string, unknown> | undefined;
      expect(err).toMatchObject({ type: 'Error', message: 'boum', code: 'E_BOUM', errno: -2, retryable: false, attempts: 10, parent: null });
      expect(String(err?.stdout).startsWith('sortie-ooo')).toBe(true);
      expect(String(err?.stdout).length).toBeLessThan(HUGE / 10);
      expect(err).not.toHaveProperty('response');
    });

    it('une valeur levée qui n’est pas une Error : la ligne est bornée aussi, et dit le début de la valeur', async () => {
      const { app, lines, text } = serve(failing(`début-${'v'.repeat(HUGE)}`));

      const res = await app.inject({ method: 'GET', url: '/api/projects' });

      expect(res.statusCode).toBe(500);
      // `inspect` s'arrête à 10 000 caractères par défaut : le plafond du journal est plus bas (une ligne de 10 300 caractères ne passe pas)
      expect(text().length).toBeLessThan(8_000);
      const [line, ...others] = lines();
      expect(others).toEqual([]);
      expect(line?.msg.startsWith("Erreur inattendue (valeur levée qui n'est pas une Error) : 'début-vvv")).toBe(true);
    });

    it('un objet levé aux gros textes, et un tableau énorme : bornés de même', async () => {
      const { app, text } = serve(failing({ texts: [{ a: 'a'.repeat(HUGE) }, 'b'.repeat(HUGE)], list: Array.from({ length: 5_000 }, (_v, i) => `élément ${i}`) }));

      await app.inject({ method: 'GET', url: '/api/projects' });

      expect(text().length).toBeLessThan(LINE_MAX);
      expect(text()).toContain('Erreur inattendue');
    });

    it('un message qui n’est pas un texte ne fait pas échouer le gestionnaire, ni ne fait écrire l’adresse par celui de Fastify', async () => {
      const error = new Error('boum');
      Object.defineProperty(error, 'message', { value: { detail: 'objet-sans-texte' } });
      const { app, lines, text } = serve(failing(error));

      const res = await app.inject({ method: 'GET', url: '/api/projects?token=s3cret-requete' });

      expect(res.statusCode).toBe(500);
      expect(lines()).toHaveLength(1);
      expect(text()).not.toContain('s3cret');
    });
  });

  /**
   * bdesk-38k.52 (relecture, B1) : « Fastify ne reprend jamais la main » ne tient que si le gestionnaire ne lève pas. Or il lisait des accesseurs
   * de l'erreur (`Object.entries`, `cause`) et mettait son message tel quel dans le corps JSON : un accesseur qui lève, un message `BigInt` ou
   * circulaire (que `JSON.stringify` refuse) faisaient échouer le gestionnaire ou la réponse, et le gestionnaire par défaut de Fastify écrivait alors
   * l'adresse demandée avec sa requête (`?token=…` mesuré sur un vrai serveur). Le corps ne reçoit que le message qui est un texte, la lecture de
   * l'erreur est gardée propriété par propriété, et un filet autour de tout le gestionnaire écrit une ligne fixe et répond un 500 générique.
   */
  describe('un gestionnaire qui ne lève jamais (bdesk-38k.52)', () => {
    const GENERIC = 'Erreur inattendue.';
    const NET = "Erreur inattendue (le gestionnaire d'erreurs a échoué)"; // la ligne fixe du filet
    const SECRETS = { authorization: 'Bearer s3cret-en-tete', cookie: 'session=s3cret-cookie' };
    const URL_SECRETE = '/api/projects?token=s3cret-requete';

    const failing = (error: unknown): Partial<ProjectService> => ({
      list: async () => {
        throw error;
      },
    });
    /** Une erreur dont le message est autre chose qu'un texte. */
    const withMessage = (message: unknown, extra: object = {}) =>
      Object.defineProperty(Object.assign(new Error('boum'), extra), 'message', { value: message });
    /** Une erreur dont la propriété `key` est un accesseur qui lève. */
    const withGetter = (key: string, enumerable = false) =>
      Object.defineProperty(new Error('boum'), key, {
        enumerable,
        configurable: true,
        get() {
          throw new Error('accesseur-qui-leve');
        },
      });
    /** Une erreur dont `constructor.name` lève (le `type` de la ligne : lu sous garde, il retombe sur `Error`). */
    const withThrowingClassName = () => {
      class Nameless extends Error {}
      Object.defineProperty(Nameless, 'name', {
        get() {
          throw new Error('nom-de-classe-illisible');
        },
      });
      return new Nameless('boum');
    };
    /** Une erreur dont la liste des clés ne se lit pas (`Object.keys` lève), et dont le reste se lit. */
    const proxyWithoutKeys = () =>
      new Proxy(new Error('boum'), {
        ownKeys() {
          throw new Error('clés-illisibles');
        },
      });
    const circular = () => {
      const object: Record<string, unknown> = { nom: 'cercle' };
      object.self = object;
      return object;
    };

    /** Demande `/api/projects` avec une requête et des en-têtes secrets, et vérifie qu'aucune ligne du journal ne les cite. */
    async function ask(stub: Partial<ProjectService>) {
      const served = serve(stub);
      const res = await served.app.inject({ method: 'GET', url: URL_SECRETE, headers: SECRETS });
      expect(served.text()).not.toContain('s3cret'); // le gestionnaire par défaut de Fastify, lui, écrit `req.url` avec sa requête
      expect(served.text()).not.toContain('token');
      return { res, lines: served.lines };
    }

    it.each([
      ['un message BigInt, que JSON.stringify refuse', () => withMessage(10n), GENERIC, '10n'],
      ['un message objet circulaire', () => withMessage(circular()), GENERIC, expect.stringContaining('Circular')],
      ['un message objet dont l’inspection lève', () => withMessage({ [inspect.custom]: () => { throw new Error('inspection-qui-leve'); } }), GENERIC, '(illisible)'],
      ['une propriété énumérable dont l’accesseur lève', () => withGetter('detail', true), 'boum', 'boum'],
      ['une `cause` dont l’accesseur lève', () => withGetter('cause'), 'boum', 'boum'],
      ['des clés qui ne se lisent pas (un Proxy dont ownKeys lève)', () => proxyWithoutKeys(), 'boum', 'boum'],
      ['un `stack` dont l’accesseur lève', () => withGetter('stack'), 'boum', 'boum'],
      ['un `constructor` dont l’accesseur lève', () => withGetter('constructor'), 'boum', 'boum'],
      ['un `constructor.name` qui lève (le nom de la classe)', () => withThrowingClassName(), 'boum', 'boum'],
      ['un `statusCode` dont l’accesseur lève (le code reste 500)', () => withGetter('statusCode'), 'boum', 'boum'],
      ['un `status` dont l’accesseur lève (le code reste 500)', () => withGetter('status'), 'boum', 'boum'],
    ])('500 : %s ne fait pas échouer le gestionnaire : réponse de l’API, une seule ligne `error`, ni adresse ni en-tête', async (_name, thrown, body, message) => {
      const { res, lines } = await ask(failing(thrown()));

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ statusCode: 500, error: 'Internal Server Error', message: body });
      const [line, ...others] = lines();
      expect(others).toEqual([]); // la nôtre, pas aussi celle du gestionnaire de Fastify
      expect(line).toMatchObject({ level: ERROR, method: 'GET', route: '/api/projects', msg: 'Erreur inattendue', err: { message } });
    });

    it('500 : un `message` dont l’accesseur lève : réponse de l’API, une seule ligne `error`', async () => {
      const { res, lines } = await ask(failing(withGetter('message')));

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ statusCode: 500, error: 'Internal Server Error', message: GENERIC });
      expect(lines()).toMatchObject([{ level: ERROR, msg: 'Erreur inattendue', err: { type: 'Error' } }]);
    });

    it('500 : un `constructor.name` qui lève : la ligne `error` est celle du gestionnaire, complète (le type retombe sur `Error`), pas celle du filet', async () => {
      const { res, lines } = await ask(failing(withThrowingClassName()));

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ statusCode: 500, error: 'Internal Server Error', message: 'boum' });
      expect(lines()).toMatchObject([{ level: ERROR, method: 'GET', route: '/api/projects', msg: 'Erreur inattendue', err: { type: 'Error', message: 'boum' } }]);
      expect(lines()[0]?.original).toBeUndefined();
    });

    it.each([
      ['un message BigInt', () => 10n],
      ['un message objet', () => ({ secret: 's3cret-objet' })],
      ['un message circulaire', () => circular()],
    ])('4xx : %s : le code de l’erreur est gardé, le corps dit un message générique, et l’objet ne part pas au client', async (_name, message) => {
      const { res, lines } = await ask(failing(withMessage(message(), { statusCode: 400 })));

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ statusCode: 400, error: 'Bad Request', message: GENERIC });
      expect(res.body).not.toContain('s3cret');
      expect(lines()).toEqual([]); // une requête refusée n'est pas une panne
    });

    it('un message texte d’une 4xx est dit tel quel au client, comme avant', async () => {
      const { res } = await ask(failing(Object.assign(new Error('requête mal formée'), { statusCode: 422 })));

      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ statusCode: 422, error: 'Unprocessable Entity', message: 'requête mal formée' });
    });

    // Le filet : ce qui, malgré les gardes, ferait lever le gestionnaire (ici, ce qu'il lit avant de journaliser quoi que ce soit). Sa ligne
    // est fixe, avec au mieux le type et le message de l'erreur (`original`) : ce qui ne se lit pas manque, sans faire échouer le filet.
    const throws = (what: string) => () => {
      throw new Error(what);
    };
    /** Une erreur que le filet rattrape (`instanceof` lève) et dont le type et le message sont `type` et `message`. */
    const caught = (message: unknown, type: unknown = 'MonErreur') => {
      const error = Object.defineProperty(new Error('boum'), 'message', { value: message });
      Object.defineProperty(error, 'constructor', { value: { name: type } });
      return new Proxy(error, { getPrototypeOf: throws('prototype-illisible') });
    };
    it.each([
      ['un `name` dont l’accesseur lève (lu pour reconnaître un abandon)', () => withGetter('name'), { type: 'Error', message: 'boum' }],
      ['un Proxy dont le prototype ne se lit pas (`instanceof` lève)', () => caught('boum', 'Error'), { type: 'Error', message: 'boum' }],
      ['un Proxy dont le piège `get` lève : rien ne se lit, ni type ni message', () => new Proxy(new Error('boum'), { get: throws('get-illisible') }), {}],
      ['un message qui n’est pas un texte : il manque, le type reste', () => caught({ secret: 's3cret-objet' }), { type: 'MonErreur' }],
      ['un type qui n’est pas un texte : il manque, le message reste', () => caught('boum', { secret: 's3cret-objet' }), { message: 'boum' }],
    ])('filet : %s : une ligne fixe sans l’adresse, et une réponse 500 générique', async (_name, thrown, original) => {
      const { res, lines } = await ask(failing(thrown()));

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ statusCode: 500, error: 'Internal Server Error', message: GENERIC });
      expect(lines()).toMatchObject([{ level: ERROR, method: 'GET', route: '/api/projects', msg: NET }]);
      expect(lines()[0]?.original).toEqual(original);
    });

    it('filet : le type et le message de la ligne sont plafonnés, comme le reste du journal', async () => {
      const served = serve(failing(caught(`début-${'m'.repeat(200_000)}-fin`, `Nom${'N'.repeat(200_000)}`)));

      await served.app.inject({ method: 'GET', url: URL_SECRETE, headers: SECRETS });

      expect(served.text().length).toBeLessThan(10_000);
      expect(served.text()).not.toContain('s3cret');
      const [line, ...others] = served.lines();
      expect(others).toEqual([]);
      expect(line).toMatchObject({ msg: NET });
      expect(line?.original?.type).toMatch(/^NomNNN/);
      expect(line?.original?.type?.length).toBeLessThanOrEqual(64);
      expect(line?.original?.message?.startsWith('début-mmm')).toBe(true);
      expect(line?.original?.message?.length).toBeLessThan(5_000);
      expect(line?.original?.message).not.toContain('-fin');
    });

    it('filet : une valeur levée dont l’inspection lève : une ligne fixe, une réponse 500 générique', async () => {
      const thrown = { [inspect.custom]: () => { throw new Error('inspection-qui-leve'); } };
      const { res, lines } = await ask(failing(thrown));

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ statusCode: 500, error: 'Internal Server Error', message: GENERIC });
      expect(lines()).toMatchObject([{ level: ERROR, msg: NET }]);
      expect(lines()[0]?.original).toEqual({ type: 'Object' }); // pas une Error : pas de message, et son type est celui d'un objet
    });

    // Les pièges d'un Proxy (bdesk-38k.58) : ce que `loggable` lit des `errors` et de la `cause` est gardé comme un accesseur, et ne retire que ce qu'il
    // portait. L'erreur laisse donc sa ligne complète (le gestionnaire), pas celle du filet, qui ne dit que le type et le message.
    const revokedList = () => {
      const { proxy, revoke } = Proxy.revocable([new Error('un')], {});
      revoke();
      return proxy;
    };
    const hostile = () => new Proxy(new Error('hostile'), { getPrototypeOf: throws('prototype-illisible') });
    it.each([
      ['des `errors` qui sont un Proxy révoqué (`Array.isArray` lève)', () => Object.assign(new AggregateError([], 'boum'), { errors: revokedList() }), 'AggregateError'],
      [
        'des `errors` dont le piège `get` lève (la lecture de `length` lève)',
        () => Object.assign(new AggregateError([], 'boum'), { errors: new Proxy([new Error('un')], { get: throws('get-illisible') }) }),
        'AggregateError',
      ],
      ['une erreur agrégée dont `getPrototypeOf` lève (`instanceof` lève)', () => new AggregateError([hostile()], 'boum'), 'AggregateError'],
      ['une `cause` dont `getPrototypeOf` lève (`instanceof` lève)', () => new Error('boum', { cause: hostile() }), 'Error'],
    ])('500 : %s : la ligne `error` est celle du gestionnaire, complète (pas celle du filet, sans `original`)', async (_name, thrown, type) => {
      const { res, lines } = await ask(failing(thrown()));

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ statusCode: 500, error: 'Internal Server Error', message: 'boum' });
      expect(lines()).toMatchObject([{ level: ERROR, method: 'GET', route: '/api/projects', msg: 'Erreur inattendue', err: { type, message: 'boum' } }]);
      expect(lines()[0]?.original).toBeUndefined();
    });

    it('une erreur agrégée qui ne se lit pas ne retire pas ses voisines : les autres sont écrites, celle-là est dite par `inspect`', async () => {
      const { res, lines } = await ask(failing(new AggregateError([new Error('saine'), hostile(), new Error('aussi saine')], 'boum')));

      expect(res.statusCode).toBe(500);
      const err = lines()[0]?.err as unknown as { aggregateErrors: (string | { message: string })[] };
      expect(err.aggregateErrors).toHaveLength(3);
      expect(err.aggregateErrors[0]).toMatchObject({ message: 'saine' });
      expect(String(err.aggregateErrors[1])).toContain('hostile');
      expect(err.aggregateErrors[2]).toMatchObject({ message: 'aussi saine' });
    });

    // Les `errors` sont une liste que l'erreur fournit : `loggable` n'en lit que `length` et les indices, sous garde, et n'appelle aucune de ses
    // méthodes (`slice`, `map`, `Symbol.species`, qu'une sous-classe d'`Array` redéfinit). Le plafond de trois erreurs est le sien, pas celui de l'erreur.
    class SliceMany extends Array<Error> {
      override slice(): Error[] {
        return Array.from({ length: 2_000 }, (_value, i) => new Error(`erreur ${i}`));
      }
    }
    class MapHuge extends Array<Error> {
      override map(): never[] {
        return ['H'.repeat(1_000_000)] as unknown as never[];
      }
    }
    class SpeciesThrows extends Array<Error> {
      static override get [Symbol.species](): ArrayConstructor {
        throw new Error('species-illisible');
      }
    }
    const aggregateErrorsOf = (line: unknown) => (line as { err: { aggregateErrors?: (string | { message: string })[] } }).err.aggregateErrors;

    it.each([
      ['un `slice` redéfini qui rend 2 000 erreurs', () => SliceMany.from([new Error('une')])],
      ['un `map` redéfini qui rend un texte d’un million de caractères', () => MapHuge.from([new Error('une')])],
      ['un `Symbol.species` dont l’accesseur lève', () => SpeciesThrows.from([new Error('une')])],
    ])('500 : des `errors` avec %s : la seule erreur de la liste est écrite, et la ligne reste bornée', async (_name, list) => {
      const { res, lines } = await ask(failing(Object.assign(new AggregateError([], 'boum'), { errors: list() })));

      expect(res.statusCode).toBe(500);
      const [line, ...others] = lines();
      expect(others).toEqual([]);
      expect(aggregateErrorsOf(line)).toMatchObject([{ message: 'une' }]); // une, pas 2 000 ni un texte d'un million : ni `slice` ni `map` n'est appelé
      expect(JSON.stringify(line).length).toBeLessThan(20_000);
      expect(line?.original).toBeUndefined(); // la ligne du gestionnaire, pas celle du filet
    });

    it('un élément de `errors` dont l’accesseur lève ne retire pas ses voisins : les deux saines sont écrites, la sienne est dite illisible', async () => {
      const list: unknown[] = [new Error('saine')];
      Object.defineProperty(list, 1, { get: throws('élément-illisible'), enumerable: true });
      list.push(new Error('aussi saine'));
      const { res, lines } = await ask(failing(Object.assign(new AggregateError([], 'boum'), { errors: list })));

      expect(res.statusCode).toBe(500);
      const written = aggregateErrorsOf(lines()[0]);
      expect(written).toHaveLength(3);
      expect(written?.[0]).toMatchObject({ message: 'saine' });
      expect(written?.[1]).toBe('(illisible)'); // sans guillemets, comme un message ou une valeur qui ne se lisent pas (bdesk-38k.60) : `inspect` en mettrait à un texte
      expect(written?.[2]).toMatchObject({ message: 'aussi saine' });
    });

    it('un élément de `errors` qui est vraiment le texte « (illisible) » s’écrit entre guillemets, par `inspect` : on ne le prend pas pour un élément qui ne se lit pas', async () => {
      const { res, lines } = await ask(failing(Object.assign(new AggregateError([], 'boum'), { errors: ['(illisible)'] })));

      expect(res.statusCode).toBe(500);
      expect(aggregateErrorsOf(lines()[0])).toEqual(["'(illisible)'"]);
    });

    // `loggable` lit la `length` de la liste par `Math.min`, qui la convertit en nombre : ce n'est pas un contrôle de type (bdesk-38k.60, le commentaire de
    // `errorLog.ts` et l'ADR 0002 disaient qu'une `length` qui n'est pas un nombre n'était pas écrite). Une `length` qui se convertit en un nombre d'au moins 0
    // compte pour ce nombre, au plus trois erreurs ; une qui ne s'y convertit pas (qui lève, ou donne NaN ou un nombre négatif) ne fait pas écrire la liste.
    const listWithLength = (length: unknown) =>
      new Proxy([new Error('un'), new Error('deux'), new Error('trois'), new Error('quatre')], {
        get: (target, key) => (key === 'length' ? length : Reflect.get(target, key)),
      });

    it.each([
      ['une chaîne qui vaut 2', '2', ['un', 'deux']],
      ['un objet dont `valueOf` rend 2', { valueOf: () => 2 }, ['un', 'deux']],
      ['un objet dont `valueOf` rend un milliard', { valueOf: () => 1e9 }, ['un', 'deux', 'trois']],
      ['Infinity', Infinity, ['un', 'deux', 'trois']],
    ])('des `errors` dont la `length` est %s : elle est convertie en nombre, et au plus trois erreurs sont écrites', async (_name, length, messages) => {
      const { res, lines } = await ask(failing(Object.assign(new AggregateError([], 'boum'), { errors: listWithLength(length) })));

      expect(res.statusCode).toBe(500);
      const written = aggregateErrorsOf(lines()[0]);
      expect(written).toHaveLength(messages.length);
      expect(written).toMatchObject(messages.map((message) => ({ message })));
    });

    it.each([
      ['un Proxy révoqué', () => revokedList()],
      ['une `length` dont le piège lève', () => new Proxy([new Error('un')], { get: (target, key) => (key === 'length' ? throws('length-illisible')() : Reflect.get(target, key)) })],
      ['une `length` qui est un BigInt', () => listWithLength(1n)],
      ['une `length` qui est un Symbol (sa conversion lève)', () => listWithLength(Symbol('length'))],
      ['une `length` dont `valueOf` lève', () => listWithLength({ valueOf: throws('valueOf-illisible') })],
      ['une `length` qui vaut NaN', () => listWithLength(NaN)],
      ['une `length` qui ne se convertit pas en nombre (`undefined`)', () => listWithLength(undefined)],
      ['une `length` négative', () => listWithLength(-1)],
    ])('des `errors` qui sont %s ne se lisent pas : `aggregateErrors` n’est pas écrit (pas un `[]` qui dirait « aucune erreur »), et la ligne est celle du gestionnaire', async (_name, list) => {
      const { res, lines } = await ask(failing(Object.assign(new AggregateError([], 'boum'), { errors: list() })));

      expect(res.statusCode).toBe(500);
      expect(lines()).toMatchObject([{ level: ERROR, msg: 'Erreur inattendue', err: { type: 'AggregateError', message: 'boum' } }]);
      expect(aggregateErrorsOf(lines()[0])).toBeUndefined();
      expect(lines()[0]?.original).toBeUndefined();
    });

    it.each([
      ['un texte', () => 'abc'],
      ['un objet qui a une `length`', () => ({ length: 2, 0: 'a', 1: 'b' })],
    ])('des `errors` qui sont %s, et non une liste, ne sont pas écrites : un texte ne devient pas trois « erreurs »', async (_name, errors) => {
      const { res, lines } = await ask(failing(Object.assign(new Error('boum'), { errors: errors() })));

      expect(res.statusCode).toBe(500);
      expect(lines()).toMatchObject([{ level: ERROR, msg: 'Erreur inattendue', err: { type: 'Error', message: 'boum' } }]);
      expect(aggregateErrorsOf(lines()[0])).toBeUndefined();
    });
  });

  /**
   * bdesk-38k.52 (relecture, remarques mineures) : la ligne est bornée en tout, pas seulement par texte (nombre de propriétés copiées, longueur
   * des clés), elle garde les erreurs d'un `AggregateError` (que le sérialiseur de pino écrivait avant le plafond), le `code` d'un `DOMException`
   * et une `cause` qui est un texte, et ne coupe pas une paire de substitution en deux.
   */
  describe('ce que la ligne garde, et sa taille totale (bdesk-38k.52)', () => {
    const HUGE = 200_000;
    const failing = (error: unknown): Partial<ProjectService> => ({
      list: async () => {
        throw error;
      },
    });
    const errOf = (lines: () => LogLine[]) => lines()[0]?.err as unknown as Record<string, unknown>;
    /** `Class`, rebaptisée `name` : le nom de la classe d'une erreur est le `type` que le journal écrit. */
    const renamed = <T extends object>(Class: T, name: string): T => Object.defineProperty(Class, 'name', { value: name });

    it('300 propriétés de 4 000 caractères : un nombre borné de propriétés est écrit, la ligne ne grossit pas avec leur nombre', async () => {
      const props = Object.fromEntries(Array.from({ length: 300 }, (_v, i) => [`prop${i}`, 'p'.repeat(4_000)]));
      const { app, lines, text } = serve(failing(Object.assign(new Error('boum'), props)));

      await app.inject({ method: 'GET', url: '/api/projects' });

      expect(text().length).toBeLessThan(60_000); // 300 × 4 000 = 1,2 million sans plafond
      const err = errOf(lines);
      expect(Object.keys(err).filter((key) => key.startsWith('prop'))).toHaveLength(10);
      expect(err).toHaveProperty('prop0'); // les premières, dans l'ordre où l'erreur les a posées
    });

    it('une clé de 200 000 caractères est coupée : la ligne ne grossit pas avec la longueur des clés', async () => {
      const { app, lines, text } = serve(failing(Object.assign(new Error('boum'), { ['k'.repeat(HUGE)]: 'valeur' })));

      await app.inject({ method: 'GET', url: '/api/projects' });

      expect(text().length).toBeLessThan(20_000);
      const keys = Object.keys(errOf(lines)).filter((key) => key.startsWith('kkk'));
      expect(keys).toHaveLength(1); // la propriété est là, sous une clé coupée
      expect(keys[0]?.length).toBeLessThanOrEqual(64);
    });

    it('deux clés coupées au même début de 64 caractères s’écrivent toutes les deux (la seconde suffixée), sans s’écraser ni compter pour une', async () => {
      const prefix = 'k'.repeat(64);
      const { app, lines } = serve(
        failing(Object.assign(new Error('boum'), { [prefix]: 'exacte', [`${prefix}-a`]: 'longue-a', [`${prefix}-b`]: 'longue-b' })),
      );

      await app.inject({ method: 'GET', url: '/api/projects' });

      const err = errOf(lines);
      const keys = Object.keys(err).filter((key) => key.startsWith('kkk'));
      expect(keys).toEqual([prefix, `${'k'.repeat(62)}~2`, `${'k'.repeat(62)}~3`]);
      expect(keys.map((key) => err[key])).toEqual(['exacte', 'longue-a', 'longue-b']);
      expect(Math.max(...keys.map((key) => key.length))).toBe(64);
    });

    // Le nom de la classe est le `type` de la ligne (pino lit `constructor.name`, pour l'erreur et pour chacune de ses erreurs agrégées) : il est
    // coupé à 64 caractères comme les clés, sans quoi la ligne grossirait avec lui.
    it('le nom de la classe de l’erreur (le `type` de la ligne) est coupé à 64 caractères : la ligne ne grossit pas avec lui', async () => {
      const Named = renamed(class extends Error {}, `Nom${'N'.repeat(HUGE)}`);
      const { app, lines, text } = serve(failing(new Named('boum')));

      const res = await app.inject({ method: 'GET', url: '/api/projects' });

      expect(res.statusCode).toBe(500);
      expect(lines()).toHaveLength(1);
      expect(text().length).toBeLessThan(10_000); // plus de 200 000 sans plafond
      expect(errOf(lines)).toMatchObject({ type: `Nom${'N'.repeat(61)}`, message: 'boum' });
    });

    it('de même pour l’AggregateError et ses erreurs : le nom de chaque classe est coupé', async () => {
      const Named = renamed(class extends Error {}, `Nom${'N'.repeat(HUGE)}`);
      const Aggregate = renamed(class extends AggregateError {}, `Agg${'A'.repeat(HUGE)}`);
      const { app, lines, text } = serve(failing(new Aggregate([new Named('a'), new Named('b'), new Named('c'), new Named('d')], 'plusieurs')));

      await app.inject({ method: 'GET', url: '/api/projects' });

      expect(lines()).toHaveLength(1);
      expect(text().length).toBeLessThan(20_000); // plus de 800 000 sans plafond
      const err = errOf(lines) as { type: string; aggregateErrors: { type: string }[] };
      expect(err.type).toBe(`Agg${'A'.repeat(61)}`);
      expect(err.aggregateErrors.map((inner) => inner.type)).toEqual(Array(3).fill(`Nom${'N'.repeat(61)}`)); // les trois premières
    });

    it.each([
      ['de 64 caractères : gardé en entier', 'N'.repeat(64), 'N'.repeat(64)],
      ['de 65 caractères : coupé à 64', 'N'.repeat(65), 'N'.repeat(64)],
      ['dont une paire de substitution est à cheval sur la coupure : elle n’est pas coupée en deux', `${'N'.repeat(63)}😀`, 'N'.repeat(63)],
      ['court : tel quel', 'ErreurDeLaBase', 'ErreurDeLaBase'],
    ])('un nom de classe %s', async (_name, name, written) => {
      const Named = renamed(class extends Error {}, name);
      const { app, lines } = serve(failing(new Named('boum')));

      await app.inject({ method: 'GET', url: '/api/projects' });

      expect((errOf(lines) as { type: string }).type).toBe(written);
    });

    it('un AggregateError garde ses erreurs (les premières, chacune plafonnée), comme le sérialiseur de pino avant le plafond', async () => {
      const inner = [new Error('un'), `deux-${'x'.repeat(HUGE)}`, new Error(`trois-${'y'.repeat(HUGE)}`), new Error('quatre')];
      const { app, lines, text } = serve(failing(new AggregateError(inner, 'plusieurs échecs')));

      const res = await app.inject({ method: 'GET', url: '/api/projects' });

      expect(res.statusCode).toBe(500);
      expect(text().length).toBeLessThan(30_000);
      const err = errOf(lines) as { type: string; message: string; aggregateErrors: { type: string; message: string }[] };
      expect(err).toMatchObject({ type: 'AggregateError', message: 'plusieurs échecs' });
      expect(err.aggregateErrors).toHaveLength(3); // pas les quatre
      expect(err.aggregateErrors[0]).toMatchObject({ type: 'Error', message: 'un' });
      expect(String(err.aggregateErrors[1]).startsWith("'deux-xxx")).toBe(true); // une valeur qui n'est pas une Error : dite par `inspect`, plafonnée
      expect(String(err.aggregateErrors[1]).length).toBeLessThan(HUGE / 10);
      expect(err.aggregateErrors[2]?.message.startsWith('trois-yyy')).toBe(true);
      expect(err.aggregateErrors[2]?.message.length).toBeLessThan(HUGE / 10);
      expect(text()).not.toContain('quatre');
    });

    it('des AggregateError imbriqués, aux gros messages : la ligne reste bornée (les erreurs d’une erreur n’ont ni cause ni erreurs)', async () => {
      const tree = (depth: number): AggregateError =>
        new AggregateError(depth === 0 ? [] : [tree(depth - 1), tree(depth - 1), tree(depth - 1)], `niveau ${depth} ${'m'.repeat(HUGE)}`, { cause: new Error(`cause ${'c'.repeat(HUGE)}`) });
      const { app, lines, text } = serve(failing(tree(5)));

      await app.inject({ method: 'GET', url: '/api/projects' });

      expect(lines()).toHaveLength(1);
      expect(text().length).toBeLessThan(80_000); // 3^5 erreurs, chacune de 400 000 caractères, sans plafond
    });

    // Le pire cas, mesuré en octets (ADR 0002 : « au pire quelque 1,4 Mo ») : une `Error` aux textes les plus longs, tous faits de caractères de
    // contrôle, que JSON écrit en six octets chacun (`\u0001`). Au pire, 57 textes de 4 000 caractères : le message, la pile et dix propriétés de
    // l'erreur, les messages et les piles de ses trois causes, et, pour chacune des trois erreurs d'un `AggregateError`, son message, sa pile, dix
    // propriétés et une `cause` qui est un texte ; et quatre noms de classe de 64 caractères (celui de l'`AggregateError` et ceux de ses trois
    // erreurs), eux aussi de caractères de contrôle. Si ce nombre change, l'ADR aussi.
    it('le pire cas, en octets : toutes les propriétés, tous les textes et tous les noms de classe au plafond, en caractères de contrôle', async () => {
      const control = '\u0001'.repeat(10_000);
      const ClassName = renamed(class extends Error {}, '\u0001'.repeat(HUGE));
      const AggregateClassName = renamed(class extends AggregateError {}, '\u0001'.repeat(HUGE));
      const full = (error: Error): Error =>
        Object.assign(error, { stack: control }, Object.fromEntries(Array.from({ length: 12 }, (_v, i) => ['\u0001'.repeat(70 + i), control])));
      let chain = full(new ClassName(control));
      for (let depth = 1; depth < 6; depth++) chain = full(new ClassName(control, { cause: chain })); // six causes : la ligne n'en suit que trois
      const inner = () => full(new ClassName(control, { cause: control }));
      const worst = full(new AggregateClassName([inner(), inner(), inner(), inner()], control, { cause: chain }));
      const { app, text } = serve(failing(worst));

      await app.inject({ method: 'GET', url: '/api/projects' });

      expect(Buffer.byteLength(text())).toBeGreaterThan(1_350_000); // 57 × 4 000 × 6 octets, et les clés et les noms
      expect(Buffer.byteLength(text())).toBeLessThan(1_400_000);
    });

    it('un AggregateError qui se contient lui-même : une ligne, sans boucle', async () => {
      const aggregate = new AggregateError([], 'cercle');
      aggregate.errors.push(aggregate, new AggregateError([aggregate], 'dedans'));
      const { app, lines } = serve(failing(aggregate));

      const res = await app.inject({ method: 'GET', url: '/api/projects' });

      expect(res.statusCode).toBe(500);
      expect(lines()).toHaveLength(1);
      expect(errOf(lines)).toMatchObject({ type: 'AggregateError', message: 'cercle' });
    });

    it.each([
      ['la paire à cheval sur le plafond n’est pas coupée en deux : le message s’arrête avant elle', 3_999, 'a'.repeat(3_999), 502],
      ['une paire qui tient dans le plafond est gardée en entier', 3_998, `${'a'.repeat(3_998)}😀`, 500],
    ])('%s', async (_name, before, kept, rest) => {
      const { app, lines } = serve(failing(new Error(`${'a'.repeat(before)}😀${'b'.repeat(500)}`)));

      await app.inject({ method: 'GET', url: '/api/projects' });

      const message = (errOf(lines) as { message: string }).message;
      expect(message).toBe(`${kept}… (+${rest} caractères)`); // ni demi-paire en fin de texte, et ce qui reste est dit
    });

    it('le `code` d’un DOMException (un accesseur du prototype, que `Object.entries` ne voit pas) est écrit', async () => {
      const { app, lines } = serve(failing(new DOMException('délai dépassé', 'TimeoutError')));

      await app.inject({ method: 'GET', url: '/api/projects' });

      expect(errOf(lines)).toMatchObject({ type: 'DOMException', message: 'délai dépassé', code: 23 });
    });

    it('une `cause` qui est un texte est écrite, plafonnée ; une `cause` qui est une Error est toujours suivie', async () => {
      const { app, lines, text } = serve(failing(new Error('boum', { cause: `racine-${'c'.repeat(HUGE)}` })));
      const another = serve(failing(new Error('boum', { cause: 'court' })));
      const chained = serve(failing(new Error('boum', { cause: new Error('cause d’Error') })));

      await app.inject({ method: 'GET', url: '/api/projects' });
      await another.app.inject({ method: 'GET', url: '/api/projects' });
      await chained.app.inject({ method: 'GET', url: '/api/projects' });

      expect(text().length).toBeLessThan(20_000);
      expect(String(errOf(lines).cause).startsWith('racine-ccc')).toBe(true);
      expect(String(errOf(lines).cause).length).toBeLessThan(HUGE / 10);
      expect(errOf(another.lines).cause).toBe('court');
      expect(errOf(chained.lines).message).toBe('boum: cause d’Error');
    });
  });

  /**
   * bdesk-38k.52 (m4) : un `statusCode` qui n'est pas un code HTTP valide faisait lever `reply.code` dans le gestionnaire ; Fastify prenait alors
   * le relais avec son gestionnaire par défaut, qui écrit l'adresse demandée avec sa requête (`?token=…` mesuré dans le journal). Le code est
   * donc borné avant `reply.code` : un entier de 400 à 599, sinon 500.
   */
  describe('code de statut de l’erreur (bdesk-38k.52)', () => {
    const failing = (error: unknown): Partial<ProjectService> => ({
      list: async () => {
        throw error;
      },
    });
    const withStatusCode = (statusCode: unknown) => failing(Object.assign(new Error('boum'), { statusCode }));

    it.each([
      ['une chaîne qui n’est pas un nombre', 'abc'],
      ['un nombre écrit en chaîne', '503'],
      ['600, juste au-dessus des codes HTTP', 600],
      ['un très grand nombre', 99_999],
      ['un code 2xx', 200],
      ['un code 3xx', 302],
      ['399, juste sous les erreurs', 399],
      ['zéro', 0],
      ['un nombre négatif', -503],
      ['un nombre à virgule', 503.5],
      ['NaN', Number.NaN],
      ['l’infini', Number.POSITIVE_INFINITY],
      ['null', null],
      ['un objet', { code: 503 }],
      ['un booléen', true],
    ])('statusCode invalide (%s) : 500 en JSON, une seule ligne `error`, et ni l’adresse demandée ni sa requête au journal', async (_name, statusCode) => {
      const { app, lines, text } = serve(withStatusCode(statusCode));

      const res = await app.inject({
        method: 'GET',
        url: '/api/projects?token=s3cret-requete',
        headers: { authorization: 'Bearer s3cret-en-tete', cookie: 'session=s3cret-cookie' },
      });

      expect(text()).not.toContain('s3cret'); // le gestionnaire par défaut de Fastify, lui, écrit `req.url` avec sa requête
      expect(text()).not.toContain('token');
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ statusCode: 500, error: 'Internal Server Error', message: 'boum' });
      const [line, ...others] = lines();
      expect(others).toEqual([]); // la nôtre, pas aussi celle du gestionnaire de Fastify
      expect(line).toMatchObject({ level: ERROR, method: 'GET', route: '/api/projects', msg: 'Erreur inattendue', err: { type: 'Error', message: 'boum' } });
    });

    it.each([
      [400, 400, false],
      [404, 404, false],
      [499, 499, false],
      [500, 500, true],
      [503, 503, true],
      [599, 599, true],
    ])('statusCode %i est un code valide : la réponse le garde, et la ligne `error` est écrite à partir de 500 seulement (%s)', async (statusCode, expected, logged) => {
      const { app, lines } = serve(withStatusCode(statusCode));

      const res = await app.inject({ method: 'GET', url: '/api/projects' });

      expect(res.statusCode).toBe(expected);
      expect(res.json()).toMatchObject({ statusCode: expected, message: 'boum' });
      expect(lines()).toHaveLength(logged ? 1 : 0);
    });

    // m2 : `status` est la convention de `http-errors` (que `statusCode` double) ; Fastify en aurait pris le code, le gestionnaire l'ignorait (500).
    it.each([
      [503, true],
      [502, true],
      [404, false],
      [418, false],
    ])('une Error qui porte `status` %i (convention de http-errors), sans `statusCode` : la réponse le suit, la ligne `error` aussi (%s)', async (status, logged) => {
      const { app, lines } = serve(failing(Object.assign(new Error('boum'), { status })));

      const res = await app.inject({ method: 'GET', url: '/api/projects' });

      expect(res.statusCode).toBe(status);
      expect(res.json()).toMatchObject({ statusCode: status, message: 'boum' });
      expect(lines()).toHaveLength(logged ? 1 : 0);
    });

    it.each([
      ['une chaîne', '503'],
      ['un code hors de 400 à 599', 700],
      ['un code 3xx', 301],
      ['un nombre à virgule', 404.5],
    ])('un `status` invalide (%s) vaut 500 comme un `statusCode` invalide : une seule ligne, sans l’adresse demandée', async (_name, status) => {
      const { app, lines, text } = serve(failing(Object.assign(new Error('boum'), { status })));

      const res = await app.inject({ method: 'GET', url: '/api/projects?token=s3cret-requete' });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ statusCode: 500, error: 'Internal Server Error', message: 'boum' });
      expect(lines()).toHaveLength(1);
      expect(text()).not.toContain('s3cret');
    });

    it('avec les deux, `statusCode` prime ; s’il est invalide, `status` prend le relais', async () => {
      const both = serve(failing(Object.assign(new Error('boum'), { statusCode: 418, status: 503 })));
      expect((await both.app.inject({ method: 'GET', url: '/api/projects' })).statusCode).toBe(418);
      expect(both.lines()).toEqual([]);

      const fallback = serve(failing(Object.assign(new Error('boum'), { statusCode: 'abc', status: 503 })));
      expect((await fallback.app.inject({ method: 'GET', url: '/api/projects' })).statusCode).toBe(503);
      expect(fallback.lines()).toHaveLength(1);
    });

    it('un objet levé qui n’est pas une Error ne choisit pas son code, `status` ou `statusCode` : 500 comme avant', async () => {
      const { app } = serve(failing({ status: 404, statusCode: 404 }));

      const res = await app.inject({ method: 'GET', url: '/api/projects' });

      expect(res.statusCode).toBe(500);
    });
  });

  /**
   * bdesk-38k.52 (m5) : le 499 se décidait au seul nom de l'erreur (`AbortError`). Une `ReadAborted` levée alors que le client attend toujours
   * (une lecture partagée annulée par d'autres, un délai) répondait 499 sans rien écrire : une panne passée sous silence. Il faut aussi que le
   * client soit parti, sa connexion fermée avant la réponse. `req.signal` ne le dit pas seul : Fastify ne l'écoute qu'à sa première lecture, et
   * une route qui ne le lit pas (la liste des Projets) ne le voit jamais abandonné, même quand la connexion est fermée (mesuré).
   */
  describe('départ du client (bdesk-38k.52)', () => {
    /** Un service qui lève `thrown()` quand le test ouvre la porte (`open`), après avoir dit qu'il était arrivé (`entered`). */
    function gated(thrown: () => unknown) {
      let open = () => {};
      let enter = () => {};
      const opened = new Promise<void>((resolve) => {
        open = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const fail = async (): Promise<never> => {
        enter();
        await opened;
        throw thrown();
      };
      return { fail, open, entered };
    }

    const ROUTES: [name: string, url: string, stub: (fail: () => Promise<never>) => Partial<ProjectService>][] = [
      ['la liste des Projets, qui ne lit pas `req.signal`', '/api/projects', (fail) => ({ list: fail })],
      ['la liste des tickets', '/api/projects/beads-desktop/issues', (fail) => ({ issues: fail })],
      ['la fiche d’un ticket', '/api/projects/beads-desktop/issues/bdesk-38k.4', (fail) => ({ issue: fail })],
    ];

    /**
     * Un client réel : il demande `path`, et l'on rend la main quand le serveur a reçu la requête. Sur une vraie connexion : l'`inject` abandonné de
     * Fastify écrit lui-même une ligne `error` (« request errored »), que le serveur réel n'écrit pas.
     */
    async function connect(app: FastifyInstance, path: string) {
      await app.listen({ host: '127.0.0.1', port: 0 });
      const { port } = app.server.address() as AddressInfo;
      const client = request({ host: '127.0.0.1', port, path });
      client.on('error', () => undefined);
      client.end();
      return client;
    }

    it.each(ROUTES)('%s : le client ferme sa connexion, puis la lecture finit en abandon : 499 et rien au journal', async (_name, url, stub) => {
      const { fail, open, entered } = gated(() => new ReadAborted());
      const { app, lines } = serve(stub(fail));
      const { sent, left } = watch(app);
      const client = await connect(app, url);
      await entered;

      client.destroy();
      await left();
      open();

      await vi.waitFor(() => expect(sent).toEqual([499]), { timeout: 5_000 });
      expect(lines()).toEqual([]);
    });

    it.each([
      ['une ReadAborted', () => new ReadAborted(), 'ReadAborted'],
      ['une AbortError de la plateforme (DOMException)', () => new DOMException('The operation was aborted.', 'AbortError'), 'DOMException'],
      ['une Error nommée AbortError', () => Object.assign(new Error('délai dépassé'), { name: 'AbortError' }), 'Error'],
    ])('%s levée alors que le client attend toujours n’est pas son abandon : une panne, 500 et une ligne `error`', async (_name, thrown, type) => {
      const { app, lines } = serve({
        list: async () => {
          throw thrown();
        },
      });

      const res = await app.inject({ method: 'GET', url: '/api/projects' });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toMatchObject({ statusCode: 500, error: 'Internal Server Error' });
      // `type` est la classe de l'erreur : la copie plafonnée de `loggable` la garde, même pour un DOMException dont les accesseurs lèvent hors de lui
      expect(lines()).toMatchObject([{ level: ERROR, method: 'GET', route: '/api/projects', msg: 'Erreur inattendue', err: { type, message: expect.any(String) } }]);
    });

    it('le départ du client ne suffit pas : une vraie panne qui survient après son départ reste une panne, tracée (500, une ligne `error`)', async () => {
      const { fail, open, entered } = gated(() => new Error('vraie panne'));
      const { app, lines } = serve({ list: fail });
      const { sent, left } = watch(app);
      const client = await connect(app, '/api/projects');
      await entered;

      client.destroy();
      await left();
      open();

      await vi.waitFor(() => expect(sent).toEqual([500]), { timeout: 5_000 });
      expect(lines()).toMatchObject([{ level: ERROR, msg: 'Erreur inattendue', err: { message: 'vraie panne' } }]);
    });
  });
});
