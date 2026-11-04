import type { IssueBlockage, IssueBlockagePhase, IssueBlockagePhaseKind, IssueChronology, IssueOutcome, IssueTransition } from '../shared/api';
import { analyzeFlow, isWork, type Outcome, type TicketHistory, type TicketId } from './flow';
import { type Interval, intersect, union } from './intervals';
import { type Step, stepsOf } from './timeline';

/**
 * La chronologie d'un ticket, telle que l'affiche son détail : ses Transitions avec le temps passé dans chaque statut,
 * ses Blocages, et les durées des métriques (Lead Time, Cycle Time, temps bloqué) qui en sortent. Les durées sont celles
 * d'`analyzeFlow`, ni recalculées ni arrondies : le détail d'un ticket et la page Métriques disent la même chose.
 * Du code pur : l'historique des tickets du Projet entre, un objet sérialisable sort (durées en ms, dates ISO en UTC).
 */

/** La chronologie de chaque ticket d'un Projet. */
export interface ProjectChronologies {
  /** La chronologie du ticket ; indéfinie s'il n'a aucun statut dans l'historique (ou n'y figure pas). */
  of(id: TicketId): IssueChronology | undefined;
}

/**
 * Analyse l'historique complet d'un Projet. Il faut tous les tickets, pas un seul : le Blocage d'un ticket dépend de
 * l'état, à chaque instant, des tickets dont il dépend. Le travail lourd (`analyzeFlow`) est fait une fois ; la
 * chronologie d'un ticket se construit à la demande.
 */
export function analyzeChronologies(tickets: TicketHistory[]): ProjectChronologies {
  const flows = analyzeFlow(tickets);
  const stepsById = new Map([...flows].map(([id, flow]) => [id, stepsOf(flow.transitions)]));
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const memo = new Map<TicketId, IssueChronology | undefined>();

  function build(id: TicketId): IssueChronology | undefined {
    const flow = flows.get(id);
    if (!flow || flow.transitions.length === 0) return undefined;
    // Les dates d'une Transition ne reculent jamais : quand l'horloge d'un commit a reculé, `analyzeFlow` date le changement
    // au même instant que le précédent du ticket (comme pour le CFD). Le temps passé dans un statut n'est donc jamais négatif,
    // et les temps passés s'additionnent en Lead Time, que le Cycle Time ne dépasse pas : ils se lisent sur les mêmes
    // Transitions. Les Blocages croisent aussi les dates des dépendances, que cette borne ne touche pas (voir `analyzeFlow`).
    const steps = stepsById.get(id) ?? [];
    const transitions = steps.map(
      (step, i): IssueTransition => ({
        status: step.status,
        at: new Date(step.at).toISOString(),
        duration: steps[i + 1] ? (steps[i + 1]?.at ?? step.at) - step.at : null,
      }),
    );
    return {
      source: 'history',
      transitions,
      blockages: blockagesOf(byId.get(id)?.dependencies ?? [], steps, stepsById),
      outcome: toOutcome(flow.outcome),
      leadTime: flow.leadTime,
      cycleTime: flow.cycleTime,
      blockedTime: flow.blockedTime,
      reopenings: flow.reopenings,
    };
  }

  return {
    of(id) {
      if (!memo.has(id)) memo.set(id, build(id));
      return memo.get(id);
    },
  };
}

const END = Number.POSITIVE_INFINITY;

/** Périodes dont le statut satisfait `matches` ; la dernière court jusqu'à l'infini. */
function periodsOf(steps: Step[], matches: (status: string) => boolean): Interval[] {
  return steps.flatMap((step, i): Interval[] => (matches(step.status) ? [[step.at, steps[i + 1]?.at ?? END]] : []));
}

const overlaps = ([start, end]: Interval, [otherStart, otherEnd]: Interval): boolean => start < otherEnd && otherStart < end;

/**
 * Les périodes de Blocage du ticket, tant qu'il n'est pas fermé : le statut bloqué, ou une dépendance `blocks` active
 * vers un ticket du Projet pas encore fermé (même règle que `analyzeFlow` et le CFD : une cible hors Projet ne se
 * peut évaluer, elle ne bloque pas). Des périodes qui se chevauchent n'en font qu'une, qui nomme tous les tickets attendus.
 */
