/**
 * Contrat de l'API HTTP (`src/server`), partagé avec l'interface.
 * Types seulement : aucun code d'exécution, importable des deux côtés.
 */

export type ProjectMode = 'embedded' | 'server';
export type ProjectStatus = 'ok' | 'unreadable';

export interface Project {
  /** Identifiant d'URL : slug du nom de dossier, unique entre Projets. */
  id: string;
  /** Nom du dossier du Projet. */
  name: string;
  /** Chemin absolu du dossier contenant `.beads/`. */
  path: string;
  /** Préfixe des tickets du Projet (`bdesk` pour `bdesk-38k.6`). */
  prefix: string;
  mode: ProjectMode;
  status: ProjectStatus;
  /** Présent quand le Projet est illisible. */
  reason?: string;
}

/** Dossier contenant `.beads/` mais qui n'est pas un Projet suivi (workspace non-Dolt, par exemple). */
export interface IgnoredFolder {
  path: string;
  reason: string;
}

/** `GET /api/projects` */
export interface ProjectsResponse {
  projects: Project[];
  ignored: IgnoredFolder[];
}

export interface Issue {
  id: string;
  title: string;
  /** bug, feature, task, chore, epic, decision, spike… (beads accepte des types personnalisés). */
  type: string;
  status: string;
  /** 0 (critique) à 4 (minimale). */
  priority: number;
  assignee: string | null;
  /** Ticket parent (lien parent-enfant), s'il existe. */
  parentId: string | null;
  /** Dates ISO 8601, en UTC. */
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  /** Cibles des dépendances `blocks` non fermées ; toujours vide pour un ticket fermé. */
  blockedBy: string[];
}

/** `GET /api/projects/:projectId/issues` */
export interface IssuesResponse {
  issues: Issue[];
}

export interface IssueDependency {
  to: string;
  type: string;
}

export interface IssueDependent {
  from: string;
  type: string;
}

export interface IssueComment {
  author: string;
  text: string;
  createdAt: string;
}

export interface IssueDetail extends Issue {
  /** Champs texte : chaîne vide quand ils ne sont pas renseignés. */
  description: string;
  design: string;
  acceptanceCriteria: string;
  notes: string;
  closeReason: string;
  labels: string[];
  /** Dépendances sortantes (ce ticket dépend de `to`), tous types confondus, `parent-child` compris. */
  dependencies: IssueDependency[];
  /** Dépendances entrantes (`from` dépend de ce ticket). */
  dependents: IssueDependent[];
  comments: IssueComment[];
}

/** `GET /api/projects/:projectId/issues/:issueId` */
export interface IssueResponse {
  issue: IssueDetail;
}

/** Corps des réponses d'erreur (même forme que celles de Fastify). */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  /** Présent sur les 503 : pourquoi le Projet est illisible. */
  reason?: string;
}
