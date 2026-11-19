/** URL de l'application : un seul endroit pour les construire et les lire. */

const enc = encodeURIComponent;

export const PROJECT_SECTIONS = ['kanban', 'signals', 'epics', 'metrics'] as const;

/**
 * Les paramètres de l'adresse des pages Métriques et de la Vue globale : la période (`range`, ou `from` et `to`) et le découpage (`by`). La page les lit
 * (`metrics/params.ts`) ; le routeur, qui ne charge pas la page Métriques, y reconnaît un ancien lien de la Vue globale vers l'accueil (`routes.tsx`). Ils sont
 * ici, dans un module sans dépendance, pour que ni l'un ni l'autre ne tire le module de l'autre.
 */
export const METRICS_PARAMS = { range: 'range', from: 'from', to: 'to', by: 'by' } as const;
export type ProjectSection = (typeof PROJECT_SECTIONS)[number];

export const paths = {
  /** L'accueil : « À regarder » tous Projets confondus, en tête « Depuis votre dernière visite ». */
  home: () => '/',
  /** La Vue globale : les métriques de tous les Projets et leur liste. */
  global: () => '/overview',
  project: (projectId: string) => `/p/${enc(projectId)}`,
  /** Avec `epicId`, le kanban ne montre que les Enfants de cette Epic (`?epic=`). */
  kanban: (projectId: string, epicId?: string) =>
    `/p/${enc(projectId)}/kanban${epicId ? `?epic=${enc(epicId)}` : ''}`,
  /** Avec `epicId`, la page Epics s'ouvre sur cette Epic (`?epic=`). */
  epics: (projectId: string, epicId?: string) =>
    `/p/${enc(projectId)}/epics${epicId ? `?epic=${enc(epicId)}` : ''}`,
  metrics: (projectId: string) => `/p/${enc(projectId)}/metrics`,
  /** Les Signaux d'un Projet ; sans Projet, ceux de tous les Projets, qui sont l'accueil (`/signals` y redirige). */
  signals: (projectId?: string) => (projectId === undefined ? '/' : `/p/${enc(projectId)}/signals`),
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

/** Ce que l'URL désigne : Projet courant, section, ticket. Vide pour l'accueil et la Vue globale. */
export function parsePath(pathname: string): RouteInfo {
  const [root, projectId, section, issueId] = pathname.split('/').filter(Boolean).map(decode);
  if (root !== 'p' || !projectId) return {};
  if (section === 't' && issueId) return { projectId, section: 'issue', issueId };
  if (section === 'kanban' || section === 'signals' || section === 'epics' || section === 'metrics') {
    return { projectId, section };
  }
  return { projectId };
}
