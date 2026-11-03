/** URL de l'application : un seul endroit pour les construire et les lire. */

const enc = encodeURIComponent;

export const PROJECT_SECTIONS = ['kanban', 'epics', 'metrics'] as const;
export type ProjectSection = (typeof PROJECT_SECTIONS)[number];

export const paths = {
  global: () => '/',
  project: (projectId: string) => `/p/${enc(projectId)}`,
  /** Avec `epicId`, le kanban ne montre que les Enfants de cette Epic (`?epic=`). */
  kanban: (projectId: string, epicId?: string) =>
    `/p/${enc(projectId)}/kanban${epicId ? `?epic=${enc(epicId)}` : ''}`,
  /** Avec `epicId`, la page Epics s'ouvre sur cette Epic (`?epic=`). */
  epics: (projectId: string, epicId?: string) =>
    `/p/${enc(projectId)}/epics${epicId ? `?epic=${enc(epicId)}` : ''}`,
  metrics: (projectId: string) => `/p/${enc(projectId)}/metrics`,
  issue: (projectId: string, issueId: string) => `/p/${enc(projectId)}/t/${enc(issueId)}`,
} as const;

export function sectionPath(section: ProjectSection, projectId: string): string {
  return paths[section](projectId);
}

export interface RouteInfo {
  projectId?: string;
  /** `issue` : détail d'un ticket (`/p/:projectId/t/:issueId`). */
  section?: ProjectSection | 'issue';
  issueId?: string;
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Ce que l'URL désigne : Projet courant, section, ticket. Vide pour la Vue globale. */
export function parsePath(pathname: string): RouteInfo {
  const [root, projectId, section, issueId] = pathname.split('/').filter(Boolean).map(decode);
  if (root !== 'p' || !projectId) return {};
  if (section === 't' && issueId) return { projectId, section: 'issue', issueId };
  if (section === 'kanban' || section === 'epics' || section === 'metrics') {
    return { projectId, section };
  }
  return { projectId };
}
