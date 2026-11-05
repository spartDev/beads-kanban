import type { Issue, Project } from './types';

export const isReadable = (project: Project): boolean => project.status === 'ok';

export const isEpic = (issue: Issue): boolean => issue.type === 'epic';

/** Ce que l'interface écrit à la place du titre d'un ticket qui n'en a pas. */
const UNTITLED = 'Sans titre';

/** Des blancs (`\s` : l'espace insécable aussi) et des caractères de mise en forme invisibles (catégorie Unicode `Cf` : U+200B à U+200D, U+2060, U+00AD, U+FEFF…), et rien d'autre. */
const BLANK = /^[\s\p{Cf}]*$/u;

/**
 * Un titre qui ne dit rien : vide, fait d'espaces, ou fait de caractères sans largeur (une base modifiée à la main, un copier-coller). `trim()` ne suffit pas : il retire
 * les blancs et U+FEFF, mais pas U+200B à U+200D, U+2060 ni U+00AD, qui laissent un nom accessible invisible, que lecteurs d'écran et axe ne signalent pas. La règle est
 * écrite ici : `ticketTitle` (le ticket) la suit, et `epicName` (l'Epic, dans `kanban/epics.ts`) y ajoute les titres de séparateurs seuls, dont son nom ne tire rien. Pour un ticket,
 * un titre de séparateurs seuls (« - », « : ») et une autre ponctuation (« ??? », « … ») sont ce que l'auteur a écrit : ils ne sont pas vides.
 */
export const isBlankTitle = (title: string): boolean => BLANK.test(title);

/**
 * Le texte sans ses caractères sans largeur (catégorie `Cf`) : ce qu'on en lit à l'écran, pour compter ou comparer des titres. Jamais pour les écrire : un liant sans chasse
 * (U+200D) tient ensemble les emojis d'une famille, un antiliant (U+200C) sépare les lettres d'un mot persan : les retirer du titre en changerait le sens.
 */
export const withoutInvisible = (text: string): string => text.replace(/\p{Cf}/gu, '');

/** Une série de blancs que des caractères sans largeur (`withoutInvisible`) peuvent entrecouper : ce que l'œil lit comme un seul blanc. */
const BLANK_RUN = /[\s\p{Cf}]+/gu;
const WHITESPACE = /\s/u;

/**
 * Le texte sur une ligne : ses blancs (espaces, tabulations, sauts de ligne) repliés en une seule espace entre deux textes, et aucune autour. Les caractères sans largeur n'y
 * comptent pas : un navigateur ne les prend pas pour des blancs, si bien que deux espaces qu'ils séparent, ou une espace entre l'un d'eux et le bord du titre, restaient
 * visibles. Seuls les blancs en trop sont retirés, jamais un caractère sans largeur : ce serait changer le titre (voir `withoutInvisible`). U+FEFF, que JavaScript compte
 * parmi les blancs, est replié comme eux.
 */
export const collapseSpaces = (text: string): string =>
  text.replace(BLANK_RUN, (run, offset: number) => {
    // Une seule espace par série, et aucune au bord du texte : on la tient pour déjà posée.
    let spaced = offset === 0 || offset + run.length === text.length;
    let folded = '';
    for (const char of run) {
      if (!WHITESPACE.test(char)) folded += char;
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
