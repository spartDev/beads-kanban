import type { IgnoredFolder, Project as ApiProject } from '../../shared/api';

/**
 * Contrat de l'API du serveur beads-desktop. Défini une seule fois, dans `src/shared/api.ts`
 * (types seulement, partagés avec `src/server`) : un écart entre le serveur et l'interface
 * fait échouer `pnpm typecheck`. Seul `Project` est celui que l'interface lit, non celui que l'API envoie : voir plus bas.
 */
export type {
  ApiSignal,
  IgnoredFolder,
  Issue,
  IssueAbandon,
  IssueAbandonCause,
  IssueBlockage,
  IssueBlockagePhase,
  IssueBlockagePhaseKind,
  IssueChronology,
  IssueChronologyResponse,
  IssueComment,
  IssueDependency,
  IssueDependent,
  IssueDetail,
  IssueEpic,
  IssueOutcome,
  IssueRef,
  IssueResponse,
  IssuesResponse,
  IssueTransition,
  ProjectMode,
  ProjectStatus,
  ProjectsResponse,
  SignalTicket,
  SignalsResponse,
} from '../../shared/api';

/**
 * Un Projet (ou un Projet de la réponse des métriques) tel que l'interface le lit : son `name` est celui qu'elle écrit (`data/projectNames.ts`), qui n'est celui du dossier que quand on le voit.
 * Quand le dossier n'a pas de nom qu'on voie, `name` est le repli « Sans titre » et `unnamed` le dit : ce n'est pas un nom, et la pastille, les phrases et la couleur du Projet n'en tirent rien.
 * Un dossier qui s'appelle vraiment « Sans titre » a un nom qui se voit : il n'est pas marqué. Ajouté par l'interface ; l'API ne l'envoie jamais.
 */
export type Written<T extends { name: string }> = T & { unnamed?: true };

/** Un Projet suivi, tel que l'interface le lit (`useProjects`). */
export type Project = Written<ApiProject>;

/** `GET /api/projects` tel que l'interface le lit : ses Projets sous leur nom écrit. */
export interface NamedProjectsResponse {
  projects: Project[];
  ignored: IgnoredFolder[];
}
