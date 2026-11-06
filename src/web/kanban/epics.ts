import type { Issue, IssueEpic } from '../data/types';
import { collapseSpaces, isBlankTitle, isEpic, withoutInvisible } from '../data/helpers';
import { BLANK_CHAR, INVISIBLE_CHAR, SELECTOR_CHAR } from '../lib/invisibleText';
import { compareIssues } from './columns';

/** Les tickets d'un Projet par identifiant. */
export const indexById = (issues: readonly Issue[]): Map<string, Issue> => new Map(issues.map((issue) => [issue.id, issue]));

/** Le libellé de l'option du filtre qui retire le filtre (`EpicFilter`) : aucune Epic ne doit se lire comme elle (`epicLabels`). */
export const ALL_EPICS = 'Toutes les Epics';

const MIN_HEAD = 3;
const SEPARATOR = /\s*[:–—]\s+|\s+-\s+/;
/** Les signes que ce séparateur lit (« : », « – », « — », « - »), seuls : ils ne forment pas un intitulé (`isUnnamed`). */
const SEPARATOR_SIGNS = /[:–—-]/gu;
/**
 * Les blancs et les caractères qu'on ne voit pas (`withoutInvisible`) au bord d'un texte : ils n'y lient rien, et n'y laissent qu'une pastille vide ou une ellipse seule. La classe est celle de la règle des
 * textes invisibles (`isInvisibleText`) : un remplisseur hangul (U+3164) s'y rogne comme une espace sans largeur, U+06DD, que la police dessine, y reste. Un sélecteur de variante derrière un caractère qu'on voit
 * en fait partie (« ⚠ » suivi de U+FE0F) : il n'est pas rogné de la fin du titre.
 *
 * La série de la fin ne s'ancre qu'à son début (`(?<!…)`) : sans cela, `X+$` s'essayait à chaque position d'une longue série, et le temps croissait avec son carré (20 000 caractères sans largeur de suite :
 * plusieurs secondes, déjà sur HEAD), quand une base modifiée à la main peut porter un tel titre.
 */
const EDGE_BLANKS = new RegExp(`^${INVISIBLE_CHAR}+|(?<!${INVISIBLE_CHAR})${INVISIBLE_CHAR}+$`, 'gu');
const BLANK = new RegExp(BLANK_CHAR, 'u');
/** La série de blancs et de sélecteurs de variante qui finit un texte, quand elle finit par un sélecteur. Elle ne s'ancre qu'à son début (`(?<!…)`), comme `EDGE_BLANKS` : le temps croît avec la longueur du texte, non avec son carré. */
const TRAILING_RUN = new RegExp(`(?<!${BLANK_CHAR}|${SELECTOR_CHAR})(?:${BLANK_CHAR}|${SELECTOR_CHAR})*${SELECTOR_CHAR}$`, 'u');

/**
 * La tête sans les sélecteurs de variante qu'une espace sépare de ce qui précède, ni cette espace : « Alerte ⚠ », une espace et U+FE0F avant « : suite » n'ont pas à finir par une espace devant un sélecteur
 * qu'on ne voit pas, comme le titre entier n'y finit pas (`EDGE_BLANKS`). Rien d'autre n'est rogné. HEAD ne rognait pas le bout d'une tête, et ce qu'il y laissait ne se retire pas : une marque de direction
 * (U+200E, U+200F, U+061C, U+202A à U+202E, U+2066 à U+2069) règle, à travers l'espace, le sens des signes neutres qui la précèdent (le « ! » d'un mot hébreu change de côté sans elle), un liant ou l'étiquette
 * d'un drapeau changent le dessin de ce qui les précède, une espace sans largeur ne change rien à ce qu'on voit mais la pastille de HEAD en garde la largeur : la tête n'en perd aucun (revue de bdesk-38k.70, B3).
 */
