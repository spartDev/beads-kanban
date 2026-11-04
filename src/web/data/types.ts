/**
 * Contrat de l'API du serveur beads-desktop. Défini une seule fois, dans `src/shared/api.ts`
 * (types seulement, partagés avec `src/server`) : un écart entre le serveur et l'interface
 * fait échouer `pnpm typecheck`.
 */
export type {
  IgnoredFolder,
  Issue,
  IssueBlockage,
  IssueBlockagePhase,
  IssueBlockagePhaseKind,
  IssueChronology,
  IssueChronologyResponse,
  IssueComment,
  IssueDependency,
  IssueDependent,
  IssueDetail,
  IssueOutcome,
  IssueRef,
  IssueResponse,
  IssuesResponse,
  IssueTransition,
  Project,
  ProjectMode,
  ProjectStatus,
  ProjectsResponse,
} from '../../shared/api';
