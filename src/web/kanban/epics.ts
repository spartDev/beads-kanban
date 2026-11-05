import type { Issue, IssueEpic } from '../data/types';
import { isEpic } from '../data/helpers';
import { compareIssues } from './columns';

/** Les tickets d'un Projet par identifiant. */
export const indexById = (issues: readonly Issue[]): Map<string, Issue> => new Map(issues.map((issue) => [issue.id, issue]));

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

/** Le nom d'une Epic : son titre, mis sous la forme que donne `form`, ou son identifiant quand elle n'en a pas. La règle est ici, et ici seulement. */
const named = (epic: IssueEpic, form: (title: string) => string): string => form(epic.title) || epic.id;

/**
 * Le nom d'une Epic là où l'interface la désigne : son titre, ou son identifiant quand elle n'en a pas (titre vide, ou fait d'espaces). Sans cela
 * la pastille de sa carte et le lien Parent du panneau diraient « Epic : » sans rien derrière, et l'infobulle du lien vers sa page citerait « » entre
 * guillemets. Le filtre Epic (`epicLabels`) nomme de même une Epic sans titre.
 */
export function epicName(epic: IssueEpic): string {
  return named(epic, collapseSpaces);
}

/**
 * Le nom court d'une Epic, pour une pastille ou un lien : son titre court (`shortTitle`), ou son identifiant quand elle n'a pas de titre. L'identifiant
 * n'est jamais abrégé : coupé, il ne nommerait plus rien.
 */
export function epicShortName(epic: IssueEpic): string {
  return named(epic, shortTitle);
}

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
