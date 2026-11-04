import type { Issue } from '../shared/api';
import { type Column, COLUMNS, columnFor } from './columns';

/**
 * Une Epic et ses Enfants : ce qu'elle regroupe, son avancement, ses Enfants rangés par colonne, leur arborescence et la
 * prévision de sa fin. Du code pur, comme le reste du domaine : les tickets du Projet (ceux de `GET …/issues`, dont l'état
 * présent suffit) et l'heure entrent, des nombres sortent. Le tableau (`src/web/kanban`) et la page Epic en tirent la même
 * définition des Enfants (`descendantIds`) et la même règle de colonne (`columnFor`).
 */

/** Ce que le domaine lit d'un ticket du Projet pour mesurer une Epic. */
export type EpicTicket = Pick<Issue, 'id' | 'type' | 'status' | 'parentId' | 'blockedBy' | 'closedAt' | 'createdAt' | 'abandon'>;

/** Les Enfants d'un ticket, directs ou indirects (un Enfant d'Enfant, une Epic imbriquée) ; à l'abri des boucles. */
export function descendantIds(rootId: string, issues: readonly Pick<Issue, 'id' | 'parentId'>[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const { id, parentId } of issues) {
    if (parentId !== null) children.set(parentId, [...(children.get(parentId) ?? []), id]);
  }
  const seen = new Set<string>([rootId]);
  const descendants = new Set<string>();
  for (const queue = [rootId]; queue.length > 0; ) {
    for (const child of children.get(queue.shift() ?? '') ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      descendants.add(child);
      queue.push(child);
    }
  }
  return descendants;
}

export interface EpicChildren<T> {
  /**
   * Les Enfants de l'Epic hors Epics imbriquées, Abandons compris : ses descendants qui ne sont pas eux-mêmes des Epics, directs
   * ou indirects, dans l'ordre des tickets reçus. Ce sont les cartes du kanban que filtre cette Epic. Les Enfants à livrer
   * (CONTEXT.md) sont ce qu'il en reste sans les Abandons (`epicProgress`).
   */
  children: T[];
  /** Les Epics imbriquées : elles regroupent des Enfants (déjà dans `children`) sans être une Livraison. */
  epics: T[];
}

export function epicChildren<T extends EpicTicket>(epicId: string, issues: readonly T[]): EpicChildren<T> {
  const scope = descendantIds(epicId, issues);
  const inside = issues.filter((issue) => scope.has(issue.id));
  return { children: inside.filter((issue) => issue.type !== 'epic'), epics: inside.filter((issue) => issue.type === 'epic') };
}

export type ChildOutcome = 'open' | 'delivered' | 'abandoned';

/**
 * Où en est un Enfant : pas fermé, Livraison (fermé pour cause de travail terminé) ou Abandon (doublon, remplacé). Un
 * Abandon ne se lit que sur un ticket fermé : rouvert, il n'est ni l'un ni l'autre.
 */
export function outcomeOf(issue: Pick<EpicTicket, 'status' | 'abandon'>): ChildOutcome {
  if (issue.status !== 'closed') return 'open';
  return issue.abandon ? 'abandoned' : 'delivered';
}

export interface EpicProgress {
  /** Tous les Enfants hors Epics imbriquées, Abandons compris (`epicChildren`). */
  children: number;
  /** Les Livraisons parmi eux. */
  delivered: number;
  /** Les Abandons : fermés sans être livrés, ils ne sont pas non plus du travail qui reste. */
  abandoned: number;
  /** Ce qui reste à livrer : les Enfants pas fermés, en pause compris. */
  remaining: number;
  /** Ce que l'avancement mesure : les Livraisons et ce qui reste, sans les Abandons. */
  total: number;
  /** `delivered / total`, de 0 à 1 ; nul sans Enfant à livrer. */
  ratio: number | null;
}

/**
 * L'avancement d'une Epic : le nombre de Livraisons parmi ses Enfants. Un Abandon n'est pas une Livraison, et n'est pas non
 * plus du travail à venir : il sort du compte plutôt que de fermer la porte au 100 % (une Epic dont il ne reste rien à
 * livrer est finie), et la page le dit à part. `children` vient d'`epicChildren`.
 */
export function epicProgress(children: readonly Pick<EpicTicket, 'status' | 'abandon'>[]): EpicProgress {
  let [delivered, abandoned, remaining] = [0, 0, 0];
  for (const child of children) {
    const outcome = outcomeOf(child);
    if (outcome === 'delivered') delivered++;
    else if (outcome === 'abandoned') abandoned++;
    else remaining++;
  }
  const total = delivered + remaining;
  return { children: children.length, delivered, abandoned, remaining, total, ratio: total === 0 ? null : delivered / total };
}

