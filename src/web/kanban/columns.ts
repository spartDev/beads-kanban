import { type Column, COLUMNS, columnFor } from '../../domain/columns';
import { descendantIds } from '../../domain/epics';
import type { Issue } from '../data/types';
import { startOfLocalDay } from '../lib/localDay';

/**
 * Le classement des tickets en colonnes du kanban : des fonctions pures, sans React ni horloge cachée.
 *
 *   Backlog   ticket ouvert, en Blocage
 *   Prêt      ticket ouvert, hors Blocage
 *   En cours  statut de travail (en cours, rattaché à un agent), hors Blocage
 *   Bloqué    statut de travail en Blocage, ou statut bloqué
 *   Terminé   ticket fermé ces `doneDays` derniers jours, aujourd'hui compris (14 par défaut) : des jours calendaires
 *             du fuseau du navigateur, comme les périodes de la page Métriques (`resolvePeriod`) et CONTEXT.md. Avec 14
 *             jours, le lundi 26 octobre, Terminé commence le mardi 13 à minuit.
 *   En pause  tiroir : statut différé ou épinglé (et tout statut inconnu, comme dans le CFD)
 *
 * Le Blocage se déduit des dépendances (`blockedBy`, les cibles `blocks` non fermées), pas du statut : voir CONTEXT.md.
 *
 * La règle statut × Blocage → colonne n'est pas écrite ici : c'est `columnFor` (`src/domain/columns.ts`), la même que celle
 * du CFD de `src/domain/timeline.ts`, qui l'applique à l'historique d'un ticket au lieu de son état présent. Ne reste
 * propre au tableau que ce que le CFD n'a pas : la fenêtre de Terminé (le CFD cumule tous les tickets fermés) et le tiroir
 * « En pause » (que le CFD laisse hors des colonnes). `columns.test.ts` compare les deux ticket par ticket ; sur un Projet
 * entier, c'est `src/server/projects/board-vs-cfd.test.ts` (il passe par `buildIssues`, du serveur).
 */

/** Les colonnes, dans l'ordre du flux : celles du domaine, que le CFD partage. */
export const COLUMN_IDS = COLUMNS;

export type ColumnId = Column;

/** Une colonne, ou le tiroir « En pause ». */
export type Lane = ColumnId | 'paused';

/** Nombre de jours calendaires, aujourd'hui compris, pendant lesquels un ticket fermé reste dans Terminé. */
export const DEFAULT_DONE_DAYS = 14;

/** Ce que le classement lit d'un ticket. */
export type IssueFacts = Pick<Issue, 'status' | 'blockedBy' | 'closedAt'>;

export interface PlacementOptions {
  /** Maintenant, en ms epoch. */
  now: number;
  /** Les `doneDays` derniers jours calendaires, aujourd'hui compris, que Terminé couvre ; `Infinity` pour tous. */
  doneDays?: number;
}

/**
 * Blocage : une dépendance bloquante en suspens, ou le statut bloqué. Un ticket fermé n'a plus de `blockedBy`
 * (l'API le vide), donc n'est jamais bloqué.
 */
export const isBlocked = (issue: Pick<Issue, 'status' | 'blockedBy'>): boolean =>
  issue.status === 'blocked' || issue.blockedBy.length > 0;

/**
 * Où va un ticket : sa colonne, `'paused'` pour le tiroir « En pause », ou `null` quand il n'est pas sur le tableau
 * (fermé avant la fenêtre de Terminé, ou fermé sans date lisible : son ancienneté est inconnue).
 *
 * Un ticket fermé est dans Terminé s'il l'a été ces `doneDays` derniers jours, aujourd'hui compris (`closedWithin`).
 */
