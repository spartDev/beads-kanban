import type { Issue, IssueEpic } from '../data/types';
import { collapseSpaces, isBlankTitle, isEpic, withoutInvisible } from '../data/helpers';
import { compareIssues } from './columns';

/** Les tickets d'un Projet par identifiant. */
export const indexById = (issues: readonly Issue[]): Map<string, Issue> => new Map(issues.map((issue) => [issue.id, issue]));

const MIN_HEAD = 3;
const SEPARATOR = /\s*[:–—]\s+|\s+-\s+/;
/** Les blancs et les caractères sans largeur (`withoutInvisible`) au bord d'un texte : ils n'y lient rien, et n'y laissent qu'une pastille vide ou une ellipse seule. */
const EDGE_BLANKS = /^[\s\p{Cf}]+|[\s\p{Cf}]+$/gu;

/** Le début de `text` qui compte au plus `count` caractères visibles (`withoutInvisible`) : les caractères sans largeur y passent sans occuper de place. */
function visiblePrefix(text: string, count: number): string {
  let seen = 0;
  let end = 0;
  for (const char of text) {
    const width = withoutInvisible(char).length;
    if (seen + width > count) break;
    seen += width;
    end += char.length;
  }
  return text.slice(0, end);
}

/**
 * Le titre court d'une Epic, pour sa pastille : l'intitulé qui précède « : », « – », « — » ou « - »
 * (« beads-desktop V1 : suivi des tickets » donne « beads-desktop V1 »), sinon le titre, coupé à la fin d'un mot
 * et suivi d'une ellipse s'il dépasse `max` caractères. Les caractères sans largeur n'en font pas partie : ceux des bords sont retirés, les autres ne
 * comptent ni pour la limite ni pour la coupe, que l'écran ne voit pas.
 */
export function shortTitle(title: string, max = 24): string {
  const clean = collapseSpaces(title).replace(EDGE_BLANKS, '');
  const head = clean.split(SEPARATOR)[0] ?? clean;
  // Un début trop mince (« V1 ») ne nomme rien : on garde le titre entier. Des caractères sans largeur n'y comptent pas : trois d'entre eux avant « : » passeraient
  // le seuil et ne laisseraient qu'une pastille invisible.
  const base = withoutInvisible(head).length >= MIN_HEAD ? head : clean;
  if (withoutInvisible(base).length <= max) return base;
  const cut = visiblePrefix(base, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const atWord = lastSpace >= 0 && withoutInvisible(cut.slice(0, lastSpace)).length >= max / 2;
  return `${(atWord ? cut.slice(0, lastSpace) : cut).replace(EDGE_BLANKS, '')}…`;
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

/**
 * Le nom d'une Epic : son titre, mis sous la forme que donne `form`, ou son identifiant quand elle n'en a pas (`isBlankTitle`, la règle de `ticketTitle` aussi).
 * Ce choix est fait ici, et ici seulement.
 */
const named = (epic: IssueEpic, form: (title: string) => string): string => (isBlankTitle(epic.title) ? epic.id : form(epic.title));

/**
 * Le nom d'une Epic là où l'interface la désigne : son titre, ou son identifiant quand elle n'en a pas (titre vide, fait d'espaces ou de caractères sans largeur). Sans cela
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
 * Ce qui fait deux titres le même : à la casse, aux espaces, aux caractères sans largeur (`withoutInvisible`) et à la forme Unicode près (« é » en un caractère, NFC, ou
 * en un « e » suivi de son accent, NFD), car l'écran ne montre aucune de ces différences.
 */
const sameTitleKey = (title: string): string => collapseSpaces(withoutInvisible(title)).toLowerCase().normalize('NFC');

/**
 * Le libellé de chaque Epic dans le filtre, par identifiant : son titre, suivi de son identifiant quand une autre Epic
 * porte le même (`sameTitleKey` : à la casse, aux espaces et aux caractères sans largeur près), pour qu'on les distingue.
 * Un titre qui ne dit rien (`isBlankTitle`) laisse l'identifiant.
 */
export function epicLabels(epics: readonly Issue[]): Map<string, string> {
  const sharing = new Map<string, number>();
  for (const { title } of epics) {
    const key = sameTitleKey(title);
    sharing.set(key, (sharing.get(key) ?? 0) + 1);
  }
  return new Map(
    epics.map(({ id, title }) => {
      if (isBlankTitle(title)) return [id, id];
      const clean = collapseSpaces(title);
      return [id, (sharing.get(sameTitleKey(title)) ?? 0) > 1 ? `${clean} (${id})` : clean];
    }),
  );
}
