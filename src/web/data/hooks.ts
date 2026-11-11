import { QueryClient, queryOptions, useQuery } from '@tanstack/react-query';
import { ApiError, apiGet } from './client';
import { namedProjects } from './projectNames';
import type { IssueChronologyResponse, IssueResponse, IssuesResponse, ProjectsResponse } from './types';

export const queryKeys = {
  projects: ['projects'] as const,
  issues: (projectId: string) => ['projects', projectId, 'issues'] as const,
  /** Rangé sous la liste des tickets du Projet : invalider la liste invalide aussi les fiches. */
  issue: (projectId: string, issueId: string) => ['projects', projectId, 'issues', issueId] as const,
  /** Rangée sous la fiche : la relire avec la liste des tickets du Projet relit aussi la chronologie. */
  chronology: (projectId: string, issueId: string) => ['projects', projectId, 'issues', issueId, 'chronology'] as const,
};

/**
 * Requête dont la page affiche elle-même un 404 (« Ticket introuvable ») : quand un rafraîchissement le reçoit, la page
 * le dit à la place des données périmées, et le bandeau « actualisation impossible » (`RefreshFailedBanner`) s'en abstient.
 */
export const HANDLES_NOT_FOUND = { handlesNotFound: true } as const;

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
    meta: HANDLES_NOT_FOUND,
  });
}

export function chronologyQuery(projectId: string, issueId: string) {
  return queryOptions({
    queryKey: queryKeys.chronology(projectId, issueId),
    queryFn: ({ signal }) =>
      apiGet<IssueChronologyResponse>(
        `/api/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issueId)}/chronology`,
        signal,
      ),
    staleTime: 15_000,
    meta: HANDLES_NOT_FOUND,
  });
}

/**
 * Projets suivis (lisibles ou non) et dossiers ignorés. Le nom d'un Projet dont le dossier n'a pas de nom qu'on voie y est « Sans titre » (`namedProjects`) : aucun écran n'a à le réécrire, et
 * le fil d'Ariane, la barre latérale, l'onglet et le titre de sa page disent la même chose. Le Projet porte alors `unnamed` (bdesk-38k.73) : « Sans titre » est un repli, dont la pastille, les phrases
 * (`projectInSentence`, `projectList`) et la couleur ne tirent rien.
 */
export function useProjects() {
  return useQuery({ ...projectsQuery(), select: namedProjects });
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
 * Chronologie d'un ticket : ses Transitions, ses Blocages, Lead Time, Cycle Time et temps bloqué. Lire l'historique du
 * Projet est plus long que lire la fiche (secondes à froid) : une requête à part. Inactif tant que le Projet ou le ticket manque.
 */
export function useChronology(projectId: string | undefined, issueId: string | undefined) {
  return useQuery({
    ...chronologyQuery(projectId ?? '', issueId ?? ''),
    enabled: Boolean(projectId && issueId),
    select: (data) => data.chronology,
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
