import { useEffect, useRef, type RefObject } from 'react';
import { useShortcuts } from '../shortcuts/ShortcutsProvider';
import { COLUMN_IDS, type ColumnId, type Lane } from './columns';

const GROUP = 'Kanban';

/** Les identifiants des cartes de chaque colonne, dans l'ordre où elles s'affichent. */
export type Lanes = Record<Lane, readonly string[]>;

/**
 * La colonne la plus proche de `from` dans le sens `direction` qui a des cartes : le curseur saute les colonnes
 * vides et ne s'arrête jamais sur du vide. Sans point de départ (`from` nul), elle part du bord du tableau : la première
 * colonne qui a des cartes dans le sens « suivante », la dernière dans le sens « précédente ». Indéfinie au bout du tableau.
 */
export function adjacentColumn(lanes: Lanes, from: ColumnId | null, direction: 1 | -1): ColumnId | undefined {
  // Sans point de départ, on part d'avant la première colonne (sens suivant) ou d'après la dernière (sens précédent).
  const start = from === null ? (direction === 1 ? -1 : COLUMN_IDS.length) : COLUMN_IDS.indexOf(from);
  for (let i = start + direction; i >= 0 && i < COLUMN_IDS.length; i += direction) {
    const id = COLUMN_IDS[i];
    if (id !== undefined && lanes[id].length > 0) return id;
  }
  return undefined;
}

interface Focused {
  id: string;
  lane: Lane;
}

/** La carte qui a le focus : la sélection du clavier est le focus lui-même, lecteurs d'écran compris. */
function focusedCard(root: HTMLElement | null): Focused | null {
  const active = document.activeElement;
  if (!root || !(active instanceof HTMLElement) || !root.contains(active)) return null;
  const { cardId, column } = active.closest<HTMLElement>('[data-card-id]')?.dataset ?? {};
  return cardId && column ? { id: cardId, lane: column as Lane } : null;
}

/**
 * Le lien de la carte `id` dans `root`. Avec `project`, seulement celui de la carte de ce Projet (`data-card-project`) : les identifiants de tickets ne sont uniques que dans un Projet. Sans lui, la
 * première carte de cet identifiant : le tableau, que les raccourcis parcourent, n'est jamais que celui d'un Projet.
 */
export const cardLink = (root: Element | null, id: string, project?: string | null): HTMLAnchorElement | undefined =>
  [...(root?.querySelectorAll<HTMLAnchorElement>('a[data-card-link]') ?? [])].find(
    (link) => link.dataset.cardLink === id && (project === undefined || link.closest('[data-card-id]')?.getAttribute('data-card-project') === project),
  );

/**
 * Le panneau est-il trop étroit pour les cinq colonnes ? Alors une seule est affichée, avec le sélecteur de colonne ;
 * dès que le panneau est assez large, le sélecteur disparaît et les cinq colonnes s'affichent (`ColumnSelector`, `Board`).
 * C'est le navigateur qui tranche, par une requête de conteneur : on lit son verdict (le sélecteur est-il affiché ?) au
 * lieu de répéter la mesure de 60 rem. Sans sélecteur à lire, on suppose le panneau étroit, la disposition d'origine.
 */
function isNarrow(root: HTMLElement | null): boolean {
  const selector = root?.querySelector('[data-column-selector]');
  return !(selector instanceof HTMLElement) || getComputedStyle(selector).display !== 'none';
}

/**
 * Raccourcis du kanban, branchés sur le registre de l'application (donc listés dans l'aide « ? ») :
 *
 *   j / k             carte suivante / précédente de la colonne
 *   h ou ←, l ou →    colonne précédente / suivante qui a des cartes, à la même hauteur ou au plus près
 *   Entrée            ouvre le ticket sélectionné
 *   Échap             désélectionne (et ne prend la touche que s'il y a une carte sélectionnée)
 *
 * La sélection est le focus du navigateur : les lecteurs d'écran annoncent la carte, Tab continue depuis elle. Sans
 * sélection, « j » prend la première carte de la colonne affichée, « k » la dernière.
 *
 * Sans carte sélectionnée, « h » et « l » dépendent de la disposition. Panneau étroit (une colonne à la fois), ils partent de
 * la colonne affichée, comme « j » et « k ». Panneau large (les cinq colonnes), aucune n'est « la » colonne courante : le
 * choix du mobile (celui de l'ouverture, ou `?col=`) n'y compte pas. « l » prend la première colonne qui a des cartes et
 * « h » la dernière, comme « j » prend la première carte et « k » la dernière ; la carte est la première de la colonne.
 * Sur panneau large, l'adresse n'est jamais touchée : `?col=` ne sert qu'au mobile.
 *
 * Le registre cède Entrée et les flèches à l'élément qui a le focus quand il les utilise déjà (`usesKeyNatively`) :
 * Entrée sur un bouton ou un lien qui n'est pas une carte reste au bouton ou au lien ; les flèches restent à un groupe
 * de boutons radio, à une liste ou à un onglet. La carte sélectionnée est elle-même un lien : Entrée l'ouvre par le
 * navigateur, sans que le kanban ait à le faire. Le raccourci n'est enregistré que pour figurer dans l'aide, et pour
 * ouvrir la carte quand le focus est dans la carte sans être sur son lien.
 */
