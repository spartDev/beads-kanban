import { LayoutGrid, type LucideIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { cx } from '../lib/cx';
import { paths, sectionPath } from '../paths';
import { SECTIONS, useRouteInfo, useTabsProject } from './navigation';

/**
 * Barre d'onglets du mobile : la barre latérale repliée. Vue globale, puis les trois onglets du
 * Projet courant (ou, depuis la Vue globale, du dernier Projet visité).
 */
export function TabBar() {
  const { pathname } = useLocation();
  const { projectId, section } = useRouteInfo();
  const project = useTabsProject();

  return (
    <nav
      aria-label="Onglets"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <ul className="grid grid-cols-4">
        <li>
          <Tab to={paths.global()} icon={LayoutGrid} label="Vue globale" current={pathname === '/'} />
        </li>
        {SECTIONS.map(({ id, label, icon }) => (
          <li key={id}>
            <Tab
              to={project ? sectionPath(id, project.id) : undefined}
              icon={icon}
              label={label}
              current={project?.id === projectId && (section === id || (id === 'kanban' && section === 'issue'))}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Tab({
  to,
  icon: Icon,
  label,
  current,
}: {
  /** Absent : l'onglet est inactif (aucun Projet lisible). */
  to?: string;
  icon: LucideIcon;
  label: string;
  current: boolean;
}) {
  const className = cx(
    'group relative flex h-14 flex-col items-center justify-center gap-1 text-micro font-medium',
    current ? 'text-ink' : 'text-ink-3',
  );
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cx('absolute top-0 h-0.5 w-7 rounded-full bg-accent', current ? 'opacity-100' : 'opacity-0')}
      />
      <Icon size={20} strokeWidth={1.7} aria-hidden="true" className={current ? 'text-accent' : undefined} />
      {label}
    </>
  );
  return to ? (
    <Link to={to} aria-current={current ? 'page' : undefined} className={className}>
      {content}
    </Link>
  ) : (
    <span aria-disabled="true" className={cx(className, 'opacity-40')}>
      {content}
    </span>
  );
}
