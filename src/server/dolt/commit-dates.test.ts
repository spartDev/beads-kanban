import { describe, expect, it } from 'vitest';
import { ascendingDates } from './commit-dates';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Le 1er octobre 2026, 00:00 UTC. */
const BASE = Date.UTC(2026, 9, 1);
/** Un instant de lecture postérieur à toutes les dates des tests qui n'en parlent pas : aucune n'y est « dans le futur ». */
const AFTER_ALL = new Date(Date.UTC(2100, 0, 1));

interface Commit {
  hash: string;
  at: Date;
}
/** Des commits `c0`, `c1`… dans l'ordre de la lignée, datés de ces heures après le 1er octobre 2026. */
const lineage = (...hours: number[]): Commit[] => hours.map((hour, i) => ({ hash: `c${i}`, at: new Date(BASE + hour * HOUR) }));
const hoursOf = (commits: readonly Commit[]) => commits.map((commit) => (commit.at.getTime() - BASE) / HOUR);
const changedHashes = (before: readonly Commit[], after: readonly Commit[]) => before.filter((commit, i) => commit !== after[i]).map((commit) => commit.hash);
/** `ascendingDates` quand l'instant de la lecture ne compte pas. */
const ascending = <T extends { at: Date }>(commits: readonly T[]): T[] => ascendingDates(commits, AFTER_ALL);

