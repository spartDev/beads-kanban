import { useLayoutEffect, type RefObject } from 'react';

const ROWS = '[cmdk-list] [cmdk-item]';

/** La ligne que cmdk choisit d'office : la première qui n'est pas désactivée (son `selectFirstItem`). */
const FIRST_ROW = `${ROWS}:not([aria-disabled="true"])`;

/**
 * Une ligne est sélectionnée dès qu'il y en a une à sélectionner, et la sélection désigne toujours une ligne présente. cmdk ne le garantit
 * pas : il ne choisit une ligne d'office qu'à la frappe, quand une ligne se monte alors qu'il n'a aucune valeur, ou quand la ligne qu'il montre
 * sélectionnée disparaît. La palette pilote sa valeur (voir `useQuietRow`), et il ne revoit rien quand elle change :
 * - le survol d'une ligne a une priorité « continue » : tant que son rendu n'a pas eu lieu, un clic ou un rafraîchissement de la liste (le
 *   clic sur « Chercher … dans tous les Projets », qui retire cette ligne) l'embarque dans son propre rendu. La valeur du survol arrive alors
 *   dans le rendu même qui retire la ligne : cmdk ne l'a pas vue disparaître sélectionnée, il ne choisit plus rien ;
 * - la ligne de repli tenue en retrait (`quiet`) est la seule de la liste, puis les tickets arrivent sans correspondance : elle ne
 *   l'est plus (la valeur redevient vide), mais aucune ligne ne se monte, et cmdk ne la choisit pas ;
 * - plusieurs lignes disparaissent dans le même rendu, dont la sélectionnée : cmdk ne planifie qu'un contrôle de disparition par rendu
 *   (la file n'a qu'une place par type de tâche), celui de la dernière ligne retirée, qui ne trouve plus la sélectionnée partie avant elle.
 * Aucune ligne n'est alors sélectionnée, et Entrée ne fait rien.
 *
 * On fait ce que cmdk aurait fait : la première ligne activable ; aucune s'il n'y en a pas encore (la valeur est vide, et cmdk choisira la
 * première qui arrivera), ou tant que la seule ligne est tenue en retrait.
 *
 * `root` est l'élément racine de `Command`. Comme `useQuietRow`, cela lit le DOM de cmdk 1.1.1 (`data-value` de chaque ligne).
 */
export function useSelectionGuard({
  root,
  selected,
  quiet,
  select,
}: {
  root: RefObject<HTMLElement | null>;
  /** La valeur sélectionnée, telle que la palette la tient (vide : aucune). */
  selected: string;
  /** La seule ligne est tenue en retrait : elle n'est pas choisie d'office. */
  quiet: boolean;
  select: (value: string) => void;
}): void {
  // Après chaque rendu : la sélection peut devenir périmée sans changer d'elle-même, quand cmdk laisse partir sa ligne sans la remplacer. Un
  // effet de mise en page, pour qu'aucune image ne s'affiche sans ligne sélectionnée : sa mise à jour d'état part en priorité synchrone et
  // est rendue dans la même tâche. Passive, elle le serait en priorité normale, dans une tâche à part quand rien d'autre n'est en attente
  // (`useSelectionGuard.test.tsx` le fixe).
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    if (selected !== '' && [...element.querySelectorAll(ROWS)].some((row) => row.getAttribute('data-value') === selected)) return;
    const wanted = quiet ? '' : (element.querySelector(FIRST_ROW)?.getAttribute('data-value') ?? '');
    if (wanted !== selected) select(wanted);
  });
}
