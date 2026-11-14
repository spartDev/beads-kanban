import type { MetricsRework, MetricsReworkTicket } from '../shared/api';
import { isWork } from './flow';
import type { MetricsInput, TrackedTicket } from './metrics';

/** Une fenêtre de temps (ms epoch) : son premier instant compris, le premier instant qui suit exclu. */
interface Window {
  start: number;
  end: number;
}

interface Entry {
  project: MetricsInput;
  ticket: TrackedTicket;
}

const within = (instant: number, window: Window) => instant >= window.start && instant < window.end;
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Le Retravail de la fenêtre (voir CONTEXT.md) : chaque ticket qui y a subi une Réouverture ou une Prise rendue, ou dont une Livraison y a reçu un Bug
 * d'origine (daté de la création du bug qui a constaté le défaut). Les Transitions d'un ticket se suivent sans répéter un statut : un changement depuis
 * fermé est une Réouverture, un changement d'un statut de travail vers ouvert une Prise rendue.
 */
export function reworkIn(entries: Entry[], window: Window): MetricsRework {
  const rows = entries.flatMap(({ project, ticket }): Array<{ shown: MetricsReworkTicket; last: number }> => {
    const { steps } = ticket.timeline;
    let [reopenings, returns, last] = [0, 0, Number.NEGATIVE_INFINITY];
    steps.forEach((step, index) => {
      const previous = steps[index - 1];
      if (!previous || !within(step.at, window)) return;
      if (previous.status === 'closed' && step.status !== 'closed') reopenings++;
      else if (isWork(previous.status) && step.status === 'open') returns++;
      else return;
      last = Math.max(last, step.at);
    });
    const found = ticket.originBugs.filter((bug) => within(bug.at, window)).sort((a, b) => a.at - b.at || compareText(a.id, b.id));
    for (const bug of found) last = Math.max(last, bug.at);
    if (reopenings + returns + found.length === 0) return [];
    const { id, title, type, priority } = ticket;
    const originBugs = found.map((bug) => bug.id);
    return [{ shown: { id, title, type, priority, project: project.id, reopenings, returns, originBugs, lastAt: new Date(last).toISOString() }, last }];
  });
  const events = ({ shown }: { shown: MetricsReworkTicket }) => shown.reopenings + shown.returns + shown.originBugs.length;
  return {
    tickets: rows
      .sort((a, b) => events(b) - events(a) || b.last - a.last || compareText(a.shown.project, b.shown.project) || compareText(a.shown.id, b.shown.id))
      .map(({ shown }) => shown),
  };
}