describe('ascendingDates', () => {
  describe('une lignée dont les horloges tiennent', () => {
    it('ne change rien à des dates croissantes, égalités comprises : les mêmes commits', () => {
      const commits = lineage(0, 1, 1, 5, 24, 24, 25);

      const result = ascending(commits);

      expect(result).toEqual(commits);
      result.forEach((commit, i) => expect(commit).toBe(commits[i]));
    });

    it('rend une lignée vide, ou d’un seul commit, telle quelle', () => {
      expect(ascending([])).toEqual([]);
      const [only] = lineage(7);
      expect(ascending([only as Commit])[0]).toBe(only);
    });
  });

  describe('une horloge qui a reculé', () => {
    it('ramène le commit en retard à la date du commit gardé qui le précède', () => {
      // c2 est daté à 11:00, après c1 à 14:00 dans la lignée : sa date est fausse, la lignée dit qu'il vient après.
      expect(hoursOf(ascending(lineage(10, 14, 11, 20)))).toEqual([10, 14, 14, 20]);
    });

    it('ramène de même plusieurs commits de suite, qui restent entre eux dans l’ordre de la lignée', () => {
      // Une machine à l'horloge en retard fait trois commits (50, 51, 52) après cinq commits à l'heure : ils prennent la date du dernier d'entre eux.
      expect(hoursOf(ascending(lineage(98, 99, 100, 101, 102, 50, 51, 52, 103, 104)))).toEqual([98, 99, 100, 101, 102, 102, 102, 102, 103, 104]);
    });

    it('ne change que le commit en retard, même s’il l’est de trente jours', () => {
      const commits = lineage(10, 11, 12 - 30 * 24, 13, 14);

      const result = ascending(commits);

      expect(hoursOf(result)).toEqual([10, 11, 11, 13, 14]);
      expect(changedHashes(commits, result)).toEqual(['c2']);
    });
  });

  describe('une horloge en avance', () => {
    it('ramène le commit en avance à la date du commit gardé qui le suit', () => {
      expect(hoursOf(ascending(lineage(10, 11, 12 + 30 * 24, 13, 14)))).toEqual([10, 11, 13, 13, 14]);
    });

    it('n’étend pas l’avance aux commits qui la suivent : un commit à trente jours de l’avenir n’en déplace qu’un', () => {
      // 500 commits à une heure d'écart ; le 200e est daté trente jours plus tard que sa place. Tous ceux qui le suivent sont
      // datés avant lui : borner chacun par le maximum des précédents les repousserait tous, jusqu'à ce que les dates le rattrapent.
      const commits = lineage(...Array.from({ length: 500 }, (_, i) => i + (i === 200 ? 30 * 24 : 0)));

      const result = ascending(commits);

      expect(changedHashes(commits, result)).toEqual(['c200']);
      expect(hoursOf(result)[200]).toBe(201); // la date du commit gardé qui le suit
    });

    it('ne peut rien contre une avance que nul commit ne contredit : le dernier commit, daté plus tard que tout le reste, garde sa date', () => {
      expect(hoursOf(ascending(lineage(10, 11, 12, 12 + 30 * 24)))).toEqual([10, 11, 12, 12 + 30 * 24]);
    });
  });

  describe('qui est en tort, du commit ou de ses voisins ?', () => {
    it('garde la suite la plus longue : le premier commit en avance est ramené, les trois qui le suivent restent', () => {
      expect(hoursOf(ascending(lineage(100, 1, 2, 3)))).toEqual([1, 1, 2, 3]);
    });

    it('garde la suite la plus longue : le dernier commit en retard est ramené, les trois qui le précèdent restent', () => {
      expect(hoursOf(ascending(lineage(1, 2, 3, 0)))).toEqual([1, 2, 3, 3]);
    });

    it('à longueur égale, garde les commits les plus anciens : le plus récent est celui dont on ramène la date', () => {
      // Deux commits que tout oppose, rien ne dit lequel a tort. Un changement de statut ne remonte pas le temps : c’est le second qui est ramené.
      expect(hoursOf(ascending(lineage(14, 11)))).toEqual([14, 14]);
      // Dans la lignée c0 → c1 → c2 → c3, c1 (14:00) et c2 (11:00) s'excluent, chacun avec c0 (10:00) et c3 (20:00) : c1, plus ancien, reste.
      expect(hoursOf(ascending(lineage(10, 14, 11, 20)))).toEqual([10, 14, 14, 20]);
    });

    it('ne laisse jamais deux commits dans le désordre, quoi qu’il arrive : le commit en avance puis le suivant en retard', () => {
      const result = ascending(lineage(10, 50, 12, 11, 13));

      expect(hoursOf(result).every((hour, i, hours) => i === 0 || hour >= (hours[i - 1] as number))).toBe(true);
      expect(hoursOf(result)).toEqual([10, 12, 12, 12, 13]);
    });
  });

  describe('une date postérieure à l’instant de la lecture', () => {
    // Un commit n'est pas fait dans le futur : une date postérieure à l'instant où l'on lit est forcément fausse, quelle que soit la
    // longueur de la suite qu'elle ouvrirait. Elle ne peut pas être gardée (revue de bdesk-38k.26, B1).
    const NOW = new Date(BASE + 100 * HOUR);

    it('ne se garde pas, même quand elle ouvre une suite aussi longue : le commit prend la date du commit gardé qui le suit', () => {
      // c2, à l'avance de 30 jours, et c3, à l'heure, forment deux suites de même longueur avec c0 et c1 : sans l'instant de la lecture, la plus
      // ancienne l'emporte, et c3 serait daté dans le futur.
      const commits = lineage(10, 20, 100 + 30 * 24, 90);

      const result = ascendingDates(commits, NOW);

      expect(hoursOf(result)).toEqual([10, 20, 90, 90]);
      expect(changedHashes(commits, result)).toEqual(['c2']);
    });

    it('prend l’instant de la lecture quand aucun commit gardé ne la suit : le dernier de la lignée, daté du futur, vient d’être fait', () => {
      expect(hoursOf(ascendingDates(lineage(10, 20, 100 + 30 * 24), NOW))).toEqual([10, 20, 100]);
    });

    it('les ramène tous à l’instant de la lecture quand plusieurs commits de suite sont datés du futur, derniers de la lignée', () => {
      expect(hoursOf(ascendingDates(lineage(10, 500, 510, 520), NOW))).toEqual([10, 100, 100, 100]);
    });

    it('écarte plusieurs dates futures qui s’intercalent entre des commits à l’heure : la suite à l’heure est gardée, chaque date future prend celle du commit gardé qui la suit', () => {
      const result = ascendingDates(lineage(10, 700, 20, 710, 30), NOW);

      expect(hoursOf(result)).toEqual([10, 20, 20, 30, 30]);
    });

    it('laisse à leur date les commits datés de l’instant même de la lecture : il n’est pas postérieur à lui-même', () => {
      const commits = lineage(10, 100);

      const result = ascendingDates(commits, NOW);

      result.forEach((commit, i) => expect(commit).toBe(commits[i]));
    });

    it('ramène tout à l’instant de la lecture quand toutes les dates lui sont postérieures : l’horloge de la lecture est alors en retard', () => {
      expect(hoursOf(ascendingDates(lineage(500, 510), NOW))).toEqual([100, 100]);
    });

    it('ne laisse pas une date future gagner une égalité contre des commits à l’heure, qu’ils soient avant ou après elle', () => {
      expect(hoursOf(ascendingDates(lineage(10, 500, 20), NOW))).toEqual([10, 20, 20]);
      expect(hoursOf(ascendingDates(lineage(500, 10, 20), NOW))).toEqual([10, 10, 20]);
    });
  });

  it('ne modifie pas ses entrées, et rend les mêmes commits avec leurs autres champs', () => {
    const commits = lineage(10, 14, 11, 20).map((commit) => ({ ...commit, message: `commit ${commit.hash}` }));
    const before = JSON.stringify(commits);

    const result = ascending(commits);

    expect(JSON.stringify(commits)).toBe(before);
    expect(result.map((commit) => [commit.hash, commit.message])).toEqual(commits.map((commit) => [commit.hash, commit.message]));
    expect(result[2]).not.toBe(commits[2]); // le commit ramené est un nouvel objet : l'original garde sa date
    expect(commits[2]?.at.getTime()).toBe(BASE + 11 * HOUR);
  });

  describe('au hasard (graine fixe)', () => {
    /** Générateur congruentiel linéaire : médiocre, mais déterministe et sans dépendance. */
    function seeded(seed: number) {
      let state = seed;
      return (n: number) => {
        state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
        return Math.floor((state / 4_294_967_296) * n);
      };
    }
    /** La longueur de la plus longue suite non décroissante de `values` (sous-suite, pas forcément contiguë), par programmation dynamique. */
    function longestNonDecreasing(values: number[]): number {
      const best = values.map(() => 1);
      values.forEach((value, i) => {
        for (let j = 0; j < i; j++) if ((values[j] as number) <= value) best[i] = Math.max(best[i] as number, (best[j] as number) + 1);
      });
      return Math.max(0, ...best);
    }

    it('rend des dates croissantes en n’en changeant que le minimum, et ne touche pas aux commits gardés', () => {
      const random = seeded(2026_11_05);
      for (let round = 0; round < 2000; round++) {
        const commits = lineage(...Array.from({ length: random(12) }, () => random(8)));

        const result = ascending(commits);

        const hours = hoursOf(result);
        expect(hours.every((hour, i) => i === 0 || hour >= (hours[i - 1] as number)), `croissant : ${hoursOf(commits)} → ${hours}`).toBe(true);
        expect(changedHashes(commits, result).length, `minimum : ${hoursOf(commits)} → ${hours}`).toBe(commits.length - longestNonDecreasing(hoursOf(commits)));
        result.forEach((commit, i) => expect(commit.hash).toBe(`c${i}`));
      }
    });

    it('ne change jamais plus de commits qu’il n’y en a de fautifs : une lignée croissante dont quelques horloges se trompent', () => {
      const random = seeded(38_026);
      let faulty = 0;
      let changed = 0;
      for (let round = 0; round < 2000; round++) {
        const size = 5 + random(60);
        let hour = 0;
        const truth = lineage(...Array.from({ length: size }, () => (hour += 1 + random(3)))); // 1 à 3 h d'un commit au suivant
        const wrong = new Set(Array.from({ length: random(4) }, () => random(size))); // jusqu'à trois horloges fautives
        const observed = truth.map((commit, i) =>
          wrong.has(i) ? { ...commit, at: new Date(commit.at.getTime() + (random(2) === 0 ? -1 : 1) * (1 + random(40)) * DAY) } : commit,
        );

        const result = ascending(observed);

        const count = observed.filter((commit, i) => commit !== result[i]).length;
        expect(count, `${[...wrong]} fautif(s), ${count} changé(s)`).toBeLessThanOrEqual(wrong.size);
        faulty += wrong.size;
        changed += count;
      }
      // Le tirage exerce le cas : des horloges fautives il y en a, et il en faut changer.
      expect(faulty).toBeGreaterThan(2000);
      expect(changed).toBeGreaterThan(1000);
    });
  });

  it('se calcule sur une très longue lignée : un Projet peut compter 10 000 commits', () => {
    const hours = Array.from({ length: 20_000 }, (_, i) => i + (i % 997 === 0 ? 40 * 24 : 0));
    const commits = lineage(...hours);

    const result = ascending(commits);

    const resultHours = hoursOf(result);
    expect(resultHours.every((hour, i) => i === 0 || hour >= (resultHours[i - 1] as number))).toBe(true);
    expect(changedHashes(commits, result)).toHaveLength(Math.ceil(20_000 / 997)); // seuls les commits fautifs changent (les rangs 0, 997, 1994…)
  });
});
