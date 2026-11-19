import type { TicketFlow } from './flow';

/**
 * Livraison saine (CONTEXT.md) : une Livraison sans Bug d'origine, qu'aucune Réouverture n'a précédée. Livrée du premier coup, et rien n'en est revenu.
 *
 * - La Livraison est celle d'`analyzeFlow` (`outcome.kind === 'delivered'`) : ce qui change sa règle change celle-ci.
 * - Une Réouverture la précède dès que le ticket a été fermé puis rouvert, quand que ce soit (`TicketFlow.reopenings`) : la Livraison est datée de la
 *   dernière clôture, et la clôture que la Réouverture a annulée n'en était pas une.
 * - `originBugs` sont ses Bugs d'origine (`FailureAnalysis.originBugs`), sans limite de temps : un bug trouvé des mois plus tard la rend malsaine après
 *   coup, comme il la met en échec dans le Taux d'échec.
 * - Une Prise rendue ne compte pas : elle précède la Livraison, et la chaîne l'a arrêtée.
 */
export function isSoundDelivery(flow: Pick<TicketFlow, 'outcome' | 'reopenings'>, originBugs: readonly unknown[]): boolean {
  return flow.outcome.kind === 'delivered' && flow.reopenings === 0 && originBugs.length === 0;
}
