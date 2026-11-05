import { describe, expect, it } from 'vitest';
import { analyzeFlow, type TicketHistory } from '../../domain/flow';
import { randomLineage, type Random, seededRandom } from '../../domain/testing/random-histories';
import { ascendingDates } from './commit-dates';

/**
 * Les propriétés d'`ascendingDates`, sur des suites tirées au hasard (graine fixe), puis ce qu'elles font au domaine : des lignées dont
 * quelques horloges se trompent, relues par le lecteur, doivent donner au domaine les mêmes issues que les lignées sans faute.
 * Elles viennent de la relecture de bdesk-38k.26, qui les a écrites contre une force brute.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Le 1er octobre 2026, 00:00 UTC. */
const BASE = Date.UTC(2026, 9, 1);
/** Un instant de lecture postérieur à toutes les dates tirées : aucune n'y est « dans le futur ». */
const AFTER_ALL = new Date(Date.UTC(2100, 0, 1));

interface Commit {
  hash: string;
  at: Date;
}
const commitsAt = (times: readonly number[]): Commit[] => times.map((time, i) => ({ hash: `c${i}`, at: new Date(time) }));
const timesOf = (commits: readonly Commit[]) => commits.map((commit) => commit.at.getTime());

/** La longueur de la plus longue suite non décroissante de `times` (sous-suite, pas forcément contiguë), par force brute : n ≤ 12. */
function longestBrute(times: readonly number[]): number {
  let best = 0;
  for (let mask = 0; mask < 1 << times.length; mask++) {
    let last = Number.NEGATIVE_INFINITY;
    let length = 0;
    let ascending = true;
    for (let i = 0; i < times.length && ascending; i++) {
      if (!(mask & (1 << i))) continue;
      if ((times[i] as number) < last) ascending = false;
      last = times[i] as number;
      length++;
    }
    if (ascending) best = Math.max(best, length);
  }
  return best;
}

/** Quatre façons de tirer des dates : beaucoup d'égalités, décroissantes, toutes égales, et des reculs et des avances de 1 à 30 jours. */
function drawTimes(random: Random, length: number, mode: number): number[] {
  if (mode === 0) return Array.from({ length }, () => BASE + random(4) * HOUR);
  if (mode === 1) return Array.from({ length }, (_, i) => BASE + (length - i) * HOUR);
  if (mode === 2) return Array.from({ length }, () => BASE);
  let time = BASE;
  return Array.from({ length }, () => {
    const dice = random(10);
    time += dice < 2 ? -(1 + random(30)) * DAY : dice < 4 ? (1 + random(30)) * DAY : random(3) * HOUR;
    return time;
  });
}

/** L'instant de la lecture, selon les dates tirées. */
type ReadAt = (times: readonly number[]) => Date;
const READINGS: [label: string, readAt: ReadAt, drawsFutures: boolean][] = [
  ['sans instant de lecture qui compte', () => AFTER_ALL, false],
  ['avec un instant de lecture au milieu des dates', (times) => new Date(BASE + (Math.max(BASE, ...times) - BASE) / 2), true],
];

