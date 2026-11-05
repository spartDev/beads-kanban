import { FolderSearch, TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import { Link, Outlet, useOutletContext, useParams } from 'react-router';
import { useProjects } from '../data/hooks';
import type { Project } from '../data/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useRetryFocus } from '../lib/useRetryFocus';
import { paths } from '../paths';
import { rememberProject } from '../shell/navigation';
import { ErrorNotice, Notice, Skeleton } from '../ui/states';
import { Page } from './Page';

interface ProjectOutletContext {
  project: Project;
}

/** Projet de la route `/p/:projectId`. À n'appeler que sous <ProjectGate>, qui garantit un Projet lisible. */
export function useProject(): Project {
  return useOutletContext<ProjectOutletContext>().project;
}

/**
 * Garde des routes `/p/:projectId/*` : n'ouvre la page que pour un Projet connu et lisible,
 * et explique sinon pourquoi (chargement, serveur muet, Projet inconnu, Projet illisible).
 */
export function ProjectGate() {
  const { projectId = '' } = useParams();
  const projects = useProjects();
  const retry = useRetryFocus(projects);
  const project = projects.data?.projects.find((candidate) => candidate.id === projectId);
  // Seuls les états d'erreur titrent la page : sur un Projet lisible, c'est la page enfant qui le fait.
  useDocumentTitle(project?.status === 'ok' ? undefined : (project?.name ?? projectId));

  const readableId = project?.status === 'ok' ? project.id : undefined;
  useEffect(() => {
    if (readableId) rememberProject(readableId);
  }, [readableId]);

  // Sans liste des Projets : chargement, ou échec. Avec elle, un rafraîchissement raté garde la page affichée
  // (TanStack Query conserve `data` en passant à « error ») : le bandeau du shell le signale.
  if (!projects.data) {
    if (projects.isError) {
      return (
        <Page title="Projets indisponibles">
          <ErrorNotice error={projects.error} onRetry={retry} />
        </Page>
      );
    }
    return (
      <Page title={<Skeleton className="h-7 w-40" />}>
        <div role="status" aria-busy="true" aria-label="Chargement du Projet" className="flex flex-col gap-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-20 w-full" />
        </div>
      </Page>
    );
  }

  if (!project) {
    return (
      <Page title="Projet introuvable">
        <Notice
          icon={FolderSearch}
          title={`Aucun Projet n’a l’identifiant « ${projectId} »`}
          action={
            <Link to={paths.global()} className="font-medium text-accent hover:underline">
              Voir les Projets suivis
            </Link>
          }
        >
          Il a peut-être été masqué dans la configuration, ou son dossier a été déplacé.
        </Notice>
      </Page>
    );
  }

  if (project.status !== 'ok') {
    return (
      <Page title={project.name}>
        <Notice icon={TriangleAlert} tone="danger" title="Ce Projet est illisible">
          <p>{project.reason ?? 'Le serveur n’a pas pu lire sa base.'}</p>
          <p className="mt-1.5 break-all font-mono text-xs text-ink-3">{project.path}</p>
        </Notice>
      </Page>
    );
  }

  return <Outlet context={{ project } satisfies ProjectOutletContext} />;
}
