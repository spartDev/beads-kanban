import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { Keyboard, LayoutGrid, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { isBlankTitle, isEpic, isReadable, ticketTitle } from '../data/helpers';
import { issuesQuery, useProjects } from '../data/hooks';
import type { Issue, IssuesResponse, Project } from '../data/types';
import { typeMeta } from '../design/issue-palette';
import { paths, sectionPath } from '../paths';
import { SECTIONS, useRouteInfo, useTabsProject } from '../shell/navigation';
import { useShortcutsHelp, type PaletteMode } from '../shell/OverlayProvider';
import { THEME_OPTIONS } from '../theme/options';
import { useTheme } from '../theme/ThemeProvider';
import { normalize, rank, type Searchable } from './search';

/** Combien de lignes par rubrique : au-delà, on invite à affiner la recherche. */
const LIMITS = { projects: 8, epics: 6, issues: 40, recents: 6 } as const;

/**
 * Au bout de ce délai sans réponse des tickets du Projet courant, compté depuis la dernière frappe (et pas avant que les tickets soient
 * demandés : il faut la liste des Projets pour savoir lesquels lire), « Chercher … dans tous les Projets » est proposé quand même : sans
 * lui, une liste qui tarde ou ne répond jamais priverait de la recherche globale (la Vue globale resterait le seul recours). Depuis la
 * dernière frappe : la ligne ne se montre pas au milieu de la saisie, mais quand on attend.
 * 2 s : bien au-delà des ≈ 250 ms d'une lecture à froid, pour que la ligne ne vienne jamais pendant un chargement ordinaire ; au-delà des
 * ≈ 1,0 à 1,7 s d'un échec suivi de sa nouvelle tentative (`shouldRetry`, une seconde de pause), dont « Réessayer » s'occupe ; assez court pour
 * qu'on ne croie pas la palette figée.
 */
const WIDEN_AFTER_MS = 2_000;

export interface ScopedIssue {
  issue: Issue;
  project: Project;
}

export interface CommandEntry {
  value: string;
  label: string;
  /** Contexte affiché à côté du libellé (le Projet visé par un onglet). */
  hint?: string;
  keywords?: readonly string[];
  icon: LucideIcon;
  shortcut?: string;
  active?: boolean;
  run: () => void;
}

/**
 * Une rubrique de la palette : ses lignes, son titre et la netteté de sa meilleure correspondance (`best`).
 * Pour les tickets, `more` compte les correspondances au-delà de la limite d'affichage.
 */
export type PaletteSection =
  | { id: 'navigation' | 'actions'; heading: string; best: number; commands: CommandEntry[] }
  | { id: 'projects'; heading: string; best: number; projects: Project[] }
  | { id: 'epics'; heading: string; best: number; items: ScopedIssue[] }
  | { id: 'issues'; heading: string; best: number; items: ScopedIssue[]; more: number };

export interface PaletteSections {
  /** Les rubriques non vides, dans l'ordre d'affichage. */
  sections: PaletteSection[];
  resultCount: number;
  /** La saisie, sans les espaces de bord. */
  search: string;
  /** Les tickets se cherchent dans tous les Projets (Vue globale, ou sur demande) plutôt que dans le Projet courant. */
  everywhere: boolean;
  currentProject: Project | undefined;
  /**
   * Proposer d'étendre la recherche de tickets à tous les Projets, une fois ceux du Projet courant chargés — ou, à défaut de réponse,
   * `WIDEN_AFTER_MS` après la dernière frappe.
   */
  canWiden: boolean;
  /** Des tickets sont en chargement et aucun n'est encore là. */
  loadingTickets: boolean;
  /**
   * Les tickets ne sont pas tous là : la lecture d'au moins un Projet de la portée n'a pas répondu (ni liste, ni échec), ou la liste des
   * Projets, qui dit lesquels lire, n'est pas encore arrivée (la portée est vide en attendant : rien n'est en cours de lecture, et
   * pourtant les tickets manquent).
   */
  ticketsPending: boolean;
  /** Chemin du ticket ou de l'Epic dont l'id est exactement la saisie, s'il y en a un seul parmi les lignes listées. */
  exactPath: string | undefined;
  /** Projets dont les tickets n'ont pas pu être chargés (un rafraîchissement raté qui garde ses tickets n'en fait pas partie). */
  failedProjects: Project[];
  /** Rien à lister ni à proposer : la palette dit pourquoi. */
  empty: boolean;
  /** La liste des Projets : chargée, en échec, ou en cours. */
  projectsStatus: 'ready' | 'failed' | 'loading';
}

const describeProject = (project: Project): Searchable => ({
  id: project.prefix,
  text: project.name,
  keywords: [project.id],
});

// On cherche ce qu'on a écrit (le titre brut) et ce que la ligne affiche : un ticket sans titre y est « Sans titre » (`ticketTitle`), et « Sans titre » le trouve.
const describeIssue = ({ issue }: ScopedIssue): Searchable => ({
  id: issue.id,
  text: issue.title,
  keywords: [issue.type, typeMeta(issue.type).label, ...(isBlankTitle(issue.title) ? [ticketTitle(issue)] : [])],
});

const describeCommand = (command: CommandEntry): Searchable => ({
  text: command.label,
  keywords: command.keywords,
});

const rowCount = (section: PaletteSection): number =>
  'commands' in section ? section.commands.length : 'projects' in section ? section.projects.length : section.items.length;

const byRecency = (a: ScopedIssue, b: ScopedIssue): number =>
  b.issue.updatedAt.localeCompare(a.issue.updatedAt);

/**
 * Vrai quand `waiting` dure depuis `delayMs` sans que `restartKey` ait changé (le décompte repart à chaque changement, tant qu'il n'est pas
 * venu à échéance : une fois vrai, ça reste vrai tant que `waiting` dure). Retombe dès que `waiting` cesse ; l'attente suivante repart de zéro.
 */
function useWaitedFor(waiting: boolean, delayMs: number, restartKey: string): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!waiting) {
      setElapsed(false);
      return undefined;
    }
    const timer = setTimeout(() => setElapsed(true), delayMs);
    return () => clearTimeout(timer);
  }, [waiting, delayMs, restartKey]);
  return waiting && elapsed;
}

