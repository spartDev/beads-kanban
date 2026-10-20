import { type Interval, intersect, measure } from './intervals';

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
}

/** Historique normalisé d'un ticket, tel que fourni par le lecteur Dolt. */
export interface TicketHistory {
  id: TicketId;
  type: string;
  /** Un instantané par commit de l'historique, trié chronologiquement ; répétitions autorisées. */
  statusSnapshots: StatusSnapshot[];
  dependencies: DependencyHistory[];
}

export interface Transition {
  status: string;
  at: Date;
}

export type AbandonCause = 'duplicate' | 'superseded';

export type Outcome =
  | { kind: 'delivered'; at: Date }
  | { kind: 'abandoned'; at: Date; cause: AbandonCause }
  /** Fermé sans être une Livraison (une Epic, par exemple). */
  | { kind: 'closed'; at: Date }
  | { kind: 'open' };

export interface TicketFlow {
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
const isWork = (status: string) => WORK_STATUSES.has(status);

/** Liens posés par `bd duplicate` / `bd supersede` sur le ticket abandonné lui-même. */
const ABANDON_LINKS = new Map<string, AbandonCause>([
  ['duplicates', 'duplicate'],
  ['supersedes', 'superseded'],
]);

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
 * Une cible inconnue (hors Projet) n'est pas considérée comme bloquante.
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

function closedOutcome(ticket: TicketHistory, at: Date): Outcome {
  if (ticket.type === 'epic') return { kind: 'closed', at };
  for (const d of ticket.dependencies) {
    const cause = d.removedAt ? undefined : ABANDON_LINKS.get(d.type);
    if (cause) return { kind: 'abandoned', at, cause };
  }
  return { kind: 'delivered', at };
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

function toTransitions(snapshots: StatusSnapshot[]): Transition[] {
  const transitions: Transition[] = [];
  for (const { status, at } of snapshots) {
    if (transitions.at(-1)?.status !== status) transitions.push({ status, at });
  }
  return transitions;
}
