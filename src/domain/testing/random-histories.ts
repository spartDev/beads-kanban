import type { DependencyHistory, StatusSnapshot, TicketHistory, TicketId } from '../flow';

/**
 * Du hasard pour les tests du domaine : des historiques de tickets tirés avec une graine fixe, donc les mêmes à chaque
 * exécution. Ils servent aux tests de propriétés (« pour tout historique, ... »), là où un exemple écrit à la main ne
 * couvre qu'un cas : surtout les horloges de commit qui reculent, que la lignée de Dolt ne prévient pas.
 */

/** Un entier tiré au hasard de 0 à n − 1. */
export type Random = (n: number) => number;

/** Générateur congruentiel linéaire (constantes de Numerical Recipes) : médiocre, mais déterministe et sans dépendance. */
export function seededRandom(seed: number): Random {
  let state = seed;
  return (n) => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return Math.floor((state / 4_294_967_296) * n);
  };
}

const HOUR = 3_600_000;
const STATUSES = ['open', 'in_progress', 'blocked', 'deferred', 'hooked', 'closed'];
/** Le 1er octobre 2026, 00:00 UTC. */
const BASE = Date.UTC(2026, 9, 1);

export interface RandomHistoryOptions {
  /** Combien de tickets compte le Projet : ils se bloquent les uns les autres. */
  tickets: number;
  /**
   * Chances sur cent qu'un instantané soit daté avant le précédent, de 1 à 20 heures : l'horloge de son commit a reculé
   * (avec `sharedClock`, qu'un commit le soit). À 0, les dates ne font que croître.
   */
  clockBack: number;
  /**
   * Une seule horloge pour tout le Projet, au lieu d'une par ticket : voir `randomLineage`. Faux par défaut.
   */
  sharedClock?: boolean;
}

/** Les deux façons de dater un tirage, pour `it.each` : une horloge par ticket, ou une seule pour le Projet (`sharedClock`). */
export const CLOCKS = [
  ['une horloge par ticket', false],
  ['une horloge partagée par le Projet', true],
] as const;

/**
 * Les historiques d'un Projet tiré au hasard : chaque ticket est créé ouvert, change de statut de 0 à 7 fois (tous les
 * statuts, fermé compris, donc des Réouvertures) et finit fermé trois fois sur quatre. Les instantanés sont dans l'ordre
 * des commits, comme les donne le lecteur Dolt, et non celui des dates.
 *
 * Par défaut, chaque ticket a sa propre horloge, indépendante de celle des autres ; les dépendances `blocks` vont d'un
 * ticket à un autre, parfois posées avant la création du ticket, un tiers retirées (jamais avant d'avoir été posées), à des
 * dates qui ne sont celles d'aucun commit. Avec `sharedClock`, tous les tickets suivent la même lignée de commits, comme
 * dans un Projet Dolt (voir `randomLineage`).
 */
export function randomHistories(random: Random, options: RandomHistoryOptions): TicketHistory[] {
  if (options.sharedClock) return randomLineage(random, options).histories;
  const { tickets: count, clockBack } = options;
  const ids = Array.from({ length: count }, (_, index) => `t-${index}`);
  return ids.map((id) => history(random, id, ids.filter((other) => other !== id), clockBack));
}

/** Un commit de la lignée tirée au hasard : sa date, les tickets dont il change le statut, ceux dont il change les dépendances. */
export interface LineageCommit {
  at: Date;
  tickets: TicketId[];
  linked: TicketId[];
}

export interface RandomLineage {
  histories: TicketHistory[];
  /** Les commits dans l'ordre de la lignée : celui de leurs instantanés, qui n'est pas celui de leurs dates. */
  commits: LineageCommit[];
}

/**
 * La lignée d'un Projet tiré au hasard, avec une seule horloge pour tous ses tickets. Les commits se suivent dans un ordre
 * unique, datés chacun de cette horloge, qui recule avec `clockBack` chances sur cent d'un commit au suivant (de 1 à 20
 * heures). Un commit change le statut d'un ou deux tickets, à sa date, et peut poser ou retirer une dépendance `blocks` entre
 * deux tickets déjà créés, à la même date : un recul touche donc tous les tickets de ce commit à la fois, même ceux dont les
 * propres dates croissent (ils n'avaient pas changé au commit d'avant), et les dates des dépendances sont celles des commits
 * des statuts, comme dans l'historique Dolt. Un ticket sur quatre est un bug, relié à sa création (`discovered-from`) à un
 * ticket déjà créé, souvent déjà fermé : celui à partir duquel il a été découvert.
 */
