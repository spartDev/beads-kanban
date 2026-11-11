import { type RefObject, useEffect } from 'react';
import { focusElement, focusIsAdrift } from '../lib/focus';
import { focusZoneOf, watchContent } from '../lib/zoneFocus';
import { cardLink } from './useBoardShortcuts';

/**
 * Où le focus va quand ce qui l'avait dans le tableau en part, retiré du document (voir `watchContent`). Le plus souvent, c'est une carte que le commit change
 * de colonne : React ne déplace pas un nœud d'un parent à l'autre, il remonte la carte dans la nouvelle colonne, et le focus qu'elle avait, la sélection du clavier
 * (voir `useBoardShortcuts`), tombait sur le corps de la page. Il suit la carte, par son identifiant, jusqu'à son lien : celui de son titre, même quand c'était la pastille d'Epic qui l'avait,
 * puisque c'est ce que « la carte sélectionnée » a pour focus. Sans carte à l'écran (la colonne où elle arrive est cachée sur un écran étroit, le ticket est supprimé ou part dans le tiroir
 * « En pause » fermé), c'est la zone la plus proche, le contenu principal. Jamais le corps de la page, et jamais une colonne que l'utilisateur n'a pas choisie : seul son choix change celle
 * qu'un écran étroit affiche (voir `Board`).
 * Sans défilement (`focusElement`) : le focus n'est pas l'attention de l'utilisateur, qui a pu faire défiler la page ailleurs ; la carte le garde, où qu'elle soit.
 * `within` est le tableau, ou le contenu principal qui le contient quand l'appelant ne connaît pas le nœud du tableau (le panneau d'un ticket, la palette : voir `movedCardLink`).
 */
export function focusCardOrZone(within: Element, gone?: Element): boolean {
  return focusElement(movedCardLink(within, gone)) || focusZoneOf(within);
}

/**
 * Le lien de la carte dont `gone` faisait partie, là où elle est maintenant dans `within` (le tableau, ou le contenu principal qui le contient). `gone` est un élément de carte, le plus souvent
 * son lien, retiré du document parce qu'un commit a changé la carte de colonne : le sous-arbre qui est parti avec lui tient (`closest`), et l'identifiant de la carte la retrouve. Le panneau
 * d'un ticket et la palette retiennent ainsi le lien de la carte qui les a ouverts pour le lui rendre à leur fermeture, et ce lien n'est plus là quand la carte a changé de colonne entre-temps.
 * Aucune carte : `gone` n'est pas dans une carte (le champ de la palette, un bouton), ou la carte n'est plus dans `within` (le ticket est supprimé, ou dans le tiroir « En pause » fermé).
 * Pour un élément encore dans le document, c'est le lien de sa propre carte.
 *
 * La carte est celle du **même Projet** (`data-card-project`, que le sous-arbre parti garde aussi) : les identifiants de tickets ne sont uniques que dans un Projet, et deux Projets (deux copies, deux clones
 * d'un même dépôt) peuvent avoir les mêmes. Le panneau d'un ticket reste monté d'un Projet à l'autre (un choix de la palette ouvre un ticket de l'autre, sur la même route) : il retient le lien d'une carte
 * du premier, et le tableau qui arrive est celui du second, dont la carte de même identifiant n'est pas la carte d'où l'on venait.
 */
export function movedCardLink(within: Element, gone: Element | null | undefined): HTMLAnchorElement | null {
  const card = gone?.closest('[data-card-id]');
  const id = card?.getAttribute('data-card-id');
  return (card && id ? cardLink(within, id, card.getAttribute('data-card-project')) : undefined) ?? null;
}

/** La carte qui a ouvert le panneau d'un ticket : son identifiant, et son Projet (les identifiants de tickets ne sont uniques que dans un Projet, voir `movedCardLink`). */
interface OpeningCard {
  id: string;
  project: string;
}

/**
 * Ce que le lien d'une carte écrit dans l'entrée d'historique qu'il ouvre (`state` du `Link`, voir `Card`) : de quelle carte vient le panneau d'un ticket,
 * pour que `panelOpener` la retrouve quand le clic n'a pas donné le focus au lien.
 */
