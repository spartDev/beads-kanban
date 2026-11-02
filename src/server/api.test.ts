import { describe, expect, it } from 'vitest';
import { InvalidPeriodError } from '../domain/calendar';
import type { TicketHistory } from '../domain/flow';
import type { Issue, IssueDetail, MetricsResponse, Project } from '../shared/api';
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
        'asOf', 'bucket', 'buckets', 'cfd', 'cycleTimeScatter', 'generatedAt', 'inProgress', 'period', 'previousAsOf', 'previousPeriod',
        'projects', 'range', 'slices', 'tiles', 'timeZone', 'unreadable',
      ].sort(),
    );
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