/** Chemin de l'unique ticket (ou Epic) listé dont l'id est exactement la saisie, à la casse et aux accents près ; rien s'il y en a plusieurs. */
function exactIssuePath(sections: PaletteSection[], search: string): string | undefined {
  const typed = normalize(search);
  const hits: string[] = [];
  for (const section of sections) {
    if (section.id !== 'epics' && section.id !== 'issues') continue;
    for (const { issue, project } of section.items) {
      if (normalize(issue.id) !== typed) continue;
      // Les mêmes adresses que celles des lignes (`EpicRow`, `IssueRow`).
      hits.push(section.id === 'epics' ? paths.epics(project.id, issue.id) : paths.issue(project.id, issue.id));
    }
  }
  return hits.length === 1 ? hits[0] : undefined;
}

function combineIssueResults(results: UseQueryResult<IssuesResponse, Error>[]) {
  return {
    issues: results.map((result) => result.data?.issues),
    loading: results.some((result) => result.isLoading),
    // Un rafraîchissement raté garde ses résultats : l'échec n'est signalé que pour un Projet sans aucun ticket chargé.
    failed: results.flatMap((result, index) => (result.isError && result.data === undefined ? [index] : [])),
  };
}

/** Les commandes de la palette : où aller, et quoi changer. `go` ferme la palette puis navigue. */
function usePaletteCommands(go: (to: string) => void, close: () => void) {
  const tabsProject = useTabsProject();
  const { preference, setPreference } = useTheme();
  const { show: showHelp } = useShortcutsHelp();

  return useMemo<{ navigation: CommandEntry[]; actions: CommandEntry[] }>(() => {
    const navigation: CommandEntry[] = [
      {
        value: 'nav:global',
        label: 'Vue globale',
        keywords: ['accueil', 'tous les projets'],
        icon: LayoutGrid,
        shortcut: 'g v',
        run: () => go(paths.global()),
      },
      ...(tabsProject
        ? SECTIONS.map(
            (section): CommandEntry => ({
              value: `nav:${section.id}`,
              label: section.label,
              hint: tabsProject.name,
              icon: section.icon,
              shortcut: section.shortcut,
              run: () => go(sectionPath(section.id, tabsProject.id)),
            }),
          )
        : []),
    ];
    const actions: CommandEntry[] = [
      ...THEME_OPTIONS.map(
        (theme): CommandEntry => ({
          value: `action:theme-${theme.value}`,
          label: theme.label,
          keywords: ['apparence', 'mode', 'couleurs', 'clair', 'sombre', 'dark', 'light'],
          icon: theme.icon,
          active: preference === theme.value,
          run: () => {
            setPreference(theme.value);
            close();
          },
        }),
      ),
      {
        value: 'action:shortcuts',
        label: 'Raccourcis clavier',
        keywords: ['aide', 'touches'],
        icon: Keyboard,
        shortcut: '?',
        // L'aide prend la place de la palette : deux boîtes de dialogue ne s'empilent pas.
        run: showHelp,
      },
    ];
    return { navigation, actions };
  }, [go, close, tabsProject, preference, setPreference, showHelp]);
}

