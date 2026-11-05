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

/** Les types de lien qui font un Abandon : les seuls dont le lecteur de l'historique relève la date de pose (`AbandonLink.createdAt`). */
export const ABANDON_LINK_TYPES: readonly string[] = [...CAUSES.keys()];

/** Ce que la règle lit d'un lien du ticket : son type, sa cible, quand il est apparu et, s'il l'a été, retiré ; quand sa ligne a été écrite. */
export interface AbandonLink {
  type: string;
  target: string;
  /**
   * L'instant où le lien est apparu : le commit de l'historique qui le voit le premier (les métriques) ou, faute de commit à lire,
   * le `created_at` de sa ligne (le kanban, qui ne lit que l'état présent).
   */
  addedAt: Date;
  /** Le `created_at` de la ligne du lien, que bd écrit à la pose, quand la lecture le donne : il départage les liens apparus au même instant. */
  createdAt?: Date;
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
 * c'est pour cela qu'il a été abandonné. Le premier posé est celui qui apparaît le premier (`addedAt`) ; à égalité, celui dont la
 * ligne a été écrite le premier (`createdAt` ; un lien dont la ligne ne le dit pas passe avant ceux qui l'ont) ; à égalité
 * encore, la plus petite cible, comme dans l'historique des liens. Le type du ticket (une Epic n'est jamais un Abandon) et son
 * état (fermé) sont à l'appelant.
 *
 * Les égalités d'`addedAt` n'ont rien de rare : un seul commit réunit des liens posés à des moments différents quand bd valide par
 * lots (l'auto-commit `batch`), qu'un import les écrit ensemble ou qu'un historique a été aplati. L'historique ne dit plus alors
 * dans quel ordre ils ont été posés ; le `created_at` de leur ligne, lui, le dit. Il ne sert qu'à ordonner deux liens d'un même
 * ticket : il n'est ni affiché ni mesuré.
 *
 * Limite : le kanban et les métriques ne lisent pas les mêmes dates. Le kanban ne voit aucun commit : il ordonne par `created_at`
 * seul. Les métriques ordonnent d'abord par commit (UTC, à la milliseconde), puis par `created_at`. Elles ne divergent donc que
 * si deux liens du même ticket ont leurs `created_at` dans un autre ordre que leurs commits :
 * - posés dans la même seconde, par deux commits : le `created_at` n'a pas de fraction, les métriques suivent les commits et le
 *   kanban la plus petite cible ;
 * - l'un posé par une ancienne version de bd, l'autre par le bd actuel, à moins de l'écart de fuseau : le `created_at` des anciennes
 *   lignes est en heure locale, celui des lignes que bd écrit aujourd'hui en UTC. Les commits sont en UTC ; le kanban, qui compare
 *   ces deux fuseaux sans le savoir, peut inverser les liens.
 * Aucun ticket réel ne porte aujourd'hui deux liens d'Abandon.
 */
export function abandonOf(links: readonly AbandonLink[]): Abandon | undefined {
  const candidates = links.flatMap((link) => {
    const cause = CAUSES.get(link.type);
    return cause && !link.removedAt
      ? [{ cause, of: link.target, at: link.addedAt.getTime(), created: link.createdAt?.getTime() ?? 0 }]
      : [];
  });
  candidates.sort((a, b) => a.at - b.at || a.created - b.created || a.of.localeCompare(b.of));
  const first = candidates[0];
  return first ? { cause: first.cause, of: first.of } : undefined;
}
