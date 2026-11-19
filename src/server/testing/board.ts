import type { ProjectService } from '../projects/service';

/**
 * Un faux service des Projets dont le kanban (`board`, `GET /api/projects/:projectId/issues`) se tire de ses tickets (`issues`), comme celui
 * de `createProjectService`, sans aucun statut déclaré. Un test qui remplace `issues` (une lecture qui attend, échoue ou compte ses appels) agit
 * ainsi sur la route du kanban comme avant que le kanban ne rende aussi les statuts déclarés (bdesk-pz0.2) ; un `board` donné l'emporte.
 */
export function withBoard(service: Omit<ProjectService, 'board'> & Partial<Pick<ProjectService, 'board'>>): ProjectService {
  return {
    board: async (projectId, options) => ({ issues: await service.issues(projectId, options), declaredStatuses: { handoff: [], others: [] } }),
    ...service,
  };
}
