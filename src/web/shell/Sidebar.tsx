import { Keyboard, LayoutGrid, RefreshCw, Search, TriangleAlert } from 'lucide-react';
import { Link, NavLink } from 'react-router';
import { useProjects } from '../data/hooks';
import type { Project } from '../data/types';
import { cx } from '../lib/cx';
import { useRetryFocus } from '../lib/useRetryFocus';
import { keepFocusInZone } from '../lib/zoneFocus';
import { paths, sectionPath } from '../paths';
import { BrandMark } from '../ui/Brand';
import { ShortcutKeys } from '../ui/Kbd';
import { ProjectTile } from '../ui/ProjectTile';
import { Skeleton } from '../ui/states';
import { Tip } from '../ui/Tip';
import { SECTIONS, useRouteInfo } from './navigation';
import { usePalette, useShortcutsHelp } from './OverlayProvider';
import { ThemeToggle } from './ThemeToggle';

const rowClass =
  'group/row flex h-7 w-full items-center gap-2 rounded-md px-2 text-ui font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink aria-[current=page]:bg-press aria-[current=page]:text-ink';

/** Les touches du raccourci n'apparaissent qu'au survol ou au focus de la ligne. */
function RowHint({ keys }: { keys: string }) {
  return (
    <span className="ml-auto hidden group-hover/row:inline-flex group-focus-visible/row:inline-flex">
      <ShortcutKeys keys={keys} />
    </span>
  );
}

/** Barre latérale du desktop. Sur mobile, TabBar et TopBar prennent le relais. */
export function Sidebar() {
  const { openPalette } = usePalette();
  const help = useShortcutsHelp();

  return (
    <aside className="hidden w-60 shrink-0 flex-col gap-3 px-2 pb-2 pt-2.5 md:flex">
      <div className="flex h-8 items-center gap-2 px-2">
        <BrandMark />
        <span className="text-ui font-semibold tracking-[-0.01em] text-ink">beads-desktop</span>
      </div>

      <button
        type="button"
        onClick={(event) => openPalette('all', event.currentTarget)}
        className="flex h-8 w-full items-center gap-2 rounded-lg border border-line bg-well px-2.5 text-ui text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2"
      >
        <Search size={14} strokeWidth={2} aria-hidden="true" />
        <span className="flex-1 text-left">Rechercher</span>
        <ShortcutKeys keys="mod+k" />
      </button>

      <nav aria-label="Navigation principale" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <NavLink to={paths.global()} end className={rowClass}>
          <LayoutGrid size={16} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-ink-3 group-aria-[current=page]/row:text-accent" />
          Vue globale
          <RowHint keys="g v" />
        </NavLink>
        <ProjectList />
      </nav>

      <div className="flex items-center justify-between px-0.5">
        <ThemeToggle />
        <Tip label="Raccourcis clavier" shortcut="?" side="top">
          <button
            type="button"
            aria-label="Afficher les raccourcis clavier"
            onClick={(event) => help.show(event.currentTarget)}
            className="grid size-7 place-items-center rounded-md text-ink-3 transition-colors hover:bg-hover hover:text-ink"
          >
            <Keyboard size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </Tip>
      </div>
    </aside>
  );
}

function ProjectList() {
  const projects = useProjects();
  const retry = useRetryFocus(projects);
  const { projectId, section } = useRouteInfo();

  return (
    // Une zone de focus : « Réessayer » ne perd pas le focus quand le squelette remplace l'alerte (voir `keepFocusInZone`), puis le titre le prend à l'arrivée de la liste.
    // Sans contour pour la zone (le focus y est transitoire) ; celui du titre reste à l'intérieur : la navigation rogne ce qui la dépasse.
    <section aria-labelledby="sidebar-projects" data-focus-zone="" className="flex flex-col gap-0.5 outline-none">
      <h2 id="sidebar-projects" className="flex items-center justify-between rounded-md px-2 pb-1 text-xs font-medium text-ink-3 focus-visible:-outline-offset-2">
        Projets
        {projects.data ? <span className="tnum">{projects.data.projects.length}</span> : null}
      </h2>

      {/* Un rafraîchissement raté garde la liste affichée : l'alerte n'a la parole que faute de données. */}
      {projects.data ? (
        projects.data.projects.length === 0 ? (
          <p className="px-2 text-xs text-ink-3">Aucun Projet trouvé.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {projects.data.projects.map((project) => (
              <ProjectItem
                key={project.id}
                project={project}
                active={project.id === projectId}
                section={project.id === projectId ? section : undefined}
              />
            ))}
          </ul>
        )
      ) : projects.isError ? (
        // `key` : l'alerte et le squelette sont deux `div` au même endroit, que React mettrait à jour sans retirer l'alerte ; il faut qu'il la retire, avec son bouton, pour que `keepFocusInZone` s'exécute quand le focus y est encore.
        <div key="failed" ref={keepFocusInZone} role="alert" className="mx-1 flex flex-col items-start gap-1.5 rounded-md border border-danger/40 bg-danger-soft p-2.5 text-xs text-ink-2">
          Projets indisponibles : le serveur ne répond pas.
          <button
            type="button"
            onClick={retry}
            className="inline-flex items-center gap-1.5 font-medium text-ink hover:underline"
          >
            <RefreshCw size={12} aria-hidden="true" />
            Réessayer
          </button>
        </div>
      ) : (
        <div key="loading" role="status" aria-busy="true" aria-label="Chargement des Projets" className="flex flex-col gap-1.5 px-2 pt-1">
          <Skeleton className="h-5" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-5 w-3/5" />
        </div>
      )}
    </section>
  );
}

function ProjectItem({
  project,
  active,
  section,
}: {
  project: Project;
  active: boolean;
  section: ReturnType<typeof useRouteInfo>['section'];
}) {
  if (project.status !== 'ok') {
    return (
      <li>
        <div title={project.reason} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-ink-3">
          <ProjectTile project={project} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-ui font-medium">{project.name}</span>
              <TriangleAlert size={13} aria-hidden="true" className="shrink-0 text-danger" />
            </div>
            <p className="line-clamp-2 wrap-anywhere text-micro">
              <span className="sr-only">Illisible : </span>
              {project.reason ?? 'Illisible'}
            </p>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li>
      <Link
        to={paths.kanban(project.id)}
        aria-current={active ? 'true' : undefined}
        className={cx(
          'group/row flex h-7 items-center gap-2 rounded-md px-2 text-ui font-medium transition-colors hover:bg-hover hover:text-ink',
          active ? 'text-ink' : 'text-ink-2',
        )}
      >
        <ProjectTile project={project} />
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        {project.prefix !== project.name ? (
          <span className="min-w-0 max-w-[45%] truncate font-mono text-micro font-normal text-ink-3">{project.prefix}</span>
        ) : null}
      </Link>

      {active ? (
        <ul className="ml-4 mt-0.5 flex flex-col gap-px border-l border-line pl-2">
          {SECTIONS.map(({ id, label, icon: Icon, shortcut }) => {
            // Le détail d'un ticket s'ouvre depuis le kanban : l'onglet reste celui du kanban.
            const current = section === id || (id === 'kanban' && section === 'issue');
            return (
              <li key={id}>
                <Link
                  to={sectionPath(id, project.id)}
                  aria-current={current ? 'page' : undefined}
                  className={rowClass}
                >
                  <Icon size={15} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-ink-3 group-aria-[current=page]/row:text-accent" />
                  {label}
                  <RowHint keys={shortcut} />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}