describe.each(READINGS)('ascendingDates, au hasard (%s)', (_, readAt, drawsFutures) => {
  it('rend des dates croissantes en changeant le minimum de commits, les commits gardés tels quels, sans rien inventer', () => {
    const random = seededRandom(2611);
    let futures = 0;
    for (let run = 0; run < 6000; run++) {
      const times = drawTimes(random, random(13), random(4));
      const now = readAt(times);
      const limit = now.getTime();
      const input = commitsAt(times);
      const before = timesOf(input);

      const output = ascendingDates(input, now);

      const after = timesOf(output);
      expect(timesOf(input), 'les entrées ne sont pas modifiées').toEqual(before);
      expect(output).toHaveLength(times.length);
      for (let i = 1; i < after.length; i++) expect(after[i], `croissant : ${times} → ${after}`).toBeGreaterThanOrEqual(after[i - 1] as number);
      after.forEach((time) => expect(time, `jamais après l'instant de la lecture : ${times} → ${after}`).toBeLessThanOrEqual(limit));
      futures += times.filter((time) => time > limit).length;
      // Les commits que l'on rend tels quels forment exactement une plus longue suite croissante de ceux dont la date n'est pas future.
      output.forEach((commit, i) => {
        expect(commit.hash).toBe(input[i]?.hash);
        if (commit === input[i]) expect(after[i]).toBe(times[i]);
        else expect(after[i], `changé : ${times} → ${after}`).not.toBe(times[i]);
      });
      const unchanged = output.filter((commit, i) => commit === input[i]).length;
      expect(unchanged, `minimum : ${times} → ${after}`).toBe(longestBrute(times.filter((time) => time <= limit)));
      // Une date de sortie est une date d'entrée, ou l'instant de la lecture (un commit daté du futur, le dernier de la lignée).
      output.forEach((commit) => expect([...times, limit]).toContain(commit.at.getTime()));
      // Idempotente : relire ce qui est déjà croissant ne change plus rien.
      ascendingDates(output, now).forEach((commit, i) => expect(commit).toBe(output[i]));
    }
    // Le tirage exerce le cas : avec un instant de lecture au milieu des dates, bien des dates sont dans le futur.
    if (drawsFutures) expect(futures).toBeGreaterThan(1000);
    else expect(futures).toBe(0);
  }, 120_000);
});

describe('ascendingDates, cas limites', () => {
  it('rend des dates toutes égales telles quelles, une suite décroissante à la date du plus ancien', () => {
    expect(timesOf(ascendingDates(commitsAt([BASE, BASE, BASE]), AFTER_ALL))).toEqual([BASE, BASE, BASE]);
    expect(timesOf(ascendingDates(commitsAt([BASE + 3, BASE + 2, BASE + 1]), AFTER_ALL))).toEqual([BASE + 3, BASE + 3, BASE + 3]);
  });

  it('à plusieurs plus longues suites de même longueur, garde la plus ancienne : le résultat est le même à chaque lecture', () => {
    const commits = commitsAt([BASE + 5, BASE + 1, BASE + 6, BASE + 2]);

    expect(timesOf(ascendingDates(commits, AFTER_ALL))).toEqual([BASE + 5, BASE + 5, BASE + 6, BASE + 6]);
    expect(timesOf(ascendingDates(commits, AFTER_ALL))).toEqual([BASE + 5, BASE + 5, BASE + 6, BASE + 6]);
  });

  it('ramène une date entre les bornes que lui laissent ses voisins : celle du commit gardé qui précède, ou de celui qui suit', () => {
    expect(timesOf(ascendingDates(commitsAt([BASE + 1, BASE + 3, BASE + 3, BASE + 2]), AFTER_ALL))).toEqual([BASE + 1, BASE + 3, BASE + 3, BASE + 3]);
  });

  it('un commit de plus peut redater des commits passés : la règle porte sur toute la lignée, non sur le commit seul', () => {
    // Deux commits que tout oppose gardent la date du plus ancien ; un troisième dit lequel avait tort, et les dates déjà lues changent.
    expect(timesOf(ascendingDates(commitsAt([BASE + 10 * HOUR, BASE + 5 * HOUR]), AFTER_ALL))).toEqual([BASE + 10 * HOUR, BASE + 10 * HOUR]);
    expect(timesOf(ascendingDates(commitsAt([BASE + 10 * HOUR, BASE + 5 * HOUR, BASE + 6 * HOUR]), AFTER_ALL))).toEqual([BASE + 5 * HOUR, BASE + 5 * HOUR, BASE + 6 * HOUR]);
  });

  it('ne date pas dans le futur le dernier commit, à l’heure, qui suit un commit daté du futur', () => {
    const now = new Date(BASE + 90 * DAY);
    const commits = commitsAt([now.getTime() - 3 * DAY, now.getTime() - 2 * DAY, now.getTime() + 30 * DAY, now.getTime() - DAY]);

    const output = timesOf(ascendingDates(commits, now));

    expect(output).toEqual([now.getTime() - 3 * DAY, now.getTime() - 2 * DAY, now.getTime() - DAY, now.getTime() - DAY]); // et non « dans trente jours »
  });

  it('reste en n log n : 200 000 commits fautés en quelques secondes au plus, là où un calcul en n² en demanderait des dizaines', () => {
    const times = drawTimes(seededRandom(7), 200_000, 3);
    const commits = commitsAt(times);

    const start = performance.now();
    const output = ascendingDates(commits, AFTER_ALL);
    const elapsed = performance.now() - start;

    expect(timesOf(output).every((time, i, all) => i === 0 || time >= (all[i - 1] as number))).toBe(true);
    expect(elapsed).toBeLessThan(10_000);
  }, 60_000);
});

