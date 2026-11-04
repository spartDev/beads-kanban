import { useCallback, useEffect, useRef } from 'react';

/**
 * Entrée pressée avant que les tickets soient là : aucune ligne n'est sélectionnée, la touche est sans effet. On retient la saisie (la
 * fonction renvoyée), et quand les tickets arrivent on ouvre celui dont l'id est exactement cette saisie, s'il est le seul : ce que la
 * touche aurait fait un instant plus tard. Rien d'autre ne s'ouvre ainsi.
 *
 * La demande ne vaut que tant qu'aucune ligne n'est sélectionnée : Entrée aurait alors pris cette ligne, et non le ticket tapé. Elle tombe
 * donc dès qu'une ligne est sélectionnée, par l'utilisateur (flèche, Début/Fin, survol, clic) ou d'office ; dès que la saisie change ; dès
 * que la palette se ferme (même encore montée le temps de son animation de sortie) ; dès que le ticket s'ouvre ; ou quand tous les
 * tickets sont là sans lui : un ticket qui prendrait cet id plus tard ne s'ouvre pas tout seul.
 */
export function usePendingEnter({
  open,
  search,
  selected,
  pending,
  targetPath,
  go,
}: {
  open: boolean;
  /** La saisie, sans les espaces de bord. */
  search: string;
  /** La valeur de la ligne sélectionnée (vide : aucune). */
  selected: string;
  /** Les tickets ne sont pas tous là. */
  pending: boolean;
  /** Le ticket (ou l'Epic) dont l'id est exactement la saisie, parmi les lignes listées ; absent s'il n'y en a aucun ou plusieurs. */
  targetPath: string | undefined;
  go: (to: string) => void;
}): () => void {
  // La saisie sur laquelle Entrée n'avait rien à prendre. Un ref : elle ne change rien à l'affichage, seulement à ce que fait l'arrivée des tickets.
  const held = useRef<string | null>(null);

  useEffect(() => {
    const typed = held.current;
    if (typed === null) return;
    if (!open || typed !== search) {
      held.current = null; // la palette se ferme, ou la saisie a changé : ce n'est plus la même demande
    } else if (targetPath) {
      // Avant le test de la sélection : à l'arrivée des tickets, cmdk sélectionne d'office la première ligne dans le même rendu.
      held.current = null;
      go(targetPath);
    } else if (selected !== '' || !pending) {
      held.current = null; // une ligne est sélectionnée (Entrée prendrait celle-là), ou les tickets sont là sans le ticket tapé
    }
  }, [open, search, selected, pending, targetPath, go]);

  return useCallback(() => {
    if (pending && search) held.current = search;
  }, [pending, search]);
}