/**
 * Ce que la palette liste pour une saisie : les rubriques (navigation, Projets, Epics, tickets, actions), leur
 * ordre, et l'état qui entoure la liste (chargement, échec, rien trouvé). Aucun JSX : `CommandPalette` affiche.
 */
export function usePaletteSections({
  mode,
  query,
  searchAll,
  go,
  close,
}: {
  mode: PaletteMode;
  query: string;
  /** L'utilisateur a demandé de chercher dans tous les Projets. */
  searchAll: boolean;
  go: (to: string) => void;
  close: () => void;
}): PaletteSections {
  const route = useRouteInfo();
  const projectsQuery = useProjects();
  const commands = usePaletteCommands(go, close);
  const search = query.trim();

  const allProjects = useMemo(() => projectsQuery.data?.projects ?? [], [projectsQuery.data]);
  const readable = useMemo(() => allProjects.filter(isReadable), [allProjects]);

  // Les tickets se cherchent dans le Projet courant ; depuis la Vue globale, ou sur demande, dans tous.
  const currentProject = readable.find((project) => project.id === route.projectId);
  const everywhere = searchAll || !route.projectId;
  const scope = useMemo(
    () => (mode === 'projects' ? [] : everywhere ? readable : currentProject ? [currentProject] : []),
    [mode, everywhere, readable, currentProject],
  );

  const issueResults = useQueries({
    queries: scope.map((project) => issuesQuery(project.id)),
    combine: combineIssueResults,
  });

  const scoped = useMemo<ScopedIssue[]>(
    () =>
      scope
        .flatMap((project, index) => (issueResults.issues[index] ?? []).map((issue) => ({ issue, project })))
        .sort(byRecency),
    [scope, issueResults.issues],
  );
  const epics = useMemo(
    () =>
      scoped
        .filter(({ issue }) => isEpic(issue))
        .sort((a, b) => Number(Boolean(a.issue.closedAt)) - Number(Boolean(b.issue.closedAt))),
    [scoped],
  );
  const tickets = useMemo(() => scoped.filter(({ issue }) => !isEpic(issue)), [scoped]);

  // Sans saisie : l'essentiel d'abord. Avec : tout ce qui correspond, la rubrique la plus pertinente en tête.
  const { sections, resultCount } = useMemo(() => {
    const found: PaletteSection[] = [];
    const projectsHit = rank(allProjects, search, describeProject, LIMITS.projects);

    if (mode === 'projects') {
      if (projectsHit.items.length > 0) {
        found.push({ id: 'projects', heading: 'Changer de Projet', best: 1, projects: projectsHit.items });
      }
    } else {
      const navigationHit = rank(commands.navigation, search, describeCommand);
      const epicsHit = rank(epics, search, describeIssue, search ? LIMITS.issues : LIMITS.epics);
      const issuesHit = rank(tickets, search, describeIssue, search ? LIMITS.issues : LIMITS.recents);
      const actionsHit = rank(commands.actions, search, describeCommand);

      // Dans l'ordre d'affichage sans saisie ; les actions ne se montrent que sur demande.
      if (navigationHit.items.length > 0) {
        found.push({ id: 'navigation', heading: 'Navigation', best: navigationHit.best, commands: navigationHit.items });
      }
      if (projectsHit.items.length > 0) {
        found.push({ id: 'projects', heading: 'Projets', best: projectsHit.best, projects: projectsHit.items });
      }
      if (epicsHit.items.length > 0) {
        found.push({ id: 'epics', heading: 'Epics', best: epicsHit.best, items: epicsHit.items });
      }
      if (issuesHit.items.length > 0) {
        found.push({
          id: 'issues',
          heading: search ? 'Tickets' : 'Tickets récents',
          best: issuesHit.best,
          items: issuesHit.items,
          more: issuesHit.total - issuesHit.items.length,
        });
      }
      if (search && actionsHit.items.length > 0) {
        found.push({ id: 'actions', heading: 'Actions', best: actionsHit.best, commands: actionsHit.items });
      }
    }

    // Avec saisie, la rubrique dont la meilleure correspondance est la plus nette passe devant (tri stable).
    if (search) found.sort((a, b) => b.best - a.best);

    return { sections: found, resultCount: found.reduce((total, section) => total + rowCount(section), 0) };
  }, [mode, search, allProjects, commands, epics, tickets]);

  const exactPath = useMemo(() => exactIssuePath(sections, search), [sections, search]);

  // Proposé quand le Projet n'a plus rien à répondre : tant que ses tickets se chargent, un résultat peut encore arriver, et Entrée
  // ne doit pas prendre cette ligne de repli à sa place. Mais une liste qui tarde ne doit pas priver de la recherche globale : après
  // `WIDEN_AFTER_MS` sans réponse depuis la dernière frappe, la ligne revient. Seule ligne de la liste, elle n'est pas sélectionnée d'office (voir
  // `onlyWiden` dans `CommandPalette`) : les tickets qui arrivent ensuite prennent la sélection, sans qu'elle saute, et Entrée ouvre le
  // ticket tapé. Entrée pressée avant n'est pas perdue non plus : `usePendingEnter` ouvre le ticket qu'elle attendait.
  const widenable = mode === 'all' && !everywhere && readable.length > 1 && search.length > 0;
  const waitedTooLong = useWaitedFor(widenable && issueResults.loading, WIDEN_AFTER_MS, search);
  const canWiden = widenable && (!issueResults.loading || waitedTooLong);
  const failedProjects = issueResults.failed.flatMap((index) => (scope[index] ? [scope[index]] : []));

  return {
    sections,
    resultCount,
    search,
    everywhere,
    currentProject,
    canWiden,
    loadingTickets: mode === 'all' && issueResults.loading && tickets.length === 0,
    ticketsPending: issueResults.loading || (mode !== 'projects' && projectsQuery.isLoading),
    exactPath,
    failedProjects,
    empty: resultCount === 0 && !canWiden && !issueResults.loading && failedProjects.length === 0,
    // Les Projets d'abord : un rafraîchissement raté garde la liste affichée.
    projectsStatus: projectsQuery.data ? 'ready' : projectsQuery.isError ? 'failed' : 'loading',
  };
}
