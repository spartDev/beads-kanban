/**
 * Les colonnes du kanban et la règle, unique, qui y range un ticket : statut × Blocage. Du code pur, sans dépendance, que
 * le tableau (`src/web/kanban/columns.ts`, qui l'applique à l'état présent d'un ticket) et le CFD (`timeline.ts`, qui
 * l'applique à chaque instant de son historique) importent tous deux : ils ne peuvent plus diverger.
 *
 * Reste propre au tableau ce que le CFD n'a pas : la fenêtre de Terminé (le CFD cumule tous les tickets fermés), le tiroir
 * « En pause » (le CFD le laisse hors des colonnes) et le tri. Reste propre à chacun, aussi, la façon de savoir qu'un
 * ticket est en Blocage : l'historique des dépendances pour le CFD, `blockedBy` pour le tableau.
 */
import type { DeclaredStatuses, HandoffStatus } from '../shared/api';
import { HANDOFF_STATUSES, isDeclaredWip } from './statuses';

/**
 * Les colonnes de tout Projet, dans l'ordre du flux (« En pause » n'en est pas une : c'est ce qui n'est dans aucune). Celles des Statuts de
 * relais s'y ajoutent pour les Projets qui en ont (`columnsOf`).
 *
 * Rien que les identifiants : les libellés, pictogrammes et règles écrites des colonnes sont des `ColumnMeta`, dans le
 * `COLUMNS` de `src/web/kanban/meta.ts` (même nom, même ordre, autre contenu). Côté tableau, ces identifiants sont
 * `COLUMN_IDS` (`src/web/kanban/columns.ts`).
 */
export const COLUMNS = ['backlog', 'ready', 'inProgress', 'blocked', 'done'] as const;

/** Une colonne de tout Projet. */
export type BaseColumn = (typeof COLUMNS)[number];

/** Les colonnes des Statuts de relais, dans l'ordre de `HANDOFF_STATUSES` : En relecture, En intégration, À valider. */
export const HANDOFF_COLUMNS = ['inReview', 'inIntegration', 'awaitingHuman'] as const;

export type HandoffColumn = (typeof HANDOFF_COLUMNS)[number];

export type Column = BaseColumn | HandoffColumn;

/** La colonne de chaque Statut de relais. */
export const HANDOFF_COLUMN: Readonly<Record<HandoffStatus, HandoffColumn>> = {
  in_review: 'inReview',
  in_integration: 'inIntegration',
  awaiting_human: 'awaitingHuman',
};

/**
 * Les colonnes d'un Projet, dans l'ordre du flux : celles de tout Projet et, entre En cours et Bloqué, celles de ses Statuts de relais visibles
 * (`visibleHandoffStatuses`, `statuses.ts`), dans leur ordre. Le relais suit le développement ; Bloqué reste la dernière colonne avant Terminé,
 * puisqu'il reçoit tout statut de travail en Blocage, de relais compris. Sans Statut de relais, les cinq colonnes d'avant, dans le même ordre.
 */
export function columnsOf(handoff: readonly HandoffStatus[]): Column[] {
  const relay = HANDOFF_STATUSES.filter((status) => handoff.includes(status)).map((status) => HANDOFF_COLUMN[status]);
  return ['backlog', 'ready', 'inProgress', ...relay, 'blocked', 'done'];
}

/**
 * Toutes les colonnes qu'un Projet peut avoir, dans l'ordre du flux : celles d'un Projet qui a les trois Statuts de relais. Le tableau et la page Epic
 * les rangent toutes ; ils ne montrent que celles du Projet (`columnsOf`), ou celles qui ont des tickets.
 */
export const ALL_COLUMNS: readonly Column[] = columnsOf(HANDOFF_STATUSES);

/**
 * La colonne d'un ticket selon son statut et son Blocage ; `null` : « En pause », hors des colonnes.
 *
 *   closed                       Terminé, en Blocage ou non
 *   blocked                      Bloqué
 *   in_progress, hooked          En cours ; Bloqué en Blocage
 *   in_review                    En relecture ; Bloqué en Blocage
 *   in_integration               En intégration ; Bloqué en Blocage
 *   awaiting_human               À valider ; Bloqué en Blocage
 *   open                         Prêt ; Backlog en Blocage
 *   autre, déclaré de catégorie  En cours ; Bloqué en Blocage
 *   wip par le Projet
 *   deferred, pinned, autre      En pause, en Blocage ou non (un statut inconnu de beads n'est pas perdu pour autant)
 *
 * Les Statuts de relais se reconnaissent à leur nom, déclarés ou non (ADR 0007) : `declared` (obligatoire, voir `isWork`) ne sert qu'aux autres
 * statuts personnalisés, dont seule la catégorie `wip` donne une colonne. Un ticket est donc dans En cours, une colonne de relais ou Bloqué
 * exactement quand il est dans un statut de travail (`isWork`, `flow.ts`) : ce que comptent le Cycle Time et le WIP.
 *
 * `blocked` : le ticket dépend d'au moins un ticket non fermé (dépendance `blocks` en suspens, voir « Blocage » dans
 * CONTEXT.md). Le statut bloqué se lit dans `status` : que l'appelant le compte ou non dans `blocked` ne change rien.
 * `status` est indéfini avant la création du ticket.
 */
export function columnFor(status: string | undefined, blocked: boolean, declared: DeclaredStatuses): Column | null {
  switch (status) {
    case 'closed':
      return 'done';
    case 'blocked':
      return 'blocked';
    case 'in_progress':
    case 'hooked':
      return blocked ? 'blocked' : 'inProgress';
    case 'in_review':
    case 'in_integration':
    case 'awaiting_human':
      return blocked ? 'blocked' : HANDOFF_COLUMN[status];
    case 'open':
      return blocked ? 'backlog' : 'ready';
    case undefined:
      return null;
    default:
      if (!isDeclaredWip(status, declared)) return null;
      return blocked ? 'blocked' : 'inProgress';
  }
}