export function columnOf(issue: IssueFacts, { now, doneDays = DEFAULT_DONE_DAYS }: PlacementOptions): Lane | null {
  const column = columnFor(issue.status, isBlocked(issue));
  // Hors des colonnes pour le CFD : deferred, pinned, ou un statut personnalisé de beads. Ici, le tiroir plutôt que perdu.
  if (column === null) return 'paused';
  // Le CFD cumule tous les tickets fermés ; le tableau ne garde dans Terminé que ceux de la fenêtre.
  if (column === 'done') return closedWithin(issue.closedAt, now, doneDays) ? 'done' : null;
  return column;
}

/**
 * Minuit, heure locale, du premier jour de la fenêtre de Terminé : aujourd'hui moins `days - 1` jours. Les jours se
 * comptent au calendrier du fuseau du navigateur, pas en tranches de 24 h (`startOfLocalDay`, qui sert aussi à l'âge des
 * cartes) : un jour de changement d'heure dure 23 ou 25 h, et le début de la fenêtre reste un minuit.
 */
export function doneSince(now: number, days: number): number {
  return startOfLocalDay(now, -(Math.floor(days) - 1));
}

/**
 * Un ticket fermé à `closedAt` est-il dans les `doneDays` derniers jours calendaires, aujourd'hui compris ? Le premier
 * jour est inclus dès son premier instant ; une clôture « dans le futur » (horloges qui divergent) vient d'avoir lieu.
 * Sans date lisible, l'ancienneté est inconnue : il n'y est pas, sauf fenêtre infinie.
 */
export function closedWithin(closedAt: string | null, now: number, doneDays: number): boolean {
  return placeClosed(closedAt, { now, doneDays }) === 'done';
}

/** Où va un ticket fermé : Terminé, « fermé plus tôt » (date connue, avant la fenêtre) ou « sans date » (ancienneté inconnue). */
export type ClosedPlacement = 'done' | 'earlier' | 'undated';

export function placeClosed(closedAt: string | null, { now, doneDays = DEFAULT_DONE_DAYS }: PlacementOptions): ClosedPlacement {
  const days = Math.floor(doneDays);
  // Fenêtre infinie : tout ticket fermé est dedans, daté ou non.
  if (days === Number.POSITIVE_INFINITY) return 'done';
  const closed = closedAt === null ? Number.NaN : Date.parse(closedAt);
  if (Number.isNaN(closed)) return 'undated';
  // Une fenêtre de moins d'un jour (0, négative, NaN) ne garde rien.
  return days >= 1 && closed >= doneSince(now, days) ? 'done' : 'earlier';
}

/**
 * Une carte du tableau : tout ticket sauf une Epic. Une Epic regroupe des Enfants et n'est jamais une Livraison : elle
 * resterait ouverte dans Prêt ou En cours tant que dure son travail, et fausserait les comptes de colonnes que le CFD
 * exclut aussi. Elle se retrouve dans le filtre Epic et dans la pastille de ses Enfants.
 */
export const isBoardCard = (issue: Pick<Issue, 'type'>): boolean => issue.type !== 'epic';

const priorityRank = (priority: number): number => (Number.isFinite(priority) ? priority : Number.POSITIVE_INFINITY);
const updatedMs = (issue: Pick<Issue, 'updatedAt'>): number => {
  const ms = Date.parse(issue.updatedAt);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
};

/**
 * L'ordre dans une colonne : priorité (P0 d'abord), puis mise à jour la plus récente. À égalité, l'identifiant (lu
 * avec ses nombres : `.9` avant `.10`) rend l'ordre stable d'un chargement à l'autre.
 */
export function compareIssues(a: Issue, b: Issue): number {
  const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
  if (byPriority !== 0 && !Number.isNaN(byPriority)) return byPriority;
  const [ua, ub] = [updatedMs(a), updatedMs(b)];
  if (ua !== ub) return ua > ub ? -1 : 1;
  return a.id.localeCompare(b.id, 'fr', { numeric: true });
}

const closedMs = (issue: Pick<Issue, 'closedAt'>): number => {
  const ms = issue.closedAt === null ? Number.NaN : Date.parse(issue.closedAt);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
};

