import { type AbandonCause, abandonOf } from './abandon';
import { type Interval, intersect, measure } from './intervals';

export type { AbandonCause };

export type TicketId = string;

export interface StatusSnapshot {
  status: string;
  at: Date;
}

export interface DependencyHistory {
  type: string;
  target: TicketId;
  addedAt: Date;
  removedAt?: Date;
  /**
   * Le `created_at` de la ligne de la dépendance, que bd écrit à la pose ; absent quand l'historique ne le donne pas (le lecteur ne
   * le relève que pour les liens d'Abandon). `addedAt` est le commit qui voit la dépendance le premier : un commit de lot de bd,
   * un import ou un historique aplati en réunit plusieurs posées à des moments différents, et seul `createdAt` dit alors dans quel
   * ordre (`abandonOf`).
   */
  createdAt?: Date;
}

/** Historique normalisé d'un ticket, tel que fourni par le lecteur Dolt. */
export interface TicketHistory {
  id: TicketId;
  type: string;
  /**
   * Les instantanés de statut, dans l'ordre des commits de l'historique (la lignée du premier parent) ; répétitions
   * autorisées. Cet ordre n'est pas celui des dates : l'horloge d'un commit peut reculer, et rien ne trie par date
   * (voir `TicketFlow.transitions`).
   */
  statusSnapshots: StatusSnapshot[];
  dependencies: DependencyHistory[];
}

/** Un changement de statut : le ticket prend ce statut à cet instant et le garde jusqu'à la Transition suivante. */
export interface Transition {
  status: string;
  at: Date;
}

export type Outcome =
  | { kind: 'delivered'; at: Date }
  | {
      kind: 'abandoned';
      at: Date;
      cause: AbandonCause;
      /** Le ticket dont il est le doublon, ou qui le remplace : la cible du lien d'Abandon que retient `abandonOf`. Pas forcément un ticket du Projet. */
      of: TicketId;
    }
  /** Fermé sans être une Livraison (une Epic, par exemple). */
  | { kind: 'closed'; at: Date }
  | { kind: 'open' };

export interface TicketFlow {
  /**
   * Les Transitions du ticket, dans l'ordre de l'historique. Leurs dates ne reculent jamais, même quand l'horloge d'un
   * commit a reculé : la Transition de ce commit est datée de la précédente du même ticket (voir `toTransitions`). Le Lead
   * Time, le Cycle Time et le temps passé entre deux Transitions sont donc des écarts entre instants qui se suivent : jamais
   * négatifs, avec Cycle Time ≤ Lead Time. Le temps bloqué et l'Attente de dépendance en sont des parts, jamais négatives ;
   * leur précision dépend aussi des dates des dépendances, que cette borne ne touche pas (voir `analyzeFlow`).
   */
  transitions: Transition[];
  outcome: Outcome;
  /** Création → dernière clôture, en ms ; null tant que le ticket n'est pas fermé. */
  leadTime: number | null;
  /** Temps cumulé dans les statuts de travail, en ms ; null si non fermé ou jamais démarré. */
  cycleTime: number | null;
  /** Part du Cycle Time passée en Blocage, en ms ; null si non fermé. */
  blockedTime: number | null;
  /** Temps en Backlog avant le premier démarrage, en ms ; null si non fermé. */
  dependencyWait: number | null;
  reopenings: number;
}

const WORK_STATUSES = new Set(['in_progress', 'hooked', 'blocked']);
/** Statut de travail : en cours, rattaché à un agent, bloqué. Ce que le Cycle Time et le WIP comptent. */
export const isWork = (status: string) => WORK_STATUSES.has(status);

/**
 * Le flux de chaque ticket : ses Transitions, son issue et ses durées (Lead Time, Cycle Time, temps bloqué, Attente de
 * dépendance). Il faut tous les tickets, pas un seul : le Blocage d'un ticket dépend de l'état, à chaque instant, de ceux
 * dont il dépend.
 *
 * Le Lead Time et le Cycle Time se lisent sur les Transitions du ticket, dont les dates ne reculent jamais, même quand
 * l'horloge d'un commit a reculé (`TicketFlow.transitions`) : ils ne se contredisent pas. Le Blocage par dépendance croise ces
 * Transitions avec deux sources que la borne ne touche pas : les dates des dépendances (`addedAt`, `removedAt`) sont celles de
 * leurs commits, et les Transitions du ticket bloquant sont bornées pour lui seul. Quand une horloge a reculé, ces dates
 * peuvent se contredire (rien ne dit l'ordre des commits entre une dépendance et un statut, ni entre deux tickets) : le temps
 * bloqué et l'Attente de dépendance y perdent en précision, mais restent des intersections avec les périodes du ticket
 * lui-même, donc jamais négatifs, avec temps bloqué ≤ Cycle Time et Attente de dépendance + Cycle Time ≤ Lead Time. Voir
 * l'ADR 0001.
 */
export function analyzeFlow(tickets: TicketHistory[]): Map<TicketId, TicketFlow> {
  const transitionsById = new Map(tickets.map((t) => [t.id, toTransitions(t.statusSnapshots)]));
  return new Map(tickets.map((t) => [t.id, analyzeTicket(t, transitionsById)]));
}