function withoutDetachedSelectors(head: string): string {
  const run = TRAILING_RUN.exec(head);
  const blank = run === null ? -1 : run[0].search(BLANK);
  return run === null || blank < 0 ? head : head.slice(0, run.index + blank);
}
/** Découpe un texte en graphèmes : les caractères que l'œil lit comme un seul (un emoji de famille, un drapeau, une lettre et son accent écrits en deux morceaux). */
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Ce qu'un texte occupe à l'écran, en unités de texte : sans ses caractères sans largeur (`withoutInvisible`), et en forme composée (NFC). Un « é » s'écrit en un caractère ou en deux (« e » puis son
 * accent, NFD : un copier-coller depuis macOS en donne) et l'écran n'en voit pas la différence : un titre en NFD se coupe où le même titre en NFC. Un emoji vaut toujours deux unités, comme avant.
 * Le texte, lui, n'est pas normalisé : la pastille montre les caractères du titre, dans la forme où il est écrit (comme le libellé du filtre Epic, qui ne change pas non plus d'une forme à l'autre).
 * La coupe mesure un graphème à la fois, les seuils le titre entier : même compte, sauf pour une marque que sépare de sa base un caractère de contrôle (elle ne se compose pas, et compte une unité de plus).
 */
const measure = (text: string): number => withoutInvisible(text).normalize('NFC').length;

/**
 * Le début de `text` qui compte au plus `count` unités visibles (`measure`) : les caractères sans largeur y passent sans occuper de place. La coupe tombe entre deux
 * graphèmes, jamais dedans : un graphème qui franchirait la limite reste tout entier de l'autre côté, au lieu de devenir un autre emoji ou de perdre son accent. Le premier est
 * gardé même plus long que `count` (une lettre empilée de marques) : sans lui, la pastille ne lirait que l'ellipse.
 */
function visiblePrefix(text: string, count: number): string {
  let seen = 0;
  let end = 0;
  for (const { segment } of segmenter.segment(text)) {
    const width = measure(segment);
    if (end > 0 && seen + width > count) break;
    seen += width;
    end += segment.length;
  }
  return text.slice(0, end);
}

/**
 * Un titre d'Epic dont on ne tire pas de nom : un titre qui ne dit rien (`isBlankTitle`), ou qui n'est fait que des séparateurs de la pastille (« : », « – », « — », « - »). Le nom d'une Epic est dérivé de son
 * titre (l'intitulé qui précède un séparateur) : sans rien d'autre que des séparateurs il n'y a pas d'intitulé, et l'identifiant la nomme. Le titre d'un ticket, lui, reste ce que l'auteur a écrit (`ticketTitle`).
 */
const isUnnamed = (title: string): boolean => isBlankTitle(title.replace(SEPARATOR_SIGNS, ''));

/**
 * Le titre court d'une Epic, pour sa pastille : l'intitulé qui précède « : », « – », « — » ou « - »
 * (« beads-desktop V1 : suivi des tickets » donne « beads-desktop V1 »), sinon le titre, coupé à la fin d'un mot
 * et suivi d'une ellipse s'il dépasse `max` caractères.
 *
 * - Les caractères qu'on ne voit pas (sans largeur ou non : `isInvisibleText`) n'en font pas partie : ceux des bords sont retirés, les autres ne comptent ni pour la limite ni pour la coupe, que l'écran ne voit pas.
 * - La limite se mesure en forme composée (NFC) et la coupe tombe entre deux graphèmes, jamais dedans (`measure`, `visiblePrefix`). Le texte montré est celui du titre, tel qu'il est écrit. Rien
 *   de visible n'est coupé d'un titre qui n'est qu'un graphème plus long que la limite : il reste entier, sans ellipse, que des caractères sans largeur le suivent ou non.
 * - Un séparateur en tête du titre reste : le retirer changerait le sens (« – 5 °C »). Des blancs ou des caractères sans largeur devant lui n'y changent rien : la pastille est celle du titre visible.
 * - La tête perd les sélecteurs de variante qu'une espace sépare de ce qui précède, avec cette espace, et rien d'autre (`withoutDetachedSelectors`). Pour tout titre où aucun caractère ne change de classe, la
 *   pastille est celle de HEAD (`kanban/headParity.test.ts`).
 * - Un titre dont on ne tire pas de nom (`isUnnamed`) n'a pas de titre court : la chaîne vide. `epicShortName` y met l'identifiant.
 */
