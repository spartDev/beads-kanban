import { ChevronDown, ChevronRight, LayoutGrid, Search } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { useProjects } from '../data/hooks';
import { cx } from '../lib/cx';
import { paths, sectionPath } from '../paths';
import { BrandMark } from '../ui/Brand';
import { ProjectTile } from '../ui/ProjectTile';
import { Tip } from '../ui/Tip';
import { sectionLabel, useRouteInfo } from './navigation';
import { usePalette } from './OverlayProvider';
import { ThemeToggle } from './ThemeToggle';

/** Bandeau du haut : fil d'Ariane sur desktop ; sélecteur de Projet, recherche et thème sur mobile. */
export function TopBar() {
  const { openPalette } = usePalette();

  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel/85 px-3 backdrop-blur-md md:h-11 md:rounded-t-xl md:px-4">
      <MobileSwitcher />
      <Breadcrumb />
      <div className="ml-auto flex items-center gap-2 md:hidden">
        <Tip label="Rechercher" side="bottom">
          <button
            type="button"
            aria-label="Rechercher"
            onClick={(event) => openPalette('all', event.currentTarget)}
            className="grid size-8 place-items-center rounded-lg border border-line bg-well text-ink-2 transition-colors hover:text-ink"
          >
            <Search size={15} strokeWidth={2} aria-hidden="true" />
          </button>
        </Tip>
        <ThemeToggle />
      </div>
    </header>
  );
}

function useCurrentProject() {
  const { projectId } = useRouteInfo();
  const { data } = useProjects();
  return {
    projectId,
    project: projectId ? data?.projects.find((project) => project.id === projectId) : undefined,
  };
}

/** Mobile : où l'on est, et un bouton pour changer de Projet (ouvre la palette sur la liste des Projets). */
function MobileSwitcher() {
  const { openPalette } = usePalette();
  const { pathname } = useLocation();
  const { projectId, project } = useCurrentProject();
  const label = projectId ? (project?.name ?? projectId) : pathname === '/' ? 'Vue globale' : 'beads-desktop';

  return (
    <button
      type="button"
      onClick={(event) => openPalette('projects', event.currentTarget)}
      className="-ml-1.5 flex h-8 min-w-0 items-center gap-2 rounded-lg px-1.5 text-ui font-semibold text-ink transition-colors hover:bg-hover md:hidden"
    >
      {project ? <ProjectTile project={project} size={20} /> : <BrandMark size={20} />}
      <span className="truncate">{label}</span>
      {/* Le nom accessible commence par le texte visible (WCAG 2.5.3) ; un aria-label qui le remplacerait ferait échouer axe. */}
      <span className="sr-only">, changer de Projet</span>
      <ChevronDown size={14} strokeWidth={2} aria-hidden="true" className="shrink-0 text-ink-3" />
    </button>
  );
}

/** Desktop : Projet › section › ticket. */
function Breadcrumb() {
  const { pathname } = useLocation();
  const { section, issueId } = useRouteInfo();
  const { projectId, project } = useCurrentProject();
  if (!projectId && pathname !== '/') return null;

  return (
    <nav aria-label="Fil d'Ariane" className="hidden min-w-0 items-center gap-1.5 text-ui md:flex">
      {projectId ? (
        <>
          <Link
            to={paths.kanban(projectId)}
            className="flex min-w-0 items-center gap-2 rounded-md font-medium text-ink-2 transition-colors hover:text-ink"
          >
            {project ? <ProjectTile project={project} size={16} /> : null}
            <span className="truncate">{project?.name ?? projectId}</span>
          </Link>
          {section ? (
            <>
              <Separator />
              {section === 'issue' ? (
                <>
                  <Link to={paths.kanban(projectId)} className="font-medium text-ink-2 transition-colors hover:text-ink">
                    Kanban
                  </Link>
                  <Separator />
                  <span aria-current="page" className="truncate font-mono text-xs font-medium text-ink">
                    {issueId}
                  </span>
                </>
              ) : (
                <Link
                  to={sectionPath(section, projectId)}
                  aria-current="page"
                  className="font-semibold text-ink"
                >
                  {sectionLabel(section)}
                </Link>
              )}
            </>
          ) : null}
        </>
      ) : (
        <span className="inline-flex items-center gap-2 font-semibold text-ink">
          <LayoutGrid size={15} strokeWidth={1.8} aria-hidden="true" className="text-ink-3" />
          Vue globale
        </span>
      )}
    </nav>
  );
}

function Separator({ className }: { className?: string }) {
  return <ChevronRight size={13} strokeWidth={2} aria-hidden="true" className={cx('shrink-0 text-ink-3', className)} />;
}
