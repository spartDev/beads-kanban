import { ChevronRight, FolderSearch, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { useProjects } from '../data/hooks';
import type { Project } from '../data/types';
import { cx } from '../lib/cx';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { paths } from '../paths';
import { ProjectTile } from '../ui/ProjectTile';
import { ErrorNotice, Notice, Skeleton } from '../ui/states';
import { ComingSoon, Page, SectionTitle } from './Page';

const MODE_LABELS: Record<Project['mode'], string> = {
  embedded: 'Dolt embarqué',
  server: 'Dolt serveur',
};

export function GlobalPage() {
  useDocumentTitle('Vue globale');
  const projects = useProjects();

  return (
    <Page title="Vue globale" description="Tous les Projets suivis, au même endroit.">
      <ComingSoon ticket="bdesk-38k.12">
        Les métriques qui agrègent les Projets arrivent avec « Page Métriques ».
      </ComingSoon>

      <section aria-labelledby="projects-title" className="flex flex-col gap-3">
        <SectionTitle id="projects-title">Projets suivis</SectionTitle>

        {/* Un rafraîchissement raté garde la liste affichée : l'erreur n'a la parole que faute de données. */}
        {projects.data ? (
          projects.data.projects.length === 0 ? (
            <Notice icon={FolderSearch} title="Aucun Projet trouvé">
              <p>
                beads-desktop scanne <code>~/Developer</code> à la recherche de workspaces beads stockés en Dolt.
              </p>
              <p className="mt-1.5">
                Pour scanner d’autres dossiers, listez-les dans la clé <code>roots</code> de{' '}
                <code>~/.config/beads-desktop/config.json</code>, puis relancez la commande.
              </p>
            </Notice>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
              {projects.data.projects.map((project) => (
                <li key={project.id}>
                  <ProjectRow project={project} />
                </li>
              ))}
            </ul>
          )
        ) : projects.isError ? (
          <ErrorNotice error={projects.error} title="Impossible de charger les Projets" onRetry={() => void projects.refetch()} />
        ) : (
          <div role="status" aria-busy="true" aria-label="Chargement des Projets" className="flex flex-col gap-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        )}
      </section>

      {projects.data && projects.data.ignored.length > 0 ? (
        <details className="group rounded-lg border border-line">
          <summary className="flex cursor-default list-none items-center gap-2 px-4 py-3 font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight size={14} aria-hidden="true" className="text-ink-3 transition-transform group-open:rotate-90" />
            {projects.data.ignored.length} {projects.data.ignored.length > 1 ? 'dossiers ignorés' : 'dossier ignoré'}
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {projects.data.ignored.map((folder) => (
              <li key={folder.path} className="flex flex-col gap-0.5 px-4 py-2.5 wrap-anywhere">
                <span className="break-all font-mono text-xs text-ink">{folder.path}</span>
                <span className="text-ink-3">{folder.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Page>
  );
}

function ProjectRow({ project }: { project: Project }) {
  const readable = project.status === 'ok';
  const body = (
    <>
      <ProjectTile project={project} size={28} />
      <span className="min-w-0 flex-1 wrap-anywhere">
        <span className="flex items-baseline gap-2">
          <span className={cx('truncate font-medium', readable ? 'text-ink' : 'text-ink-2')}>{project.name}</span>
          <span className="min-w-0 max-w-[40%] truncate font-mono text-xs text-ink-3">{project.prefix}</span>
        </span>
        {readable ? (
          <span className="block truncate font-mono text-xs text-ink-3">{project.path}</span>
        ) : (
          <span className="mt-0.5 flex items-start gap-1.5 text-ink-2">
            <TriangleAlert size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
            <span>
              <span className="sr-only">Illisible : </span>
              {project.reason ?? 'Illisible'}
            </span>
          </span>
        )}
      </span>
      <span className="hidden shrink-0 text-xs text-ink-3 sm:inline">{MODE_LABELS[project.mode]}</span>
      {readable ? <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-ink-3" /> : null}
    </>
  );

  return readable ? (
    <Link to={paths.kanban(project.id)} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-hover">
      {body}
    </Link>
  ) : (
    <div title={project.path} className="flex items-center gap-3 px-4 py-3">
      {body}
    </div>
  );
}
