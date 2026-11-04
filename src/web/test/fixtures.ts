import type { Issue, IssueChronology, IssueDetail, Project, ProjectsResponse } from '../data/types';

export const projects: Project[] = [
  { id: 'bdesk', name: 'beads-desktop', path: '/dev/beads-desktop', prefix: 'bdesk', mode: 'embedded', status: 'ok' },
  { id: 'mpm', name: 'My-Prompt-Manager', path: '/dev/My-Prompt-Manager', prefix: 'mpm', mode: 'server', status: 'ok' },
  {
    id: 'legacy',
    name: 'legacy-api',
    path: '/dev/legacy-api',
    prefix: 'lapi',
    mode: 'embedded',
    status: 'unreadable',
    reason: 'Base Dolt verrouillée par un autre processus',
  },
];

export const projectsResponse: ProjectsResponse = {
  projects,
  ignored: [{ path: '/dev/notes', reason: 'Workspace non-Dolt' }],
};

export function issue(overrides: Partial<Issue> & Pick<Issue, 'id' | 'title'>): Issue {
  return {
    type: 'task',
    status: 'open',
    priority: 2,
    assignee: null,
    parentId: null,
    createdAt: '2026-10-01T09:00:00Z',
    updatedAt: '2026-10-10T09:00:00Z',
    closedAt: null,
    blockedBy: [],
    ...overrides,
  };
}

/** Un ticket tel que le renvoie `GET /api/projects/:id/issues/:issueId` : la fiche, avec ses champs texte. */
export function issueDetail(overrides: Partial<IssueDetail> & Pick<IssueDetail, 'id' | 'title'>): IssueDetail {
  return {
    ...issue(overrides),
    description: '',
    design: '',
    acceptanceCriteria: '',
    notes: '',
    closeReason: '',
    labels: [],
    dependencies: [],
    dependents: [],
    linked: {},
    comments: [],
    ...overrides,
  };
}

/** Une chronologie telle que la renvoie `GET …/chronology` : celle d'un ticket resté ouvert depuis sa création, sauf indication contraire. */
export function chronology(overrides: Partial<IssueChronology> = {}): IssueChronology {
  return {
    source: 'history',
    transitions: [{ status: 'open', at: '2026-10-01T09:00:00.000Z', duration: null }],
    blockages: [],
    outcome: { kind: 'open' },
    leadTime: null,
    cycleTime: null,
    blockedTime: null,
    reopenings: 0,
    ...overrides,
  };
}

export const bdeskIssues: Issue[] = [
  issue({ id: 'bdesk-38k', title: 'beads-desktop V1 : suivi des tickets', type: 'epic', priority: 1 }),
  issue({
    id: 'bdesk-38k.6',
    title: 'Shell UI façon Linear : thèmes, navigation, ⌘K, raccourcis',
    type: 'feature',
    priority: 1,
    status: 'in_progress',
    parentId: 'bdesk-38k',
    updatedAt: '2026-10-20T09:00:00Z',
  }),
  issue({ id: 'bdesk-38k.7', title: 'Kanban par Projet (lecture seule)', type: 'feature', priority: 1, parentId: 'bdesk-38k' }),
  issue({ id: 'bdesk-b7q', title: 'Le graphique du Débit se décale après minuit', type: 'bug', priority: 0 }),
];

export const mpmIssues: Issue[] = [
  issue({ id: 'mpm-12', title: 'Recherche plein texte dans les prompts', type: 'feature' }),
];