export function randomLineage(random: Random, { tickets: count, clockBack }: RandomHistoryOptions): RandomLineage {
  const ids = Array.from({ length: count }, (_, index) => `t-${index}`);
  const todo = new Map(ids.map((id) => [id, statusPlan(random)]));
  const snapshots = new Map(ids.map((id) => [id, [] as StatusSnapshot[]]));
  const links = new Map(ids.map((id) => [id, [] as DependencyHistory[]]));
  const types = new Map(ids.map((id) => [id, random(4) === 0 ? 'bug' : 'task']));
  const commits: LineageCommit[] = [];
  const created = () => ids.filter((id) => (snapshots.get(id)?.length ?? 0) > 0);
  const unfinished = () => ids.filter((id) => (todo.get(id)?.length ?? 0) > 0);

  let time = BASE + random(48) * HOUR;
  for (let pending = unfinished(); pending.length > 0; pending = unfinished()) {
    time += (random(100) < clockBack ? -(1 + random(20)) : 1 + random(30)) * HOUR;
    const at = new Date(time);
    const tickets = pick(random, pending, 1 + random(2));
    const linked = new Set<TicketId>();

    const existing = created();
    for (const id of tickets) {
      const creation = !existing.includes(id);
      snapshots.get(id)?.push({ status: todo.get(id)?.shift() ?? 'open', at });
      if (creation && types.get(id) === 'bug' && existing.length > 0) {
        // Un bug est souvent découvert après la livraison : une fois sur deux, il l'est à partir d'un ticket déjà fermé.
        const closed = existing.filter((other) => snapshots.get(other)?.at(-1)?.status === 'closed');
        const origins = closed.length > 0 && random(2) === 0 ? closed : existing;
        links.get(id)?.push({ type: 'discovered-from', target: origins[random(origins.length)] ?? '', addedAt: at });
        linked.add(id);
      }
    }

    // Une dépendance retirée l'est par un commit après celui qui l'a posée ; le lecteur ne date jamais un retrait avant l'ajout.
    if (random(4) === 0) {
      const active = ids.flatMap((id) => (links.get(id) ?? []).filter((link) => link.type === 'blocks' && !link.removedAt).map((link) => ({ id, link })));
      const retired = active[random(active.length)];
      if (retired) {
        retired.link.removedAt = new Date(Math.max(time, retired.link.addedAt.getTime()));
        linked.add(retired.id);
      }
    }
    const alive = created();
    if (alive.length > 1 && random(3) === 0) {
      const from = alive[random(alive.length)] ?? '';
      const target = alive.filter((id) => id !== from)[random(alive.length - 1)] ?? '';
      if (!links.get(from)?.some((link) => link.type === 'blocks' && link.target === target && !link.removedAt)) {
        links.get(from)?.push({ type: 'blocks', target, addedAt: at });
        linked.add(from);
      }
    }
    commits.push({ at, tickets, linked: [...linked] });
  }

  const histories = ids.map(
    (id): TicketHistory => ({
      id,
      type: types.get(id) ?? 'task',
      statusSnapshots: snapshots.get(id) ?? [],
      dependencies: [...(links.get(id) ?? [])].sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime() || a.target.localeCompare(b.target)),
    }),
  );
  return { histories, commits };
}

/** Les statuts que prend un ticket, dans l'ordre : créé ouvert, 0 à 7 changements, puis fermé trois fois sur quatre. */
function statusPlan(random: Random): string[] {
  const plan = ['open'];
  for (let changes = random(8); changes > 0; changes--) plan.push(STATUSES[random(STATUSES.length)] ?? 'open');
  if (random(4) > 0) plan.push('closed');
  return plan;
}

/** Jusqu'à `n` éléments distincts de `items`, tirés au hasard. */
function pick<T>(random: Random, items: readonly T[], n: number): T[] {
  const left = [...items];
  const picked: T[] = [];
  while (picked.length < n && left.length > 0) picked.push(...left.splice(random(left.length), 1));
  return picked;
}

function history(random: Random, id: string, others: string[], clockBack: number): TicketHistory {
  let time = BASE + random(48) * HOUR;
  let earliest = time;
  let latest = time;
  const snapshots: StatusSnapshot[] = [{ status: 'open', at: new Date(time) }];
  const next = (status: string) => {
    time += (random(100) < clockBack ? -(1 + random(20)) : 1 + random(30)) * HOUR;
    earliest = Math.min(earliest, time);
    latest = Math.max(latest, time);
    snapshots.push({ status, at: new Date(time) });
  };
  for (let changes = random(8); changes > 0; changes--) next(STATUSES[random(STATUSES.length)] ?? 'open');
  if (random(4) > 0) next('closed');

  const dependencies: DependencyHistory[] = [];
  for (let links = random(3); others.length > 0 && links > 0; links--) {
    const added = earliest + (random(Math.ceil((latest - earliest) / HOUR) + 10) - 10) * HOUR;
    const removed = random(3) === 0 ? added + (1 + random(40)) * HOUR : undefined;
    const target = others[random(others.length)] ?? '';
    dependencies.push({ type: 'blocks', target, addedAt: new Date(added), ...(removed ? { removedAt: new Date(removed) } : {}) });
  }
  return { id, type: 'task', statusSnapshots: snapshots, dependencies };
}

/** L'horloge d'un commit a reculé : un instantané est daté avant celui qui le précède. */
export function clockWentBack(snapshots: readonly StatusSnapshot[]): boolean {
  return snapshots.some((snapshot, index) => index > 0 && snapshot.at.getTime() < (snapshots[index - 1]?.at.getTime() ?? 0));
}