/** Les colonnes du kanban, plus « En pause » : ce qu'aucune colonne n'accueille. */
export type EpicGroup = Column | 'paused';

/**
 * Les Enfants rangés par colonne, selon la règle du kanban et du CFD (`columnFor` : le statut et le Blocage, ce dernier
 * lu dans `blockedBy`). Terminé les garde tous, sans la fenêtre de jours du tableau, Abandons compris. Chaque colonne y est,
 * vide ou non ; l'ordre des Enfants est celui reçu.
 */
export function groupByColumn<T extends Pick<EpicTicket, 'status' | 'blockedBy'>>(children: readonly T[]): Record<EpicGroup, T[]> {
  const groups: Record<EpicGroup, T[]> = { backlog: [], ready: [], inProgress: [], blocked: [], done: [], paused: [] };
  for (const child of children) groups[columnFor(child.status, child.blockedBy.length > 0) ?? 'paused'].push(child);
  return groups;
}

export interface TreeNode<T> {
  ticket: T;
  children: TreeNode<T>[];
}

/**
 * L'arborescence de l'Epic : ses Enfants, puis les leurs, à tous les niveaux, Epics imbriquées comprises. Les frères sont
 * rangés par date de création (l'ordre où le travail a été découpé), puis par identifiant lu avec ses nombres (`.9` avant
 * `.10`) : le même ordre quel que soit celui des tickets reçus. À l'abri des boucles de parentés : un ticket n'y figure
 * qu'une fois.
 */
export function epicTree<T extends Pick<EpicTicket, 'id' | 'parentId' | 'createdAt'>>(epicId: string, issues: readonly T[]): TreeNode<T>[] {
  const byParent = new Map<string, T[]>();
  for (const issue of issues) {
    if (issue.parentId !== null) byParent.set(issue.parentId, [...(byParent.get(issue.parentId) ?? []), issue]);
  }
  const seen = new Set<string>([epicId]);
  const created = (issue: T) => {
    const ms = Date.parse(issue.createdAt);
    return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
  };
  const sorted = (siblings: T[]) =>
    [...siblings].sort((a, b) => created(a) - created(b) || a.id.localeCompare(b.id, 'fr', { numeric: true }));
  const build = (parentId: string): TreeNode<T>[] =>
    sorted(byParent.get(parentId) ?? []).flatMap((issue) => {
      if (seen.has(issue.id)) return [];
      seen.add(issue.id);
      return [{ ticket: issue, children: build(issue.id) }];
    });
  return build(epicId);
}

const DAY = 86_400_000;

/** Le Débit récent se mesure sur les 28 derniers jours (4 semaines), ou depuis la création d'une Epic plus récente. */
export const RECENT_DAYS = 28;
/** Une fenêtre plus courte ne fait pas un rythme : quelques Livraisons du premier jour ne disent rien d'une semaine. */
export const MIN_WINDOW_DAYS = 7;
/** Au-dessous de ce nombre de Livraisons récentes, il n'y a pas assez de Débit pour prévoir : la prévision est masquée. */
export const MIN_DELIVERIES = 4;

export interface RecentWindow {
  /** Début de la fenêtre (ms epoch) : elle court jusqu'à maintenant. */
  since: number;
  /** Sa durée écoulée, en jours : de 7 à 28. */
  days: number;
}

/**
 * La fenêtre du Débit récent, une Durée écoulée : les 28 derniers jours, ou depuis la création de l'Epic quand elle est plus
 * jeune (avant elle, rien n'a pu être livré, et compter ces jours-là sous-estimerait un rythme réel), mais jamais moins de 7 jours.
 * Une création illisible ou à venir (horloges qui divergent) laisse le minimum.
 */
export function recentWindow(epicCreatedAt: string, now: number): RecentWindow {
  const age = now - Date.parse(epicCreatedAt);
  const days = Number.isNaN(age) ? MIN_WINDOW_DAYS : Math.min(RECENT_DAYS, Math.max(MIN_WINDOW_DAYS, age / DAY));
  return { since: now - days * DAY, days };
}

/**
 * L'âge de l'Epic (ms) quand elle est plus jeune que la fenêtre minimale du Débit récent, 7 jours : sa fenêtre remonte alors avant
 * sa création, et peut compter des Livraisons d'Enfants livrés avant qu'elle existe (rattachés à elle après coup). `null` pour une
 * Epic d'au moins 7 jours, dont la fenêtre ne dépasse pas la vie, et pour une création illisible ou à venir : on ne dit pas un âge
 * qu'on ne connaît pas. Les pages s'en servent pour que « 3 Livraisons sur les 7 derniers jours » ne surprenne pas sur une Epic
 * d'hier.
 */
