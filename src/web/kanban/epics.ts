import type { Issue } from '../data/types';
import { isEpic } from '../data/helpers';
import { compareIssues } from './columns';

/** Les tickets d'un Projet par identifiant. */
export const indexById = (issues: readonly Issue[]): Map<string, Issue> => new Map(issues.map((issue) => [issue.id, issue]));

/**
 * L'Epic d'un ticket : son parent quand il est de type epic, sinon l'Epic la plus proche parmi ses ancêtres. Un
 * sous-ticket garde donc la pastille de l'Epic de son parent, et le filtre Epic (qui garde les Enfants indirects)
 * ne montre jamais une carte sans pastille. À l'abri des boucles de parentés.
 */
export function epicOf(issue: Issue, byId: ReadonlyMap<string, Issue>): Issue | null {
  const seen = new Set<string>([issue.id]);
  for (let parentId = issue.parentId; parentId !== null; ) {
    if (seen.has(parentId)) return null;
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) return null;
    if (isEpic(parent)) return parent;
    parentId = parent.parentId;
  }
  return null;
}

const MIN_HEAD = 3;
const SEPARATOR = /\s*[:–—]\s+|\s+-\s+/;

/**
 * Le titre court d'une Epic, pour sa pastille : l'intitulé qui précède « : », « – », « — » ou « - »
 * (« beads-desktop V1 : suivi des tickets » donne « beads-desktop V1 »), sinon le titre, coupé à la fin d'un mot
 * et suivi d'une ellipse s'il dépasse `max` caractères.
 */
export function shortTitle(title: string, max = 24): string {
  const clean = title.trim().replace(/\s+/g, ' ');
  const head = clean.split(SEPARATOR)[0] ?? clean;
  // Un début trop mince (« V1 ») ne nomme rien : on garde le titre entier.
  const base = head.length >= MIN_HEAD ? head : clean;
  if (base.length <= max) return base;
  const cut = base.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace >= max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Les Epics du Projet pour le filtre : les ouvertes d'abord, puis les fermées. Chaque groupe est rangé comme une colonne
 * du tableau le serait (`compareIssues`) : par priorité (P0 d'abord), puis mise à jour la plus récente. Ce n'est pas
 * l'ordre des colonnes, qui ne dit rien d'une Epic.
 */
export function epicChoices(issues: readonly Issue[]): { open: Issue[]; closed: Issue[] } {
  const epics = issues.filter(isEpic).sort(compareIssues);
  return {
    open: epics.filter((epic) => epic.status !== 'closed'),
    closed: epics.filter((epic) => epic.status === 'closed'),
  };
}

const collapseSpaces = (title: string): string => title.trim().replace(/\s+/g, ' ');

/**
 * Le libellé de chaque Epic dans le filtre, par identifiant : son titre, suivi de son identifiant quand une autre Epic
 * porte le même (à la casse et aux espaces près), pour qu'on les distingue. Un titre vide laisse l'identifiant.
 */
export function epicLabels(epics: readonly Issue[]): Map<string, string> {
  const sharing = new Map<string, number>();
  for (const { title } of epics) {
    const key = collapseSpaces(title).toLowerCase();
    sharing.set(key, (sharing.get(key) ?? 0) + 1);
  }
  return new Map(
    epics.map(({ id, title }) => {
      const clean = collapseSpaces(title);
      if (clean === '') return [id, id];
      return [id, (sharing.get(clean.toLowerCase()) ?? 0) > 1 ? `${clean} (${id})` : clean];
    }),
  );
}