export function useBoardShortcuts({
  rootRef,
  lanes,
  column,
  onColumn,
}: {
  rootRef: RefObject<HTMLElement | null>;
  lanes: Lanes;
  /** La colonne affichée : celle où commence la navigation tant qu'aucune carte n'a le focus. */
  column: ColumnId;
  onColumn: (column: ColumnId) => void;
}) {
  // Sur mobile, la colonne visée n'est affichée qu'une fois l'adresse à jour : le focus attend ce rendu.
  const pending = useRef<{ id: string; column: ColumnId } | null>(null);

  /** Donne le focus à une carte et la fait apparaître ; faux si elle n'est pas affichée (colonne cachée). */
  const focusCard = (id: string): boolean => {
    const link = cardLink(rootRef.current, id);
    if (!link) return false;
    link.focus({ preventScroll: true });
    if (document.activeElement !== link) return false;
    link.closest('li')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
  };

  useEffect(() => {
    const wanted = pending.current;
    if (wanted && wanted.column === column) {
      pending.current = null;
      focusCard(wanted.id);
    }
  });

  const step = (direction: 1 | -1) => {
    const focused = focusedCard(rootRef.current);
    const ids = lanes[focused?.lane ?? column];
    if (ids.length === 0) return;
    const index = focused ? ids.indexOf(focused.id) : direction === 1 ? -1 : ids.length;
    const next = ids[Math.min(Math.max(index + direction, 0), ids.length - 1)];
    if (next !== undefined) focusCard(next);
  };

  const moveColumn = (direction: 1 | -1) => {
    const root = rootRef.current;
    const focused = focusedCard(root);
    const lane = focused?.lane;
    // Le tiroir « En pause » n'est pas une colonne : on n'en sort pas à l'horizontale.
    if (lane === 'paused') return;
    const narrow = isNarrow(root);
    // D'où l'on part : de la carte qui a le focus ; sans carte, de la colonne affichée quand il n'y en a qu'une, sinon du
    // bord du tableau (aucune des cinq n'est alors « la » colonne courante).
    const target = adjacentColumn(lanes, lane ?? (narrow ? column : null), direction);
    if (!target) return;
    const ids = lanes[target];
    const row = focused && lane ? Math.max(lanes[lane].indexOf(focused.id), 0) : 0;
    const next = ids[Math.min(row, ids.length - 1)];
    pending.current = null;
    if (narrow) {
      // Une seule colonne est affichée : la cible apparaît quand l'adresse (`?col=`) la retient, le focus l'y rejoint.
      onColumn(target);
      if (next !== undefined && !focusCard(next)) pending.current = { id: next, column: target };
    } else if (next !== undefined) {
      // Les cinq colonnes sont affichées : la carte est déjà là, l'adresse n'a rien à retenir.
      focusCard(next);
    }
  };

  const openSelected = () => {
    const focused = focusedCard(rootRef.current);
    if (focused) cardLink(rootRef.current, focused.id)?.click();
  };

  // Le registre ne passe ici que s'il y a une carte sélectionnée (`when`) : sinon Échap reste au navigateur.
  const hasSelection = () => focusedCard(rootRef.current) !== null;
  const deselect = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  useShortcuts([
    { id: 'kanban.next', keys: 'j', label: 'Ticket suivant', group: GROUP, run: () => step(1) },
    { id: 'kanban.previous', keys: 'k', label: 'Ticket précédent', group: GROUP, run: () => step(-1) },
    { id: 'kanban.column.previous', keys: 'h', alternateKeys: ['arrowleft'], label: 'Colonne précédente', group: GROUP, run: () => moveColumn(-1) },
    { id: 'kanban.column.next', keys: 'l', alternateKeys: ['arrowright'], label: 'Colonne suivante', group: GROUP, run: () => moveColumn(1) },
    { id: 'kanban.open', keys: 'enter', label: 'Ouvrir le ticket sélectionné', group: GROUP, run: openSelected },
    { id: 'kanban.deselect', keys: 'escape', label: 'Désélectionner le ticket', group: GROUP, when: hasSelection, run: deselect },
  ]);
}
