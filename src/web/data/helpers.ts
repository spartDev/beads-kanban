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
 * écrite ici, et ici seulement : `ticketTitle` (le ticket) et `epicName` (l'Epic, dans `kanban/epics.ts`) la suivent tous deux.
 */
export const isBlankTitle = (title: string): boolean => BLANK.test(title);

/**
 * Le texte sans ses caractères sans largeur (catégorie `Cf`) : ce qu'on en lit à l'écran, pour compter ou comparer des titres. Jamais pour les écrire : un liant sans chasse
 * (U+200D) tient ensemble les emojis d'une famille, un antiliant (U+200C) sépare les lettres d'un mot persan : les retirer du titre en changerait le sens.
 */
export const withoutInvisible = (text: string): string => text.replace(/\p{Cf}/gu, '');

/** Le texte sans blancs de bord, ses blancs intérieurs (espaces, tabulations, sauts de ligne) repliés en une seule espace : un titre sur une ligne. */
export const collapseSpaces = (text: string): string => text.trim().replace(/\s+/g, ' ');

/**
 * Le titre d'un ticket là où son identifiant est dit juste à côté (le panneau, la carte du kanban, une ligne de liste, de la palette ou d'un tableau) : son titre, rangé
 * sur une ligne (`collapseSpaces`, comme celui d'une Epic), ou « Sans titre » quand il n'en a pas (`isBlankTitle` : titre vide, fait d'espaces ou de caractères sans
 * largeur, une base modifiée à la main), pour ne laisser ni `<h2>` vide au panneau (axe `empty-heading`), ni lien sans nom à la carte (axe `link-name`), ni texte invisible
 * ou guillemets vides (« Doublon de bdesk-zz1 «  » »). Pas l'identifiant : il est déjà là, et le dialogue du panneau, nommé par l'identifiant puis le titre, le dirait deux fois.
 * Là où une Epic est désignée sans son identifiant à côté (pastille, lien Parent, titre de sa page), c'est `epicName` : l'identifiant, justement.
 */
export const ticketTitle = (issue: Pick<Issue, 'title'>): string => (isBlankTitle(issue.title) ? UNTITLED : collapseSpaces(issue.title));