export const openedFromCard = (id: string, project: string): { openedFromCard: OpeningCard } => ({ openedFromCard: { id, project } });

/** La carte que `state` dit avoir ouvert l'entrée (voir `openedFromCard`), ou `null`. L'état d'une entrée vient du navigateur, qui le garde d'un rechargement à l'autre : on ne se fie pas à sa forme. */
function openingCard(state: unknown): OpeningCard | null {
  const opening = typeof state === 'object' && state !== null && 'openedFromCard' in state ? state.openedFromCard : null;
  if (typeof opening !== 'object' || opening === null || !('id' in opening) || !('project' in opening)) return null;
  const { id, project } = opening;
  return typeof id === 'string' && typeof project === 'string' ? { id, project } : null;
}

/**
 * Ce que le choix d'une ligne de la palette écrit dans l'entrée d'historique qu'il ouvre (`state` de `navigate`, voir `CommandPalette`) : c'est elle qui a ouvert le panneau du ticket, et ni l'élément qui avait le focus quand
 * la palette s'est ouverte, ni son champ, ni sa liste n'en sont l'origine (voir `panelOpener`).
 */
export const openedFromPalette: { openedFromPalette: true } = { openedFromPalette: true };

/** Le choix d'une ligne de la palette a-t-il ouvert l'entrée que `state` décrit (voir `openedFromPalette`) ? L'état d'une entrée vient du navigateur : on ne se fie pas à sa forme. */
function openedByPalette(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'openedFromPalette' in state && state.openedFromPalette === true;
}