export function shortTitle(title: string, max = 24): string {
  if (isUnnamed(title)) return '';
  const clean = collapseSpaces(title).replace(EDGE_BLANKS, '');
  const head = clean.split(SEPARATOR)[0] ?? clean;
  // Un début trop mince (« V1 ») ne nomme rien : on garde le titre entier. Des caractères sans largeur n'y comptent pas : trois d'entre eux avant « : » passeraient
  // le seuil et ne laisseraient qu'une pastille invisible. La tête se mesure telle qu'elle est écrite, comme avant, et c'est ensuite qu'on en rogne le bout (`withoutDetachedSelectors`).
  const base = measure(head) >= MIN_HEAD ? withoutDetachedSelectors(head) : clean;
  if (measure(base) <= max) return base;
  const cut = visiblePrefix(base, max - 1);
  // Un titre qui n'est qu'un graphème plus long que la limite (une lettre empilée de marques) reste entier, comme `visiblePrefix` le garde : rien de visible n'est coupé (ce qui suit la coupe n'est
  // rien, ou des blancs et des caractères sans largeur, que l'écran ne montre pas), et une ellipse annoncerait une coupe qui n'a pas eu lieu.
  if (isBlankTitle(base.slice(cut.length))) return base;
  const lastSpace = cut.lastIndexOf(' ');
  const atWord = lastSpace >= 0 && measure(cut.slice(0, lastSpace)) >= max / 2;
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
 * Le nom d'une Epic : son titre, mis sous la forme que donne `form`, ou son identifiant quand elle n'en a pas (`isUnnamed` : un titre vide, ou fait de séparateurs seuls).
 * Ce choix est fait ici, et ici seulement.
 */
const named = (epic: IssueEpic, form: (title: string) => string): string => (isUnnamed(epic.title) ? epic.id : form(epic.title));

/**
 * Le nom d'une Epic là où l'interface la désigne : son titre, ou son identifiant quand elle n'en a pas (titre vide, fait d'espaces ou de caractères sans largeur, ou de
 * séparateurs seuls : `isUnnamed`). Sans cela la pastille de sa carte et le lien Parent du panneau diraient « Epic : » sans rien derrière, et l'infobulle du lien vers sa page
 * citerait « » entre guillemets. Le filtre Epic (`epicLabels`) nomme de même une Epic sans titre.
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
 * Le libellé de chaque Epic dans le filtre, par identifiant : son titre, suivi de son identifiant tant qu'une autre option se lirait pareil (`sameTitleKey` : à la casse, aux
 * espaces, aux caractères sans largeur et à la forme Unicode près), pour qu'on les distingue. Une Epic dont on ne tire pas de nom (`isUnnamed`) est lue par son identifiant, comme `epicName` :
 * une Epic qui s'intitule comme cet identifiant le porte donc en plus. Elle le porte aussi quand son titre s'écrit comme le libellé qu'une autre reçoit (« Refonte (a) »).
 * Les libellés `reserved` sont ceux des autres options du filtre, que ses Epics ne remplacent pas (« Toutes les Epics » par défaut : `ALL_EPICS`) : ils sont déjà pris, et une Epic qui
 * s'y intitule porte son identifiant. Aucune option ne se lit donc comme une autre, ni comme l'une de celles-là.
 */
export function epicLabels(epics: readonly Issue[], reserved: readonly string[] = [ALL_EPICS]): Map<string, string> {
  const labels = new Map(epics.map(({ id, title }) => [id, isUnnamed(title) ? id : collapseSpaces(title)]));
  // Les libellés réservés comptent comme déjà pris, avant la boucle : ils ne changent pas.
  const taken = new Map<string, number>();
  for (const label of reserved) taken.set(sameTitleKey(label), (taken.get(sameTitleKey(label)) ?? 0) + 1);
  // Les Epics qui ont un titre sont les seules à pouvoir porter leur identifiant, et chacune une fois : tant qu'elles ne l'ont pas fait, leur libellé est celui de leur titre.
  const undecorated = new Set(epics.filter(({ title }) => !isUnnamed(title)).map(({ id }) => id));
  for (;;) {
    const sharing = new Map(taken);
    for (const label of labels.values()) sharing.set(sameTitleKey(label), (sharing.get(sameTitleKey(label)) ?? 0) + 1);
    const clashing = [...undecorated].filter((id) => (sharing.get(sameTitleKey(labels.get(id) ?? '')) ?? 0) > 1);
    if (clashing.length === 0) return labels;
    for (const id of clashing) {
      labels.set(id, `${labels.get(id) ?? ''} (${id})`);
      undecorated.delete(id);
    }
  }
}
