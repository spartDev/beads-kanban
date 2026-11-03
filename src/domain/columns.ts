/**
 * Les colonnes du kanban et la règle, unique, qui y range un ticket : statut × Blocage. Du code pur, sans dépendance, que
 * le tableau (`src/web/kanban/columns.ts`, qui l'applique à l'état présent d'un ticket) et le CFD (`timeline.ts`, qui
 * l'applique à chaque instant de son historique) importent tous deux : ils ne peuvent plus diverger.
 *
 * Reste propre au tableau ce que le CFD n'a pas : la fenêtre de Terminé (le CFD cumule tous les tickets fermés), le tiroir
 * « En pause » (le CFD le laisse hors des colonnes) et le tri. Reste propre à chacun, aussi, la façon de savoir qu'un
 * ticket est en Blocage : l'historique des dépendances pour le CFD, `blockedBy` pour le tableau.
 */

/**
 * Les identifiants des colonnes, dans l'ordre du flux (« En pause » n'en est pas une : c'est ce qui n'est dans aucune).
 *
 * Rien que les identifiants : les libellés, pictogrammes et règles écrites des colonnes sont des `ColumnMeta`, dans le
 * `COLUMNS` de `src/web/kanban/meta.ts` (même nom, même ordre, autre contenu). Côté tableau, ces identifiants sont
 * `COLUMN_IDS` (`src/web/kanban/columns.ts`).
 */
export const COLUMNS = ['backlog', 'ready', 'inProgress', 'blocked', 'done'] as const;

export type Column = (typeof COLUMNS)[number];

/**
 * La colonne d'un ticket selon son statut et son Blocage ; `null` : « En pause », hors des colonnes.
 *
 *   closed                       Terminé, en Blocage ou non
 *   blocked                      Bloqué
 *   in_progress, hooked          En cours ; Bloqué en Blocage
 *   open                         Prêt ; Backlog en Blocage
 *   deferred, pinned, autre      En pause, en Blocage ou non (un statut inconnu de beads n'est pas perdu pour autant)
 *
 * `blocked` : le ticket dépend d'au moins un ticket non fermé (dépendance `blocks` en suspens, voir « Blocage » dans
 * CONTEXT.md). Le statut bloqué se lit dans `status` : que l'appelant le compte ou non dans `blocked` ne change rien.
 * `status` est indéfini avant la création du ticket.
 */
export function columnFor(status: string | undefined, blocked: boolean): Column | null {
  switch (status) {
    case 'closed':
      return 'done';
    case 'blocked':
      return 'blocked';
    case 'in_progress':
    case 'hooked':
      return blocked ? 'blocked' : 'inProgress';
    case 'open':
      return blocked ? 'backlog' : 'ready';
    default:
      return null;
  }
}