/**
 * Une lignée sans faute (la vérité), puis des horloges fautées (20 % des commits : de 1 à 20 heures, ou de 1 à 30 jours, trop tôt ou
 * trop tard), puis ce que le lecteur en fait : `ascendingDates`, et les dates des événements remises, commit par commit, à celles qu'il
 * rend. Des liens d'Abandon (les deux causes) sont posés à deux commits distincts, comme bd les écrit, sur la moitié des tickets.
 */
function faultedLineage(seed: number, readAt: (truth: number[]) => Date) {
  const random = seededRandom(seed);
  const { histories, commits } = randomLineage(random, { tickets: 3 + random(10), clockBack: 0, sharedClock: true });
  // Les dates de la vérité croissent strictement (de 1 à 30 heures d'un commit au suivant) : la date identifie le commit.
  const truthTimes = commits.map((commit) => commit.at.getTime());
  for (const history of histories) {
    if (random(2) !== 0 || truthTimes.length < 2) continue;
    const first = random(truthTimes.length);
    const second = random(truthTimes.length);
    if (first === second) continue;
    for (const [rank, type] of [[first, 'duplicates'], [second, 'supersedes']] as const) {
      const at = commits[rank]?.at as Date;
      history.dependencies.push({ type, target: `x-${type}`, addedAt: at, createdAt: new Date(at.getTime()) });
    }
  }
  const rankOf = new Map(truthTimes.map((time, i) => [time, i]));
  const observed = truthTimes.map((time) => {
    const dice = random(20);
    if (dice === 0) return time - (1 + random(30)) * DAY;
    if (dice === 1) return time + (1 + random(30)) * DAY;
    if (dice === 2) return time - (1 + random(20)) * HOUR;
    if (dice === 3) return time + (1 + random(20)) * HOUR;
    return time;
  });
  const repaired = timesOf(ascendingDates(commitsAt(observed), readAt(truthTimes)));
  const rebuild = (dates: number[]): TicketHistory[] => {
    const redate = (date: Date) => new Date(dates[rankOf.get(date.getTime()) as number] as number);
    return histories.map((history) => ({
      ...history,
      statusSnapshots: history.statusSnapshots.map((snapshot) => ({ ...snapshot, at: redate(snapshot.at) })),
      dependencies: history.dependencies.map((dependency) => ({
        ...dependency,
        addedAt: redate(dependency.addedAt),
        ...(dependency.removedAt ? { removedAt: redate(dependency.removedAt) } : {}),
      })),
    }));
  };
  return { truth: histories, raw: rebuild(observed), fixed: rebuild(repaired) };
}

/** L'instant de la lecture, selon les dates de la lignée sans faute. */
const LINEAGE_READINGS: [label: string, readAt: (truth: number[]) => Date][] = [
  ['sans instant de lecture qui compte', () => AFTER_ALL],
  ['lu juste après le dernier commit', (truth) => new Date(Math.max(...truth) + 12 * HOUR)],
];

