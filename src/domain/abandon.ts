/**
 * L'Abandon : un ticket fermé que l'un de ses liens déclare doublon d'un autre ticket, ou remplacé par lui. `abandonOf` est la
 * règle : quels liens font un Abandon, pour quelle cause, et lequel prime quand il y en a deux. Les métriques (`analyzeFlow`, qui
 * lit l'historique des liens) et le kanban (`buildIssues`, qui lit l'état présent) l'appliquent chacun à leurs liens : d'où le même
 * Abandon, avec la même cause, dans la chronologie d'un ticket, sur sa carte et dans les métriques.
 */

export type AbandonCause = 'duplicate' | 'superseded';

/** Les liens que `bd duplicate` et `bd supersede` posent sur le ticket abandonné lui-même ; leur cible est l'autre ticket. */
const CAUSES = new Map<string, AbandonCause>([
  ['duplicates', 'duplicate'],
  ['supersedes', 'superseded'],
]);

/** Ce que la règle lit d'un lien du ticket : son type, sa cible, quand il a été posé et, s'il l'a été, retiré. */
export interface AbandonLink {
  type: string;
  target: string;
  addedAt: Date;
  removedAt?: Date;
}

export interface Abandon {
  cause: AbandonCause;
  /** Le ticket dont il est le doublon, ou qui le remplace : la cible du lien. Pas forcément un ticket du Projet. */
  of: string;
}

/**
 * L'Abandon que disent les liens d'un ticket fermé, ou `undefined` : c'est une Livraison. `links` : tous les liens du ticket (les
 * autres types que doublon et remplacé ne comptent pas), dans n'importe quel ordre ; la liste n'est pas modifiée. La raison de
 * fermeture n'y est pour rien. Un lien retiré ne compte plus. La cible n'est pas vérifiée : un ticket d'un autre Projet, ou
 * supprimé, reste ce qu'il est.
 *
 * Un ticket peut porter les deux liens (marqué remplacé, puis doublon). Sa cause est alors celle du premier lien posé :
 * c'est pour cela qu'il a été abandonné. À instants égaux, la plus petite cible l'emporte, comme dans l'historique des liens.
 * Le type du ticket (une Epic n'est jamais un Abandon) et son état (fermé) sont à l'appelant.
 */
export function abandonOf(links: readonly AbandonLink[]): Abandon | undefined {
  const candidates = links.flatMap((link) => {
    const cause = CAUSES.get(link.type);
    return cause && !link.removedAt ? [{ cause, of: link.target, at: link.addedAt.getTime() }] : [];
  });
  candidates.sort((a, b) => a.at - b.at || a.of.localeCompare(b.of));
  const first = candidates[0];
  return first ? { cause: first.cause, of: first.of } : undefined;
}
