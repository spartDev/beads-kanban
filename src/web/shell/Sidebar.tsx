import { Eye, Keyboard, LayoutGrid, RefreshCw, Search, TriangleAlert } from 'lucide-react';
import { Link, NavLink } from 'react-router';
import { useProjects } from '../data/hooks';
import type { Project } from '../data/types';
import { useT } from '../i18n';
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
import { LanguageToggle } from './LanguageToggle';
import { ThemeToggle } from './ThemeToggle';

/**
 * Une ligne de la barre latérale. La page courante porte la marque : un aplat jaune sous un texte marine, le « vous êtes ici » de l'interface. Les autres lignes
 * s'éclaircissent au survol (les voiles de la barre latérale sont clairs : `side-hover`).
 */
const rowClass =
  'group/row flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-ui font-semibold text-side-ink-2 transition-colors hover:bg-side-hover hover:text-side-ink aria-[current=page]:bg-mark aria-[current=page]:text-mark-ink';

const rowIconClass = 'shrink-0 text-side-ink-3 group-aria-[current=page]/row:text-mark-ink';

/** Les touches du raccourci n'apparaissent qu'au survol ou au focus de la ligne. */
function RowHint({ keys }: { keys: string }) {
  return (
    <span className="ml-auto hidden group-hover/row:inline-flex group-focus-visible/row:inline-flex">
      <ShortcutKeys keys={keys} />
    </span>
  );
}

/**
 * Barre latérale du desktop : marine dans les deux thèmes (`on-side` : l'anneau de focus et les touches de clavier y prennent leurs couleurs claires, voir styles.css).
 * Sur mobile, TabBar et TopBar prennent le relais.
 */
