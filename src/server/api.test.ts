import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
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
        'projects', 'range', 'slices', 'tiles', 'timeZone', 'unreadable',
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

  it('un abandon n’est pas une panne : aucune réponse 500 ni 503 n’en sort', async () => {
    const app = buildServer({
      config,
      projects: serviceWith({
        issue: async () => {
          throw new ReadAborted();
        },
      }),
    });

    const res = await app.inject({ method: 'GET', url: '/api/projects/beads-desktop/issues/bdesk-38k.4' });

    expect(res.statusCode).not.toBe(500);
    expect(res.statusCode).not.toBe(503);
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
    expect(line).toMatchObject({ level: ERROR, method: 'GET', route, msg: expect.stringContaining('boum'), err: { type: 'Error', message: 'boum' } });
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
    expect(lines()).toMatchObject([{ level: ERROR, method: 'GET', route: '/api/projects', msg: expect.stringContaining('passerelle') }]);
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
    {
      name: 'une lecture abandonnée',
      url: '/api/projects/beads-desktop/issues/bdesk-38k.4',
      stub: {
        issue: async () => {
          throw new ReadAborted();
        },
      },
      status: 499,
    },
  ];

  it.each(QUIET)('$name ($status) : une réponse attendue, rien au journal', async ({ url, stub, headers, status }) => {
    const { app, lines } = serve(stub);

    const res = await app.inject({ method: 'GET', url, headers });

    expect(res.statusCode).toBe(status);
    expect(lines()).toEqual([]);
  });
});