export function youngEpicAge(epicCreatedAt: string, now: number): number | null {
  const age = now - Date.parse(epicCreatedAt);
  return age >= 0 && age < MIN_WINDOW_DAYS * DAY ? age : null;
}

export type ForecastHiddenReason =
  /** L'Epic est fermée : il n'y a plus de fin à prévoir. */
  | 'epic-closed'
  /** Aucun Enfant à livrer (pas d'Enfant, ou seulement des Abandons). */
  | 'no-children'
  /** Tout est livré ou abandonné : l'Epic peut être fermée. */
  | 'all-delivered'
  /** Pas assez de Livraisons récentes pour en tirer un rythme. */
  | 'low-throughput';

export type Forecast =
  | {
      kind: 'hidden';
      reason: ForecastHiddenReason;
      /** Les Livraisons récentes de l'Epic, sur la fenêtre de `days` jours, et le nombre qu'il en faut. */
      deliveries: number;
      needed: number;
      days: number;
    }
  | {
      kind: 'range';
      /** Les Livraisons récentes (la fenêtre `days`) et les Enfants qui restent à livrer. */
      deliveries: number;
      remaining: number;
      days: number;
      /** Durées écoulées jusqu'à la fin (ms) : au rythme observé, puis dans la fourchette. `fastest` < `central` < `slowest`. */
      central: number;
      fastest: number;
      slowest: number;
      /** Instants correspondants (ms epoch) : maintenant plus `fastest`, maintenant plus `slowest`. */
      from: number;
      to: number;
    };

/**
 * La prévision de fin d'une Epic, à partir de son Débit récent : les Livraisons de ses Enfants dans la fenêtre
 * (`recentWindow`) donnent un rythme, que l'on applique à ce qui reste à livrer. Rien d'autre n'est supposé : le rythme
 * se maintient, aucun Enfant ne s'ajoute. Ce n'est pas un engagement, et la page le dit.
 *
 * Sans fausse précision : la fourchette tient compte du hasard d'un petit nombre de Livraisons. Compter `n` Livraisons en une
 * fenêtre, c'est connaître le rythme à plus ou moins la racine de `n` près (c'est la dispersion d'un comptage) ; la fin la
 * plus proche est celle du rythme `n + √n`, la plus lointaine celle de `n − √n`. Avec 4 Livraisons, elle va du simple au triple ;
 * avec 16, de 1 à 1,7. Au-dessous de `MIN_DELIVERIES` Livraisons, la prévision est masquée. Elle l'est aussi pour une Epic
 * fermée, sans Enfant à livrer, ou dont tout est livré.
 *
 * Une Livraison compte quand elle est datée (sa dernière clôture) de la fenêtre ou plus tard : une date à venir (horloges qui
 * divergent) vient d'avoir lieu, comme dans Terminé. Les Abandons et les Enfants rouverts ne sont pas des Livraisons.
 * `children` vient d'`epicChildren`.
 */
export function forecastEnd(epic: Pick<Issue, 'status' | 'createdAt'>, children: readonly EpicTicket[], now: number): Forecast {
  const { since, days } = recentWindow(epic.createdAt, now);
  const deliveries = children.filter((child) => {
    const closed = child.closedAt === null ? Number.NaN : Date.parse(child.closedAt);
    return outcomeOf(child) === 'delivered' && closed >= since;
  }).length;
  const hidden = (reason: ForecastHiddenReason): Forecast => ({ kind: 'hidden', reason, deliveries, needed: MIN_DELIVERIES, days });

  const { total, remaining } = epicProgress(children);
  if (epic.status === 'closed') return hidden('epic-closed');
  if (total === 0) return hidden('no-children');
  if (remaining === 0) return hidden('all-delivered');
  if (deliveries < MIN_DELIVERIES) return hidden('low-throughput');

  const window = days * DAY;
  const spread = Math.sqrt(deliveries);
  const fastest = (remaining * window) / (deliveries + spread);
  const slowest = (remaining * window) / (deliveries - spread);
  return {
    kind: 'range',
    deliveries,
    remaining,
    days,
    central: (remaining * window) / deliveries,
    fastest,
    slowest,
    from: now + fastest,
    to: now + slowest,
  };
}

/** Les colonnes dans l'ordre du flux, puis « En pause » : l'ordre où la page range les Enfants. */
export const EPIC_GROUPS: readonly EpicGroup[] = [...COLUMNS, 'paused'];