/**
 * L'ordre de Terminé : la clôture la plus récente d'abord, quelles que soient priorité et mise à jour (une colonne de
 * tickets finis se lit comme un journal). Une date absente ou illisible vient en dernier ; à égalité, l'ordre ordinaire.
 */
export function compareClosed(a: Issue, b: Issue): number {
  const [ca, cb] = [closedMs(a), closedMs(b)];
  if (ca !== cb) return ca > cb ? -1 : 1;
  return compareIssues(a, b);
}

export interface Board {
  columns: Record<ColumnId, Issue[]>;
  /** Le tiroir « En pause ». */
  paused: Issue[];
  /** Cartes du tableau : les cinq colonnes et le tiroir. */
  total: number;
  /** Tickets fermés avant la fenêtre de Terminé (leur date de clôture est connue). */
  closedEarlier: number;
  /** Tickets fermés sans date de clôture lisible : leur ancienneté est inconnue, ils ne sont dans aucune colonne. */
  closedUndated: number;
}

export interface BoardOptions extends PlacementOptions {
  /** Epic choisie : le tableau ne garde que ses Enfants, directs ou indirects. */
  epicId?: string | null;
}

/** Le tableau d'un Projet : chaque carte dans sa colonne, chaque colonne triée. */
export function buildBoard(issues: readonly Issue[], { epicId, ...placement }: BoardOptions): Board {
  const scope = epicId ? descendantIds(epicId, issues) : null;
  const columns: Record<ColumnId, Issue[]> = { backlog: [], ready: [], inProgress: [], blocked: [], done: [] };
  const paused: Issue[] = [];
  let closedEarlier = 0;
  let closedUndated = 0;

  for (const issue of issues) {
    if (!isBoardCard(issue) || (scope && !scope.has(issue.id))) continue;
    const lane = columnOf(issue, placement);
    if (lane === 'paused') paused.push(issue);
    else if (lane !== null) columns[lane].push(issue);
    else if (placeClosed(issue.closedAt, placement) === 'undated') closedUndated++;
    else closedEarlier++;
  }

  for (const id of COLUMN_IDS) columns[id].sort(id === 'done' ? compareClosed : compareIssues);
  paused.sort(compareIssues);
  const total = paused.length + COLUMN_IDS.reduce((sum, id) => sum + columns[id].length, 0);
  return { columns, paused, total, closedEarlier, closedUndated };
}

/** Colonnes dans l'ordre où l'on préfère ouvrir le tableau : ce qui avance d'abord. */
const OPENING_ORDER: readonly ColumnId[] = ['inProgress', 'ready', 'blocked', 'backlog', 'done'];

/**
 * La colonne montrée à l'ouverture sur mobile : la première qui a des cartes, en commençant par En cours. Quand le
 * tableau n'a aucune carte mais que des tickets fermés restent de côté, Terminé : c'est là que le décompte des fermés
 * plus tôt est écrit, au lieu d'un « Aucun ticket » qui laisserait croire le Projet vide. Sinon Prêt.
 *
 * Quand tous les tickets du tableau sont en pause (`onlyPaused`), aucune colonne n'a de carte à montrer et Prêt vide n'est
 * qu'une réponse faute de mieux : la page ajoute alors un état vide qui renvoie au tiroir « En pause ».
 */
export function defaultColumn(board: Board): ColumnId {
  const filled = OPENING_ORDER.find((id) => board.columns[id].length > 0);
  if (filled) return filled;
  return board.closedEarlier + board.closedUndated > 0 ? 'done' : 'ready';
}

/**
 * Tous les tickets du tableau sont dans le tiroir « En pause » : aucune colonne n'a de carte, mais des tickets sont en
 * pause (reportés, épinglés, d'un statut inconnu). Le tableau paraît vide alors qu'il ne l'est pas : la page le dit et
 * renvoie au tiroir. Faux quand rien n'est en pause (tableau vide, ou fermés anciens seulement).
 */
export const onlyPaused = (board: Board): boolean =>
  board.paused.length > 0 && COLUMN_IDS.every((id) => board.columns[id].length === 0);
