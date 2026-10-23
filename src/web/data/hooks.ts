import { QueryClient, queryOptions, useQuery } from '@tanstack/react-query';
import { ApiError, apiGet } from './client';
import type { IssueResponse, IssuesResponse, ProjectsResponse } from './types';

export const queryKeys = {
  projects: ['projects'] as const,
  issues: (projectId: string) => ['projects', projectId, 'issues'] as const,
  /** Rangé sous la liste des tickets du Projet : invalider la liste invalide aussi les fiches. */
  issue: (projectId: string, issueId: string) => ['projects', projectId, 'issues', issueId] as const,
};

export function projectsQuery() {
  return queryOptions({
    queryKey: queryKeys.projects,
    queryFn: ({ signal }) => apiGet<ProjectsResponse>('/api/projects', signal),
    staleTime: 30_000,
  });
}

export function issuesQuery(projectId: string) {
  return queryOptions({
    queryKey: queryKeys.issues(projectId),
    queryFn: ({ signal }) =>
      apiGet<IssuesResponse>(`/api/projects/${encodeURIComponent(projectId)}/issues`, signal),
    staleTime: 15_000,
  });
}

export function issueQuery(projectId: string, issueId: string) {
  return queryOptions({
    queryKey: queryKeys.issue(projectId, issueId),
    queryFn: ({ signal }) =>
      apiGet<IssueResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issueId)}`,
        signal,
      ),
    staleTime: 15_000,
  });
}

/** Projets suivis (lisibles ou non) et dossiers ignorés. */
export function useProjects() {
  return useQuery(projectsQuery());
}

/** Tickets d'un Projet. Inactif tant que `projectId` est absent. */
export function useIssues(projectId: string | undefined) {
  return useQuery({
    ...issuesQuery(projectId ?? ''),
    enabled: Boolean(projectId),
    select: (data) => data.issues,
  });
}

/** Détail d'un ticket (champs texte, étiquettes, dépendances, commentaires). Inactif tant que le Projet ou le ticket manque. */
export function useIssue(projectId: string | undefined, issueId: string | undefined) {
  return useQuery({
    ...issueQuery(projectId ?? '', issueId ?? ''),
    enabled: Boolean(projectId && issueId),
    select: (data) => data.issue,
  });
}

/**
 * Une seule nouvelle tentative, et seulement quand elle peut changer la réponse : une erreur réseau ou
 * serveur (500, 502…) passe parfois d'une seconde à l'autre ; une 4xx (la requête est à revoir) ou un 503
 * (Projet illisible, raison à l'appui) recevrait la même réponse, et ferait seulement attendre l'écran d'erreur.
 */
export function shouldRetry(failureCount: number, error: Error): boolean {
  if (failureCount >= 1) return false;
  if (error instanceof ApiError) return error.status !== 503 && !(error.status >= 400 && error.status < 500);
  return true;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: shouldRetry, refetchOnWindowFocus: true } },
  });
}
