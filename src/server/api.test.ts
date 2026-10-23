import { describe, expect, it } from 'vitest';
import type { Issue, IssueDetail, Project } from '../shared/api';
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