/**
 * L'élément que le panneau d'un ticket retient pour lui rendre le focus à sa fermeture (voir `restoreFocus`, dans `IssuePanel`) : celui qui a le focus à son ouverture, le lien de la carte quand c'est elle qui l'ouvre, puis la
 * dernière carte cliquée tant qu'il reste ouvert ; aucun quand c'est un choix de la palette qui l'ouvre.
 *
 * Chromium et Firefox donnent le focus au lien qu'on clique. WebKit ne le fait pas (ni à un lien qu'on touche), et son clic retire le focus à ce qui l'avait : il ne le laisse qu'à un ancêtre du lien qu'il focalise à la
 * souris (un champ, un `tabindex`). Le corps de la page a donc le focus à l'ouverture du panneau, ou le contenu principal quand l'application le lui avait donné (voir `focusContainer`) ; le panneau le retiendrait, et à sa
 * fermeture le focus irait au contenu principal, non à la carte. Mesuré le 2026-11-06 sur l'application construite (bdesk-38k.72), Playwright WebKit 18.2 : le corps de la page est l'élément actif de `mouseup` à l'ouverture du
 * panneau, que rien n'ait eu le focus ou que ce soit une carte (`j`) ou un lien de la barre latérale, dont le focus est retiré à la fin de `mousedown` ; le contenu principal, lui, le garde. Chromium 156 et Firefox 137 donnent le
 * focus au lien à la fin de `mousedown`. Un toucher (`hasTouch`) enchaîne les mêmes événements, avec le même résultat.
 *
 * Le lien de la carte écrit donc sa carte dans l'entrée d'historique qu'il ouvre (`openedFromCard`), et cette carte, dans son Projet, est l'origine quand :
 * - rien n'a le focus (`focusIsAdrift`), ou ce qui l'a contient la carte (le contenu principal) : c'est ce qu'un clic laisse dans WebKit. Si un autre élément l'a (au clavier, le lien ; ailleurs, ce que l'utilisateur a
 *   choisi), il garde l'origine : celle d'avant, qui est cet élément à l'ouverture, comme avant (voir `previous`) ;
 * - le panneau est ouvert par ce lien, et non retrouvé par « Retour » ou « Avancer » (`revisited`, un `POP` : l'entrée garde la carte sans qu'on l'ait cliquée de nouveau) ;
 * - la carte est dans le document (celle qu'on vient de cliquer y est ; cachée à la fermeture, dans une colonne que l'écran étroit n'affiche pas, `focusElement` la refuse et le panneau rend le focus au contenu principal).
 * Sinon, c'est `previous`.
 *
 * `previous` : l'origine que le panneau a déjà retenue, quand il est resté monté et qu'une autre carte en a remplacé l'entrée d'historique (`replace` : le panneau montre alors l'autre ticket sans être remonté) ; sans elle (`undefined`,
 * le panneau s'ouvre), l'élément qui a le focus, ce qu'il retient à son ouverture. Le lien de la carte écrit sa carte à chaque clic : la dernière prend la place de l'origine, comme la première l'a prise. Un lien du panneau (de ticket à
 * ticket) remplace ou ajoute une entrée sans carte : l'origine reste celle d'avant.
 *
 * **Un choix de la palette n'a pas d'origine** (bdesk-38k.76). Il écrit `openedFromPalette`, et le panneau qu'il ouvre ne retient rien (`null` : à la fermeture, le contenu principal, comme pour une adresse collée), quel que
 * soit l'élément qui a le focus au premier rendu du panneau. Ce focus dépend du minutage, non de ce que l'utilisateur a fait : le choix ferme la palette, qui reste montée le temps de son animation de sortie (90 ms) puis rend le focus à
 * l'élément d'où elle s'était ouverte, et ouvre le panneau, dont le rendu précède ou suit ce retrait. Rendu pendant que la palette est là, il retient son champ ou sa liste, que son retrait emporte : le contenu principal. Rendu après (un
 * appareil lent, une page lourde : Firefox à 375 px, vu sur HEAD), il retient la carte ou le bouton d'où elle s'était ouverte : le même geste finissait tantôt sur l'un, tantôt sur l'autre. Le panneau n'est l'ouvrage d'aucun de ces
 * éléments : la palette leur a rendu le focus parce qu'elle se fermait, non parce qu'ils ouvraient un ticket, et ce qui l'a invoqué, la ligne choisie, est retiré avec elle. Sans invoqueur, le contenu principal est le repli de l'application
 * partout (`focus.ts`, la palette, l'aide, une adresse collée) ; c'est aussi l'issue ordinaire sur HEAD, celle que bdesk-38k.32 a voulue. Un panneau resté ouvert (`previous` défini) garde l'origine qu'il avait, que la palette n'a pas changée.
 *
 * Les autres chemins qui ouvrent le panneau n'écrivent aucune carte : une ligne de la page Epics, un lien des Métriques (la pastille d'Epic d'une carte mène à la page Epics, non au panneau). Leur origine reste l'élément qui a le
 * focus à l'ouverture, comme avant, dans tous les moteurs. Seul le lien d'une carte reste dans la page quand le panneau s'ouvre, le tableau étant la route mère du panneau : les autres ne sont plus là à la fermeture.
 */
export function panelOpener(state: unknown, revisited: boolean, previous?: Element | null): Element | null {
  const opening = previous === undefined;
  const held = opening ? document.activeElement : previous;
  if (!revisited && openedByPalette(state)) return opening ? null : held;
  const active = document.activeElement;
  const card = revisited ? null : openingCard(state);
  const link = card ? cardLink(document.body, card.id, card.project) : undefined;
  return link && (focusIsAdrift() || active?.contains(link)) ? link : held;
}

/**
 * Veille le tableau (`rootRef`) tant qu'il est monté : le focus qu'une carte tient ne tombe pas sur le corps de la page quand un commit la change de colonne (voir `focusCardOrZone`).
 * C'est la veille de `keepFocusInContent` (`watchContent`, dans `lib/zoneFocus.ts`) et ses garanties : seul le focus qu'un élément du tableau a *maintenant* est rendu, jamais celui que l'utilisateur
 * a mis ailleurs (la barre latérale, le panneau d'un ticket, un clic dans le vide). Quand c'est le tableau lui-même qui part (une autre page), la veille s'arrête sans rien rendre : où va le focus
 * d'une navigation n'est pas son affaire.
 */
export function useKeepFocusInBoard(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const board = rootRef.current;
    return board ? watchContent(board, focusCardOrZone) : undefined;
  }, [rootRef]);
}
