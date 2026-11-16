import { ChevronRight, FolderSearch, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { useProjects } from '../data/hooks';
import type { Project } from '../data/types';
import { useFormat, useT } from '../i18n';
import { cx } from '../lib/cx';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useRetryFocus } from '../lib/useRetryFocus';
import { LazyMetricsView } from '../metrics/LazyMetricsView';
import { paths } from '../paths';
import { ProjectTile } from '../ui/ProjectTile';
import { ErrorNotice, Notice, Skeleton } from '../ui/states';
import { Page, SectionTitle } from './Page';

export function GlobalPage() {
  const t = useT();
  const format = useFormat();
  const text = t.shell.overview;
  useDocumentTitle(text.title);
  const projects = useProjects();
  const retry = useRetryFocus(projects);
  const ignored = projects.data?.ignored.length ?? 0;

  return (
    <Page title={text.title} description={text.description} wide>
      <LazyMetricsView scope={{ kind: 'global' }} />

      {/* Une zone de focus : « Réessayer » ne perd pas le focus quand le squelette remplace l'avis d'erreur (voir `ErrorNotice`). Sans contour : le focus y est transitoire. */}
      <section aria-labelledby="projects-title" data-focus-zone="" className="flex flex-col gap-3 outline-none">
        <SectionTitle id="projects-title">{text.projects}</SectionTitle>

        {/* Un rafraîchissement raté garde la liste affichée : l'erreur n'a la parole que faute de données. */}
        {projects.data ? (
          projects.data.projects.length === 0 ? (
            <Notice icon={FolderSearch} title={text.none}>
              <p>
                {text.scanBefore}
                <code>~/Developer</code>
                {text.scanAfter}
              </p>
              <p className="mt-1.5">
                {text.configBefore}
                <code>roots</code>
                {text.configBetween}
                <code>~/.config/beads-desktop/config.json</code>
                {text.configAfter}
              </p>
            </Notice>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
              {projects.data.projects.map((project) => (
                <li key={project.id}>
                  <ProjectRow project={project} />
                </li>
              ))}
            </ul>
          )
        ) : projects.isError ? (
          <ErrorNotice error={projects.error} title={text.loadFailed} onRetry={retry} />
        ) : (
          <div role="status" aria-busy="true" aria-label={text.loading} className="flex flex-col gap-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        )}
      </section>

      {projects.data && ignored > 0 ? (
        <details className="group rounded-xl border border-line bg-panel">
          <summary className="flex cursor-default list-none items-center gap-2 px-4 py-3 font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight size={14} aria-hidden="true" className="text-ink-3 transition-transform group-open:rotate-90" />
            {text.ignored(format.formatCount(ignored), ignored)}
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
  const t = useT();
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
              <span className="sr-only">{t.shell.common.unreadableBecause}</span>
              {project.reason ?? t.shell.common.unreadable}
            </span>
          </span>
        )}
      </span>
      <span className="hidden shrink-0 text-xs text-ink-3 sm:inline">{t.shell.overview.modes[project.mode]}</span>
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
