import type { MetricsInput, TrackedTicket } from './metrics';
import { statusAt } from './timeline';

/**
 * « Depuis votre dernière visite » : ce qui s'est passé dans tous les Projets entre la Dernière visite et l'instant des données (voir CONTEXT.md), genre par
 * genre, les mauvaises nouvelles d'abord. Du code pur, tiré des mêmes analyses que les Signaux et les métriques (`ProjectAnalysis`) : aucune autre lecture.
 *
 * La fenêtre compte son premier instant et exclut le dernier, comme celle des métriques : un événement daté à l'instant des données ou après (l'horloge d'un
 * commit en avance) n'est pas encore arrivé. Il le sera dans la fenêtre suivante, qui commence là où celle-ci s'arrête quand l'utilisateur dit avoir tout vu :
 * rien n'est sauté, rien n'est compté deux fois.
 */

const HOUR = 3_600_000;

/** Sans Dernière visite (l'utilisateur n'a jamais dit avoir tout vu dans ce navigateur), la fenêtre remonte 24 heures avant l'instant des données. */
export const WITHOUT_LAST_VISIT = 24 * HOUR;

/**
 * Le statut À valider (ADR 0007 : son nom est un contrat). Un ticket qui y est à l'instant des données n'entre dans aucun genre : il attend l'utilisateur, et
 * c'est la File de décisions qui le montre.
 */
export const AWAITING_VALIDATION = 'awaiting_human';

/** Une fenêtre de temps (ms epoch) : son premier instant compris, le premier instant qui suit exclu. */
export interface LastVisitWindow {
  start: number;
  end: number;
}

/**
 * La fenêtre de « Depuis votre dernière visite » : de la Dernière visite (24 heures plus tôt sans elle) à l'instant des données. Une Dernière visite postérieure
 * à cet instant (l'horloge du serveur a reculé) donne une fenêtre vide, jamais une fenêtre à l'envers.
 */
export function lastVisitWindow(lastVisit: number | undefined, asOf: number): LastVisitWindow {
  return { start: Math.min(lastVisit ?? asOf - WITHOUT_LAST_VISIT, asOf), end: asOf };
}

/**
 * Les genres disponibles aujourd'hui. Les Livraisons sans Feu vert (bdesk-3e9.5) et les Retours venus de la relecture ou de l'intégration (bdesk-pz0.5) les
 * rejoindront : voir `sinceLastVisit` pour leur place.
 */
export type SinceKind = 'reopenings' | 'escapedBugs' | 'deliveries' | 'newBlockages' | 'arrivals';

/** Un ticket d'un genre, avec le Projet qui le porte et la date (ms) de son dernier événement de la fenêtre. */
export interface SinceTicket {
  project: string;
  id: string;
  title: string;
  type: string;
  priority: number;
  at: number;
}

/** Un genre et ses tickets, du plus récent au plus ancien ; son compte est leur nombre. Un Bug d'origine dit les Livraisons qu'il met en échec. */
export type SinceGroup =
  | { kind: Exclude<SinceKind, 'escapedBugs'>; tickets: SinceTicket[] }
  | { kind: 'escapedBugs'; tickets: Array<SinceTicket & { deliveries: string[] }> };

interface Entry {
  project: MetricsInput;
  ticket: TrackedTicket;
}

/**
 * Les genres de la fenêtre, dans l'ordre où l'accueil les montre, chacun avec ses tickets (une liste vide : rien de ce genre ne s'est passé). Les tickets
 * À valider à l'instant des données (`AWAITING_VALIDATION`) n'y sont pas.
 *
 * Ajouter un genre : son nom dans `SinceKind`, sa ligne ici à sa place, son libellé dans les deux langues du catalogue (le compilateur le demande). Les
 * Livraisons sans Feu vert prendront la tête, avant les Réouvertures ; les Retours se placeront entre les Livraisons et les nouveaux Blocages. Un genre qui
 * demande des Statuts de relais n'a de sens que pour les Projets qui en déclarent : quand aucun n'en déclare, il n'est pas rendu du tout, plutôt que rendu
 * vide. Un genre rendu, même vide, est un genre disponible.
 */
