import { ChartNoAxesColumn, Columns3, Eye, Layers, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useLocation } from 'react-router';
import { useProjects } from '../data/hooks';
import { isReadable } from '../data/helpers';
import type { Project } from '../data/types';
import { readStorage, writeStorage } from '../lib/storage';
import { parsePath, paths, sectionPath, type ProjectSection, type RouteInfo } from '../paths';

/** Un onglet d'un Projet. Son nom est dans le catalogue : `t.shell.sections[id]`. */
export interface SectionDefinition {
  id: ProjectSection;
  icon: LucideIcon;
  /** Séquence « g puis… » qui y mène. */
  shortcut: string;
}

/** Les onglets d'un Projet, dans l'ordre d'affichage. */
export const SECTIONS: readonly SectionDefinition[] = [
  { id: 'kanban', icon: Columns3, shortcut: 'g k' },
  { id: 'signals', icon: Eye, shortcut: 'g a' },
  { id: 'epics', icon: Layers, shortcut: 'g e' },
  { id: 'metrics', icon: ChartNoAxesColumn, shortcut: 'g m' },
];

/** Séquence « g puis… » de l'accueil, « À regarder » tous Projets confondus (« h » : home ; « a » mène à celui du Projet). */
export const HOME_SHORTCUT = 'g h';
/** Séquence « g puis… » de la Vue globale. */
export const OVERVIEW_SHORTCUT = 'g v';

/**
 * La page de tous les Projets que montre `pathname` : l'accueil (`home`) ou la Vue globale (`overview`) ; `undefined` ailleurs. Ni une barre oblique finale
 * (`/overview/`) ni la casse (`/Overview`) ne changent la page, comme pour le routeur. Le premier onglet du mobile les réunit (voir `TabBar`, `GlobalTabs`).
 */
export function allProjectsPage(pathname: string): 'home' | 'overview' | undefined {
  const path = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  if (path === paths.home()) return 'home';
  if (path === paths.global()) return 'overview';
  return undefined;
}

/** Ce que désigne l'URL courante : Projet, section, ticket. */
export function useRouteInfo(): RouteInfo {
  const { pathname } = useLocation();
  return useMemo(() => parsePath(pathname), [pathname]);
}

export const LAST_PROJECT_KEY = 'throughline:last-project';

/** Retient le dernier Projet visité, pour que les onglets restent utilisables depuis l'accueil et la Vue globale. */
export const rememberProject = (projectId: string): void => writeStorage(LAST_PROJECT_KEY, projectId);

/**
 * Projet visé par les onglets Kanban, Epics et Métriques : celui de l'URL, sinon le dernier visité,
 * sinon le premier Projet lisible. Indéfini tant qu'aucun Projet n'est lisible.
 */
export function useTabsProject(): Project | undefined {
  const { projectId } = useRouteInfo();
  const { data } = useProjects();
  return useMemo(() => {
    const readable = data?.projects.filter(isReadable) ?? [];
    const last = readStorage(LAST_PROJECT_KEY);
    return (
      readable.find((project) => project.id === projectId) ??
      readable.find((project) => project.id === last) ??
      readable[0]
    );
  }, [data, projectId]);
}

/** Chemin de l'onglet affiché pour un Projet ; la section courante est conservée quand on change de Projet. */
export function sectionHref(section: ProjectSection | 'issue' | undefined, projectId: string): string {
  return sectionPath(section && section !== 'issue' ? section : 'kanban', projectId);
}