export function Sidebar() {
  const { openPalette } = usePalette();
  const help = useShortcutsHelp();
  const t = useT();

  return (
    <aside className="on-side hidden w-60 shrink-0 flex-col gap-4 bg-side px-3 pb-3 pt-4 text-side-ink md:flex">
      <div className="flex h-8 items-center gap-2.5 px-1.5">
        <BrandMark size={26} />
        <span className="text-[1rem] font-bold tracking-[-0.01em] text-side-ink">beads-desktop</span>
      </div>

      <button
        type="button"
        onClick={(event) => openPalette('all', event.currentTarget)}
        className="flex h-9 w-full items-center gap-2.5 rounded-lg border border-side-line bg-side-hover px-2.5 text-ui text-side-ink-3 transition-colors hover:text-side-ink-2"
      >
        <Search size={16} strokeWidth={2} aria-hidden="true" />
        <span className="flex-1 text-left">{t.shell.layout.search}</span>
        <ShortcutKeys keys="mod+k" />
      </button>

      <nav aria-label={t.shell.layout.primaryNavigation} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        <div className="flex flex-col gap-1">
          <NavLink to={paths.global()} end className={rowClass}>
            <LayoutGrid size={17} strokeWidth={1.9} aria-hidden="true" className={rowIconClass} />
            {t.shell.overview.title}
            <RowHint keys="g v" />
          </NavLink>
          <NavLink to={paths.signals()} end className={rowClass}>
            <Eye size={17} strokeWidth={1.9} aria-hidden="true" className={rowIconClass} />
            {t.shell.sections.signals}
          </NavLink>
        </div>
        <ProjectList />
      </nav>

      {/* Rien tant que le sélecteur de langue n'est pas activé : la barre reste telle qu'avant. */}
      <LanguageToggle tone="side" className="mx-0.5" />
      <div className="flex items-center justify-between px-0.5">
        <ThemeToggle tone="side" />
        <Tip label={t.shell.layout.shortcuts} shortcut="?" side="top">
          <button
            type="button"
            aria-label={t.shell.layout.showShortcuts}
            onClick={(event) => help.show(event.currentTarget)}
            className="grid size-8 place-items-center rounded-lg text-side-ink-3 transition-colors hover:bg-side-hover hover:text-side-ink"
          >
            <Keyboard size={17} strokeWidth={1.9} aria-hidden="true" />
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
  const t = useT();

  return (
    // Une zone de focus : « Réessayer » ne perd pas le focus quand le squelette remplace l'alerte (voir `keepFocusInZone`), puis le titre le prend à l'arrivée de la liste.
    // Sans contour pour la zone (le focus y est transitoire) ; celui du titre reste à l'intérieur : la navigation rogne ce qui la dépasse.
    <section aria-labelledby="sidebar-projects" data-focus-zone="" className="flex flex-col gap-1 outline-none">
      <h2 id="sidebar-projects" className="flex items-center justify-between rounded-md px-2.5 pb-1 text-xs font-medium text-side-ink-3 focus-visible:-outline-offset-2">
        {t.shell.layout.projects}
        {projects.data ? <span className="tnum">{projects.data.projects.length}</span> : null}
      </h2>

      {/* Un rafraîchissement raté garde la liste affichée : l'alerte n'a la parole que faute de données. */}
      {projects.data ? (
        projects.data.projects.length === 0 ? (
          <p className="px-2.5 text-xs text-side-ink-3">{t.shell.layout.noProjects}</p>
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
        <div key="failed" ref={keepFocusInZone} role="alert" className="mx-1 flex flex-col items-start gap-1.5 rounded-lg border border-side-line bg-side-hover p-2.5 text-xs text-side-ink-2">
          {t.shell.layout.projectsUnavailable}
          <button
            type="button"
            onClick={retry}
            className="inline-flex items-center gap-1.5 font-semibold text-side-ink hover:underline"
          >
            <RefreshCw size={13} aria-hidden="true" />
            {t.shell.common.retry}
          </button>
        </div>
      ) : (
        <div key="loading" role="status" aria-busy="true" aria-label={t.shell.layout.loadingProjects} className="flex flex-col gap-2 px-2.5 pt-1">
          <Skeleton tone="side" className="h-5" />
          <Skeleton tone="side" className="h-5 w-4/5" />
          <Skeleton tone="side" className="h-5 w-3/5" />
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
  const t = useT();
  if (project.status !== 'ok') {
    return (
      <li>
        <div title={project.reason} className="flex items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-side-ink-3">
          <ProjectTile project={project} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-ui font-medium">{project.name}</span>
              {/* Le rouge d'alerte de la page ne se lit pas sur le marine : ici, le pictogramme prend le jaune de la marque. */}
              <TriangleAlert size={14} aria-hidden="true" className="shrink-0 text-mark" />
            </div>
            <p className="line-clamp-2 wrap-anywhere text-micro">
              <span className="sr-only">{t.shell.common.unreadableBecause}</span>
              {project.reason ?? t.shell.common.unreadable}
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
          'group/row flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-ui font-medium transition-colors hover:bg-side-hover hover:text-side-ink',
          active ? 'text-side-ink' : 'text-side-ink-2',
        )}
      >
        <ProjectTile project={project} />
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        {project.prefix !== project.name ? (
          <span className="min-w-0 max-w-[45%] truncate font-mono text-micro font-normal text-side-ink-3">{project.prefix}</span>
        ) : null}
      </Link>

      {active ? (
        <ul className="ml-[1.1rem] mt-1 flex flex-col gap-0.5 border-l border-side-line pl-2">
          {SECTIONS.map(({ id, icon: Icon, shortcut }) => {
            // Le détail d'un ticket s'ouvre depuis le kanban : l'onglet reste celui du kanban.
            const current = section === id || (id === 'kanban' && section === 'issue');
            return (
              <li key={id}>
                <Link
                  to={sectionPath(id, project.id)}
                  aria-current={current ? 'page' : undefined}
                  className={rowClass}
                >
                  <Icon size={16} strokeWidth={1.9} aria-hidden="true" className={rowIconClass} />
                  {t.shell.sections[id]}
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