export function sinceLastVisit(projects: MetricsInput[], window: LastVisitWindow): SinceGroup[] {
  const entries: Entry[] = projects.flatMap((project) =>
    project.analysis.tickets
      .filter((ticket) => statusAt(ticket.timeline, window.end) !== AWAITING_VALIDATION)
      .map((ticket) => ({ project, ticket })),
  );
  return [
    { kind: 'reopenings', tickets: listed(entries, (ticket) => reopeningsOf(ticket, window)) },
    { kind: 'escapedBugs', tickets: escapedBugsIn(entries, window) },
    { kind: 'deliveries', tickets: listed(entries, ({ deliveredAt }) => (within(deliveredAt, window) ? [deliveredAt] : [])) },
    { kind: 'newBlockages', tickets: listed(entries, (ticket) => ticket.timeline.blockages.map(([start]) => start).filter((start) => within(start, window))) },
    { kind: 'arrivals', tickets: listed(entries, ({ createdAt }) => (within(createdAt, window) ? [createdAt] : [])) },
  ];
}

/** L'instant est dans la fenêtre : son premier instant compris, le premier instant qui suit exclu. */
const within = (instant: number | null, window: LastVisitWindow): instant is number =>
  instant !== null && instant >= window.start && instant < window.end;

/** Les Réouvertures du ticket dans la fenêtre : ses Transitions se suivent sans répéter un statut, donc tout changement depuis fermé en est une. */
function reopeningsOf(ticket: TrackedTicket, window: LastVisitWindow): number[] {
  const { steps } = ticket.timeline;
  return steps.flatMap((step, index) => (steps[index - 1]?.status === 'closed' && within(step.at, window) ? [step.at] : []));
}

/** Les tickets qui ont au moins un événement (`eventsOf`) dans la fenêtre, une fois chacun, datés du dernier, du plus récent au plus ancien. */
function listed(entries: Entry[], eventsOf: (ticket: TrackedTicket) => number[]): SinceTicket[] {
  return entries
    .flatMap(({ project, ticket }) => {
      const events = eventsOf(ticket);
      return events.length === 0 ? [] : [row(project, ticket, Math.max(...events))];
    })
    .sort(byRecency);
}

/**
 * Les Bugs d'origine trouvés dans la fenêtre : chaque bug une fois, avec les Livraisons qu'il y met en échec. Le bug est trouvé à la date qui compte pour le
 * Taux d'échec et le Retravail (`TrackedTicket.originBugs`) : la création du bug qui a constaté le défaut.
 */
function escapedBugsIn(entries: Entry[], window: LastVisitWindow): Array<SinceTicket & { deliveries: string[] }> {
  const found = new Map<string, { project: MetricsInput; at: number; deliveries: string[] }>();
  for (const { project, ticket } of entries) {
    for (const bug of ticket.originBugs) {
      if (!within(bug.at, window)) continue;
      const key = `${project.id}\u0000${bug.id}`;
      const known = found.get(key);
      if (known) {
        known.at = Math.max(known.at, bug.at);
        known.deliveries.push(ticket.id);
      } else {
        found.set(key, { project, at: bug.at, deliveries: [ticket.id] });
      }
    }
  }
  const byId = new Map(entries.map((entry) => [`${entry.project.id}\u0000${entry.ticket.id}`, entry]));
  return [...found]
    .flatMap(([key, { project, at, deliveries }]) => {
      // Un bug À valider (écarté des entrées) n'est pas listé ; un bug sans historique non plus : on ne saurait pas le nommer.
      const bug = byId.get(key)?.ticket;
      return bug ? [{ ...row(project, bug, at), deliveries: deliveries.sort(compareText) }] : [];
    })
    .sort(byRecency);
}

function row(project: MetricsInput, { id, title, type, priority }: TrackedTicket, at: number): SinceTicket {
  return { project: project.id, id, title, type, priority, at };
}

/** Ordre des unités de code, le même sur toutes les machines (contrairement à `localeCompare`). */
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Du plus récent au plus ancien ; à égalité, par Projet puis par ticket, pour un ordre stable. */
const byRecency = (a: SinceTicket, b: SinceTicket) => b.at - a.at || compareText(a.project, b.project) || compareText(a.id, b.id);
