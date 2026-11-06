import { BLANK_CHAR, INVISIBLE_CHAR, SELECTOR_CHAR, SILENT_CHAR, isInvisibleText } from '../lib/invisibleText';
import type { Issue, Project } from './types';

export const isReadable = (project: Project): boolean => project.status === 'ok';

export const isEpic = (issue: Issue): boolean => issue.type === 'epic';

/** Ce que l'interface écrit à la place du titre d'un ticket qui n'en a pas. */
const UNTITLED = 'Sans titre';

/**
 * Un titre qui ne dit rien : vide, fait d'espaces, ou fait de caractères qu'on ne voit pas (une base modifiée à la main, un copier-coller). La règle n'est pas écrite ici : c'est celle des textes
 * invisibles (`isInvisibleText`, dans `lib/invisibleText`, où elle est dite et justifiée), que `Page` et `Notice` suivent aussi. `trim()` ne suffit pas : voir là. `ticketTitle` (le ticket) la suit, et
 * `epicName` (l'Epic, dans `kanban/epics.ts`) y ajoute les titres de séparateurs seuls, dont son nom ne tire rien. Pour un ticket, un titre de séparateurs seuls (« - », « : ») et une autre
 * ponctuation (« ??? », « … ») sont ce que l'auteur a écrit : ils ne sont pas vides.
 */
export const isBlankTitle = (title: string): boolean => isInvisibleText(title);

const SILENT = new RegExp(SILENT_CHAR, 'gu');

/**
 * Le texte sans les caractères qu'on n'y voit pas, hors les blancs (une espace occupe sa place) : ce qu'on en lit à l'écran, pour compter ou comparer des titres. Ces caractères sont ceux de la règle des
 * textes invisibles (`isInvisibleText`, dans `lib/invisibleText`, d'où cette expression est prise) : les caractères sans largeur (U+200B, U+200D, U+2060, U+00AD, U+FEFF), mais aussi ceux que la police laisse
 * blancs sans qu'ils soient de catégorie `Cf` (le remplisseur hangul U+3164, le blanc braille U+2800), et non U+06DD et ses pareils, que la police dessine et que `Cf` retirait. Un sélecteur de variante qui
 * suit un caractère qu'on voit reste : il en change le dessin (« ⚠ » suivi de U+FE0F). Jamais pour écrire un titre : un liant sans chasse (U+200D) tient ensemble les emojis d'une famille, un antiliant
 * (U+200C) sépare les lettres d'un mot persan : les retirer du titre en changerait le sens.
 */
export const withoutInvisible = (text: string): string => text.replace(SILENT, '');

/**
 * Une série de blancs que des caractères invisibles (`withoutInvisible`) peuvent entrecouper : ce que l'œil lit comme un seul blanc. La classe est celle de la règle des textes invisibles, comme `withoutInvisible`,
 * sans les sélecteurs de variante : pour `collapseSpaces` un sélecteur est un caractère comme un autre, qui coupe la série, comme sur HEAD (où il n'était ni un blanc, ni de catégorie `Cf`).
 */
const BLANK_RUN = new RegExp(`(?:(?!${SELECTOR_CHAR})${INVISIBLE_CHAR})+`, 'gu');
/** Ceux d'une telle série qui se replient en une espace : les blancs d'Unicode, et U+FEFF, que JavaScript compte parmi les blancs (`\s`) et qui s'est toujours replié comme eux. */
const FOLDED = new RegExp(`${BLANK_CHAR}|\\ufeff`, 'u');

/**
 * Le texte sur une ligne : ses blancs (espaces, tabulations, sauts de ligne) repliés en une seule espace entre deux textes, et aucune autour. Les caractères qu'on ne voit pas (sans largeur ou non :
 * `isInvisibleText`) n'y comptent pas : un navigateur ne les prend pas pour des blancs, si bien que deux espaces qu'ils séparent, ou une espace entre l'un d'eux et le bord du titre, restaient
 * visibles. Seuls les blancs en trop sont retirés, jamais un caractère invisible : ce serait changer le titre (voir `withoutInvisible`). U+FEFF, que JavaScript compte
 * parmi les blancs, est replié comme eux, et U+0085 (le saut de ligne de contrôle) aussi.
 *
 * Un sélecteur de variante n'est jamais d'une série de blancs, qu'un caractère qu'on voit le précède ou non : c'est un caractère comme un autre, qui coupe la série, comme sur HEAD. Les blancs qui l'entourent
 * se replient chacun de leur côté, et l'espace que HEAD gardait entre lui et ce qui le précède (un signe, un autre sélecteur, un liant) reste : retirée, elle collerait le sélecteur à ce qui le précédait,
 * et le signe noir « ⚠ » deviendrait le signe en couleurs, un deuxième sélecteur mongol dessinerait une boîte pointillée, un liant changerait la forme de la lettre qui suit (revues de bdesk-38k.70 : B1, B2, B4).
 * Tout titre où aucun caractère ne change de classe se replie exactement comme sur HEAD (`kanban/headParity.test.ts`).
 */
export const collapseSpaces = (text: string): string =>
  text.replace(BLANK_RUN, (run, offset: number) => {
    // Une seule espace par série, et aucune au bord du texte : on la tient pour déjà posée.
    let spaced = offset === 0 || offset + run.length === text.length;
    let folded = '';
    for (const char of run) {
      if (!FOLDED.test(char)) folded += char;
      else if (!spaced) {
        folded += ' ';
        spaced = true;
      }
    }
    return folded;
  });

/**
 * Le titre d'un ticket là où son identifiant est dit juste à côté (le panneau, la carte du kanban, une ligne de liste, de la palette ou d'un tableau) : son titre, rangé
 * sur une ligne (`collapseSpaces`, comme celui d'une Epic), ou « Sans titre » quand il n'en a pas (`isBlankTitle` : titre vide, fait d'espaces ou de caractères sans
 * largeur, une base modifiée à la main), pour ne laisser ni `<h2>` vide au panneau (axe `empty-heading`), ni lien sans nom à la carte (axe `link-name`), ni texte invisible
 * ou guillemets vides (« Doublon de bdesk-zz1 «  » »). Pas l'identifiant : il est déjà là, et le dialogue du panneau, nommé par l'identifiant puis le titre, le dirait deux fois.
 * Là où une Epic est désignée sans son identifiant à côté (pastille, lien Parent, titre de sa page), c'est `epicName` : l'identifiant, justement.
 */
export const ticketTitle = (issue: Pick<Issue, 'title'>): string => (isBlankTitle(issue.title) ? UNTITLED : collapseSpaces(issue.title));