function analyzeTicket(ticket: TicketHistory, transitionsById: Map<TicketId, Transition[]>): TicketFlow {
  const transitions = transitionsById.get(ticket.id) ?? [];
  const reopenings = transitions.filter((_, i) => transitions[i - 1]?.status === 'closed').length;
  const created = transitions[0];
  const last = transitions.at(-1);
  if (!created || last?.status !== 'closed') {
    return {
      transitions,
      outcome: { kind: 'open' },
      leadTime: null,
      cycleTime: null,
      blockedTime: null,
      dependencyWait: null,
      reopenings,
    };
  }
  const work = periods(transitions, isWork);
  const blockage = blockagePeriods(ticket, transitions, transitionsById);
  const firstStart = transitions.find((t) => isWork(t.status))?.at.getTime() ?? last.at.getTime();
  const backlogBeforeStart = intersect(periods(transitions, (s) => s === 'open'), [[created.at.getTime(), firstStart]]);
  return {
    transitions,
    outcome: closedOutcome(ticket, last.at),
    leadTime: last.at.getTime() - created.at.getTime(),
    cycleTime: work.length > 0 ? measure(work) : null,
    blockedTime: measure(intersect(blockage, work)),
    dependencyWait: measure(intersect(blockage, backlogBeforeStart)),
    reopenings,
  };
}

/**
 * Blocage : statut bloqué, ou dépendance bloquante active vers une cible non fermée.
 * Une cible inconnue (hors Projet) n'est pas considérée comme bloquante. La dépendance garde les dates de ses commits, et la
 * cible les Transitions de son propre ticket : voir `analyzeFlow`.
 */
function blockagePeriods(
  ticket: TicketHistory,
  transitions: Transition[],
  transitionsById: Map<TicketId, Transition[]>,
): Interval[] {
  const end = transitions.at(-1)?.at.getTime() ?? 0;
  const byDependency = ticket.dependencies
    .filter((d) => d.type === 'blocks')
    .flatMap((d) => {
      const target = transitionsById.get(d.target);
      if (!target) return [];
      const active: Interval = [d.addedAt.getTime(), d.removedAt?.getTime() ?? end];
      return intersect([active], periods(target, (s) => s !== 'closed', end));
    });
  return [...periods(transitions, (s) => s === 'blocked'), ...byDependency];
}

/**
 * L'issue d'un ticket fermé : une Epic n'est jamais une Livraison, un ticket que ses liens déclarent doublon ou remplacé est un
 * Abandon (`abandonOf`, la règle que le kanban applique aussi), tout autre est une Livraison.
 */
function closedOutcome(ticket: TicketHistory, at: Date): Outcome {
  if (ticket.type === 'epic') return { kind: 'closed', at };
  const abandon = abandonOf(ticket.dependencies);
  return abandon ? { kind: 'abandoned', at, cause: abandon.cause, of: abandon.of } : { kind: 'delivered', at };
}

/**
 * Périodes dont le statut satisfait `matches`. Chaque période court jusqu'à la Transition suivante ;
 * la dernière court jusqu'à `openEnd` (par défaut, elle n'est pas comptée).
 */
function periods(transitions: Transition[], matches: (status: string) => boolean, openEnd?: number): Interval[] {
  return transitions.flatMap((t, i): Interval[] => {
    const end = transitions[i + 1]?.at.getTime() ?? openEnd;
    return end !== undefined && matches(t.status) ? [[t.at.getTime(), end]] : [];
  });
}

/**
 * Les changements de statut d'un ticket tels que ses commits les datent : ses instantanés, dans l'ordre où l'historique les
 * donne, réduits à un par changement. C'est le premier instantané d'une série de même statut qui date le changement ; les
 * suivants ne datent rien. Ces dates ne sont pas bornées et peuvent reculer d'un changement au suivant (voir
 * `toTransitions`) : elles ne mesurent aucune durée. Elles servent à situer deux tickets l'un par rapport à l'autre, là où
 * la borne de l'un ne dit rien de l'autre (le Bug d'origine, `analyzeFailures`).
 */
export function recordedTransitions(snapshots: readonly StatusSnapshot[]): Transition[] {
  return snapshots.filter((snapshot, index) => snapshots[index - 1]?.status !== snapshot.status);
}

/**
 * Les Transitions d'un ticket : ses changements de statut (`recordedTransitions`), dans l'ordre où l'historique les donne.
 *
 * L'ordre est celui des commits de la lignée du premier parent (ADR 0001), jamais un tri par date : trier par date
 * ferait passer une clôture avant la création. Les dates, elles, ne sont pas sûres : l'horloge d'une machine peut reculer
 * d'un commit à l'autre. Une Transition n'est pourtant jamais antérieure à la précédente du même ticket, puisque son commit
 * vient après dans l'historique : sa date est bornée par celle de la Transition précédente, déjà bornée, c'est-à-dire par
 * la plus tardive des Transitions qui la précèdent. Elle tombe alors au même instant que la précédente, dont le statut dure
 * 0 et jamais moins. Les autres dates ne bougent pas : sur un historique aux dates croissantes, la borne ne change rien.
 * Un instantané qui répète le statut n'est pas une Transition : il ne date rien et ne borne rien.
 *
 * Sans cette borne, le Cycle Time (périodes de travail entre deux Transitions) et le Lead Time (dernière clôture moins
 * création) ne se mesuraient pas sur les mêmes instants, et le premier pouvait dépasser le second.
 *
 * La borne est propre à chaque ticket. Elle ne dit rien des autres tickets ni des dépendances, dont les dates restent celles
 * de leurs commits : voir `analyzeFlow`, et l'ADR 0001 pour ses contreparties.
 */
function toTransitions(snapshots: readonly StatusSnapshot[]): Transition[] {
  const transitions: Transition[] = [];
  for (const { status, at } of recordedTransitions(snapshots)) {
    const previous = transitions.at(-1);
    transitions.push({ status, at: previous && at.getTime() < previous.at.getTime() ? new Date(previous.at) : at });
  }
  return transitions;
}