describe.each(LINEAGE_READINGS)('ascendingDates sur des lignées dont quelques horloges se trompent (%s)', (_, readAt) => {
  it('rend au domaine des dates qui tiennent ses invariants et lui donnent les issues de la lignée sans faute', () => {
    let wrongWithRawDates = 0;
    let wrongWithRepairedDates = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const { truth, raw, fixed } = faultedLineage(seed, readAt);
      // Sur ce que rend le lecteur, chaque ticket a des instantanés croissants, et chaque dépendance un retrait après sa pose.
      for (const history of fixed) {
        for (let i = 1; i < history.statusSnapshots.length; i++) {
          expect(history.statusSnapshots[i]?.at.getTime()).toBeGreaterThanOrEqual(history.statusSnapshots[i - 1]?.at.getTime() as number);
        }
        for (const dependency of history.dependencies) {
          if (dependency.removedAt) expect(dependency.removedAt.getTime()).toBeGreaterThanOrEqual(dependency.addedAt.getTime());
        }
      }
      const truthFlows = analyzeFlow(truth);
      const rawFlows = analyzeFlow(raw);
      const flows = analyzeFlow(fixed);
      for (const [id, flow] of flows) {
        const transitions = flow.transitions.map((transition) => transition.at.getTime());
        transitions.forEach((time, i) => expect(time).toBeGreaterThanOrEqual(transitions[i - 1] ?? Number.NEGATIVE_INFINITY));
        if (flow.leadTime !== null) expect(flow.leadTime).toBeGreaterThanOrEqual(0);
        if (flow.cycleTime !== null && flow.leadTime !== null) expect(flow.cycleTime).toBeLessThanOrEqual(flow.leadTime);
        if (flow.blockedTime !== null) expect(flow.blockedTime).toBeGreaterThanOrEqual(0);
        if (flow.blockedTime !== null && flow.cycleTime !== null) expect(flow.blockedTime).toBeLessThanOrEqual(flow.cycleTime);
        if (flow.dependencyWait !== null) expect(flow.dependencyWait).toBeGreaterThanOrEqual(0);
        if (flow.dependencyWait !== null && flow.cycleTime !== null && flow.leadTime !== null) {
          expect(flow.dependencyWait + flow.cycleTime).toBeLessThanOrEqual(flow.leadTime);
        }
        const expected = truthFlows.get(id);
        expect(flow.transitions.map((transition) => transition.status)).toEqual(expected?.transitions.map((transition) => transition.status));
        expect(flow.reopenings).toBe(expected?.reopenings);
        const kind = (outcome: typeof flow.outcome | undefined) =>
          outcome?.kind === 'abandoned' ? `${outcome.kind}:${outcome.cause}:${outcome.of}` : (outcome?.kind ?? 'open');
        if (kind(flow.outcome) !== kind(expected?.outcome)) wrongWithRepairedDates++;
        if (kind(rawFlows.get(id)?.outcome) !== kind(expected?.outcome)) wrongWithRawDates++;
      }
    }
    // Les dates brutes (le lecteur de HEAD) se trompent d'issue, notamment d'Abandon quand deux liens se départagent par leur commit ;
    // les dates remises dans l'ordre de la lignée, jamais.
    expect(wrongWithRawDates).toBeGreaterThan(20);
    expect(wrongWithRepairedDates).toBe(0);
  }, 120_000);

  it('sans faute, rend exactement les dates de la lignée', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { commits } = randomLineage(seededRandom(seed), { tickets: 8, clockBack: 0, sharedClock: true });
      const input = commits.map((commit, i) => ({ hash: `${i}`, at: commit.at }));

      const output = ascendingDates(input, readAt(commits.map((commit) => commit.at.getTime())));

      output.forEach((commit, i) => expect(commit).toBe(input[i]));
    }
  });
});
