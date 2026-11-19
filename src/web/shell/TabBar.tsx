import { House, type LucideIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { useT } from '../i18n';
import { cx } from '../lib/cx';
import { paths, sectionPath } from '../paths';
import { allProjectsPage, SECTIONS, useRouteInfo, useTabsProject } from './navigation';

/**
 * Barre d'onglets du mobile : la barre latérale repliée, en cinq cases. L'accueil, puis les onglets du Projet courant (ou, depuis une page de tous les
 * Projets, du dernier Projet visité). La première case réunit les deux pages de tous les Projets, l'accueil (« À regarder ») et la Vue globale : elle est
 * l'onglet courant sur l'une comme sur l'autre, et chacune porte en tête les liens qui mènent de l'une à l'autre (`GlobalTabs`). Une sixième case ne
 * tiendrait pas à 375 px, et deux cases « À regarder » (celle de tous les Projets, celle du Projet) se confondraient. Sur l'accueil, elle est la page courante
 * (`aria-current="page"`) ; sur la Vue globale, où elle ne mène pas, elle est seulement l'onglet courant (`aria-current="true"`).
 */
export function TabBar() {
  const { pathname } = useLocation();
  const { projectId, section } = useRouteInfo();
  const project = useTabsProject();
  const t = useT();
  const allProjects = allProjectsPage(pathname);

  return (
    <nav
      aria-label={t.shell.layout.tabs}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <ul className="grid grid-cols-5">
        <li>
          <Tab
            to={paths.home()}
            icon={House}
            label={t.shell.layout.home}
            current={allProjects === 'home' ? 'page' : allProjects === 'overview' ? 'true' : false}
          />
        </li>
        {SECTIONS.map(({ id, icon }) => (
          <li key={id}>
            <Tab
              to={project ? sectionPath(id, project.id) : undefined}
              icon={icon}
              label={t.shell.sections[id]}
              current={project?.id === projectId && (section === id || (id === 'kanban' && section === 'issue')) ? 'page' : false}
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
  /** La valeur d'`aria-current` : `page` quand l'onglet mène à la page affichée, `true` quand il en est seulement l'onglet ; `false` sinon. */
  current: 'page' | 'true' | false;
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
    <Link to={to} aria-current={current || undefined} className={className}>
      {content}
    </Link>
  ) : (
    <span aria-disabled="true" className={cx(className, 'opacity-40')}>
      {content}
    </span>
  );
}
