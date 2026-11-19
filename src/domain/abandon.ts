/**
 * Ce qu'est un ticket fermé (hors Epic) : une Livraison, un Abandon ou un Renoncement. `closureOf` est la règle, et la seule : les
 * métriques (`analyzeFlow`, qui lit l'historique des liens) et le kanban (`buildIssues`, qui lit l'état présent) l'appliquent chacun
 * à ce qu'ils lisent du ticket, d'où la même issue dans la chronologie d'un ticket, sur sa carte, dans l'avancement de son Epic et
 * dans les métriques.
 *
 * L'Abandon : un ticket fermé que l'un de ses liens déclare doublon d'un autre ticket, ou remplacé par lui. `abandonOf` dit quels
 * liens font un Abandon, pour quelle cause, et lequel prime quand il y en a deux.
 *
 * Le Renoncement (ADR 0008) : un ticket fermé qui porte le label `declined` au Dernier commit. L'utilisateur a décidé de ne pas
 * faire le travail : ce n'est pas une Livraison, et pas un Abandon non plus (personne ne le fera ailleurs).
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

/**
 * Le label qui marque un Renoncement, posé à la clôture du ticket (ADR 0008). Il se lit au Dernier commit, pas dans l'historique : posé
 * plus tard, il fait de la dernière clôture un Renoncement après coup ; retiré, il la rend à la Livraison. Les lecteurs Dolt ne relèvent
 * que ce label-là (`reader.ts`, `history.ts`).
 */
export const DECLINED_LABEL = 'declined';

/** Ce qu'est un ticket fermé (hors Epic) : une Livraison, un Abandon (sa cause et l'autre ticket) ou un Renoncement. */
export type Closure = { kind: 'delivered' } | ({ kind: 'abandoned' } & Abandon) | { kind: 'declined' };

/**
 * La règle de clôture : ce qu'est un ticket fermé, d'après ses liens (`links`, comme `abandonOf` les lit) et ses labels au Dernier
 * commit (`labels`, dans n'importe quel ordre ; seul `DECLINED_LABEL` compte, écrit tel quel). La raison de fermeture n'y est pour rien,
 * ni dans un sens ni dans l'autre : un « won't fix » sans label reste une Livraison. Le type du ticket (une Epic n'est jamais une
 * Livraison) et son état (fermé) sont à l'appelant.
 *
 * Un lien d'Abandon l'emporte sur le label : il dit que le travail existe ailleurs (doublon, remplacé), ce que le label ne contredit pas,
 * et l'Abandon garde ainsi sa cause, sa cible et le Taux d'abandon qui le compte. Le label ne fait donc un Renoncement que d'un ticket
 * qui serait sinon une Livraison.
 */
export function closureOf(links: readonly AbandonLink[], labels: readonly string[]): Closure {
  const abandon = abandonOf(links);
  if (abandon) return { kind: 'abandoned', ...abandon };
  return labels.includes(DECLINED_LABEL) ? { kind: 'declined' } : { kind: 'delivered' };
}
