import { ChartNoAxesColumn, Columns3, Eye, Layers, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useLocation } from 'react-router';
import { useProjects } from '../data/hooks';
import { isReadable } from '../data/helpers';
import type { Project } from '../data/types';
import { readStorage, writeStorage } from '../lib/storage';
import { parsePath, sectionPath, type ProjectSection, type RouteInfo } from '../paths';

export interface SectionDefinition {
  id: ProjectSection;
  label: string;
  icon: LucideIcon;
  /** Séquence « g puis… » qui y mène. */
  shortcut: string;
}

/** Les onglets d'un Projet, dans l'ordre d'affichage. */
export const SECTIONS: readonly SectionDefinition[] = [
  { id: 'kanban', label: 'Kanban', icon: Columns3, shortcut: 'g k' },
  { id: 'signals', label: 'À regarder', icon: Eye, shortcut: 'g a' },
  { id: 'epics', label: 'Epics', icon: Layers, shortcut: 'g e' },
  { id: 'metrics', label: 'Métriques', icon: ChartNoAxesColumn, shortcut: 'g m' },
];

export const sectionLabel = (section: ProjectSection): string =>
  SECTIONS.find((candidate) => candidate.id === section)?.label ?? section;

/** Ce que désigne l'URL courante : Projet, section, ticket. */
export function useRouteInfo(): RouteInfo {
  const { pathname } = useLocation();
  return useMemo(() => parsePath(pathname), [pathname]);
}

const LAST_PROJECT_KEY = 'beads-desktop:last-project';

/** Retient le dernier Projet visité, pour que les onglets restent utilisables depuis la Vue globale. */
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