function blockagesOf(
  dependencies: TicketHistory['dependencies'],
  steps: Step[],
  stepsById: Map<TicketId, Step[]>,
): IssueBlockage[] {
  const alive = periodsOf(steps, (status) => status !== 'closed');
  // Une période en statut bloqué s'arrête à la Transition suivante : elle ne déborde jamais sur une période fermée.
  const byStatus = periodsOf(steps, (status) => status === 'blocked');
  const byDependency = dependencies
    .filter((dependency) => dependency.type === 'blocks')
    .flatMap((dependency) => {
      const target = stepsById.get(dependency.target);
      if (!target) return [];
      const active: Interval = [dependency.addedAt.getTime(), dependency.removedAt?.getTime() ?? END];
      const waiting = intersect(intersect([active], periodsOf(target, (status) => status !== 'closed')), alive);
      return waiting.map((interval) => ({ interval, target: dependency.target }));
    });

  return union([...byStatus, ...byDependency.map(({ interval }) => interval)]).map((period) => ({
    from: new Date(period[0]).toISOString(),
    to: Number.isFinite(period[1]) ? new Date(period[1]).toISOString() : null,
    blockedBy: [...new Set(byDependency.filter(({ interval }) => overlaps(interval, period)).map(({ target }) => target))].sort(),
    statusBlocked: byStatus.some((interval) => overlaps(interval, period)),
    phases: phasesOf(period, steps),
  }));
}

/**
 * Les phases que le ticket traverse pendant le Blocage `period` : en travail (la part que le temps bloqué compte), ouvert et
 * jamais démarré (l'Attente de dépendance), ou en attente autrement. Le Blocage se déduit des dépendances, il court donc tant
 * que le ticket n'est pas fermé, quel que soit son statut ; le temps bloqué des métriques, lui, ne prend que la part passée
 * en statut de travail (`analyzeFlow`). Les phases voisines de même nature n'en font qu'une (en cours, puis bloqué).
 */
function phasesOf(period: Interval, steps: Step[]): IssueBlockagePhase[] {
  const firstWork = steps.findIndex((step) => isWork(step.status));
  const phases: { kind: IssueBlockagePhaseKind; from: number; to: number }[] = [];
  // `period` ne recouvre jamais une période fermée (`blockagesOf` : statut bloqué, ou dépendance prise sur les périodes non fermées).
  steps.forEach((step, index) => {
    const kind: IssueBlockagePhaseKind = isWork(step.status)
      ? 'work'
      : step.status === 'open' && (firstWork < 0 || index < firstWork)
        ? 'dependencyWait'
        : 'otherWait';
    const from = Math.max(period[0], step.at);
    const to = Math.min(period[1], steps[index + 1]?.at ?? END);
    if (to <= from) return;
    const previous = phases.at(-1);
    if (previous?.kind === kind && previous.to === from) previous.to = to;
    else phases.push({ kind, from, to });
  });
  return phases.map(({ kind, from, to }) => ({
    kind,
    from: new Date(from).toISOString(),
    to: Number.isFinite(to) ? new Date(to).toISOString() : null,
  }));
}

/**
 * Repli de l'ADR 0001 pour un ticket qui n'a aucun statut dans l'historique (jamais commité, ou historique perdu) : on ne
 * connaît que sa date de création et, s'il est fermé, sa date de clôture. Ni Cycle Time (`started_at` n'est pas fiable),
 * ni Blocage, ni Livraison : sans l'historique des liens, on ne sait pas si c'est un Abandon.
 */
export function chronologyFromDates({ createdAt, closedAt }: { createdAt: Date; closedAt: Date | null }): IssueChronology {
  const created = createdAt.getTime();
  // Une clôture datée avant la création (horloge) tombe à la création : la durée n'est jamais négative.
  const closed = closedAt === null ? null : Math.max(closedAt.getTime(), created);
  const leadTime = closed === null ? null : closed - created;
  return {
    source: 'dates',
    transitions: [
      { status: 'open', at: new Date(created).toISOString(), duration: leadTime },
      ...(closed === null ? [] : [{ status: 'closed', at: new Date(closed).toISOString(), duration: null }]),
    ],
    blockages: [],
    outcome: closed === null ? { kind: 'open' } : { kind: 'closed', at: new Date(closed).toISOString() },
    leadTime,
    cycleTime: null,
    blockedTime: null,
    reopenings: 0,
  };
}

function toOutcome(outcome: Outcome): IssueOutcome {
  switch (outcome.kind) {
    case 'open':
      return { kind: 'open' };
    case 'abandoned':
      return { kind: 'abandoned', at: outcome.at.toISOString(), cause: outcome.cause };
    case 'delivered':
    case 'closed':
      return { kind: outcome.kind, at: outcome.at.toISOString() };
  }
}
