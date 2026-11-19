import { Eye, LayoutGrid, type LucideIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { useT } from '../i18n';
import { cx } from '../lib/cx';
import { paths } from '../paths';
import { allProjectsPage } from './navigation';

/**
 * Mobile : en tête des pages de tous les Projets, les liens de l'une à l'autre, l'accueil (« À regarder ») et la Vue globale. La barre d'onglets n'a qu'une
 * case pour les deux (`TabBar`) : sans eux, la Vue globale ne se joindrait que par la palette. Rien ailleurs, ni sur desktop, où la barre latérale les liste.
 */
export function GlobalTabs() {
  const { pathname } = useLocation();
  const t = useT();
  const page = allProjectsPage(pathname);
  if (!page) return null;

  return (
    <nav aria-label={t.shell.layout.allProjectsPages} className="px-4 pt-4 md:hidden">
      <ul className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-well p-1">
        <li>
          <GlobalTab to={paths.home()} icon={Eye} label={t.shell.sections.signals} current={page === 'home'} />
        </li>
        <li>
          <GlobalTab to={paths.global()} icon={LayoutGrid} label={t.shell.overview.title} current={page === 'overview'} />
        </li>
      </ul>
    </nav>
  );
}

function GlobalTab({ to, icon: Icon, label, current }: { to: string; icon: LucideIcon; label: string; current: boolean }) {
  return (
    <Link
      to={to}
      aria-current={current ? 'page' : undefined}
      className={cx(
        'flex min-h-10 items-center justify-center gap-2 rounded-md px-2 text-ui font-semibold transition-colors',
        current ? 'bg-panel text-ink shadow-sm' : 'text-ink-2 hover:text-ink',
      )}
    >
      <Icon size={16} strokeWidth={1.9} aria-hidden="true" className={current ? 'text-accent' : 'text-ink-3'} />
      <span className="min-w-0 truncate">{label}</span>
    </Link>
  );
}
