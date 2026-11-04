import { describe, expect, it } from 'vitest';
import { clockWentBack, randomHistories, randomLineage, seededRandom } from './random-histories';

/**
 * Le générateur d'historiques aléatoires des tests du domaine. Avec une horloge partagée, il tire la lignée d'un Projet : une
 * suite de commits, tous datés de la même horloge, qui peut reculer. C'est ce qui lui fait voir ce qu'une horloge par ticket ne
 * montre pas : un recul qui touche plusieurs tickets à la fois, et des dates de dépendances qui sont celles des mêmes commits que
 * les statuts.
 */
const OPTIONS = { tickets: 6, clockBack: 25 };

describe('historiques tirés au hasard', () => {
  it('tire les mêmes historiques à graine égale, avec ou sans horloge partagée, et pas les mêmes dans les deux cas', () => {
    const draw = (sharedClock: boolean) => randomHistories(seededRandom(20_261_111), { ...OPTIONS, sharedClock });

    expect(draw(false)).toEqual(draw(false));
    expect(draw(true)).toEqual(draw(true));
    expect(draw(true)).not.toEqual(draw(false));
  });

  describe('horloge partagée', () => {
    it('suit une seule lignée : chaque ticket porte, dans l’ordre, les dates des commits qui le changent', () => {
      const random = seededRandom(20_261_112);
      for (let round = 0; round < 100; round++) {
        const { histories, commits } = randomLineage(random, OPTIONS);

        for (const history of histories) {
          const dates = commits.filter((commit) => commit.tickets.includes(history.id)).map((commit) => commit.at.getTime());
          expect(history.statusSnapshots.map((snapshot) => snapshot.at.getTime()), `${round}/${history.id}`).toEqual(dates);
        }
        for (const commit of commits) expect(new Set(commit.tickets).size, `${round} : tickets d’un commit`).toBe(commit.tickets.length);
      }
    });

    it('fait reculer l’horloge pour plusieurs tickets à la fois, y compris ceux dont les propres dates ne reculent pas', () => {
      const random = seededRandom(20_261_113);
      const backwards = { commits: 0, severalTickets: 0, invisibleToTheTicket: 0 };
      for (let round = 0; round < 200; round++) {
        const { histories, commits } = randomLineage(random, OPTIONS);

        commits.forEach((commit, index) => {
          const previous = commits[index - 1];
          if (!previous || commit.at.getTime() >= previous.at.getTime()) return;
          backwards.commits++;
          if (commit.tickets.length > 1) backwards.severalTickets++;
          // Le recul est celui du Projet, pas celui d'un ticket : un ticket que ce commit change n'a pas forcément changé au commit
          // d'avant, et ses propres dates peuvent croître. Seule une borne posée sur toute la lignée le verrait.
          const own = (id: string) => histories.find((history) => history.id === id)?.statusSnapshots ?? [];
          backwards.invisibleToTheTicket += commit.tickets.filter((id) => !clockWentBack(own(id))).length;
        });
      }

      expect(backwards.commits).toBeGreaterThan(300);
      expect(backwards.severalTickets).toBeGreaterThan(100);
      expect(backwards.invisibleToTheTicket).toBeGreaterThan(100);
    });

    it('ne fait que croître quand l’horloge ne recule pas', () => {
      const random = seededRandom(20_261_114);
      for (let round = 0; round < 100; round++) {
        const { histories, commits } = randomLineage(random, { tickets: 6, clockBack: 0 });

        commits.forEach((commit, index) => expect(commit.at.getTime(), `${round}/${index}`).toBeGreaterThan(commits[index - 1]?.at.getTime() ?? Number.NEGATIVE_INFINITY));
        for (const history of histories) expect(clockWentBack(history.statusSnapshots), `${round}/${history.id}`).toBe(false);
      }
    });

    it('date les dépendances des commits de la lignée, après la création du ticket qui les porte', () => {
      const random = seededRandom(20_261_115);
      let links = 0;
      let removed = 0;
      for (let round = 0; round < 100; round++) {
        const { histories, commits } = randomLineage(random, OPTIONS);

        for (const history of histories) {
          const created = commits.findIndex((commit) => commit.tickets.includes(history.id));
          for (const link of history.dependencies) {
            links++;
            const where = `${round}/${history.id} → ${link.target}`;
            expect(link.target, `${where} : cible`).not.toBe(history.id);
            expect(histories.some((other) => other.id === link.target), `${where} : cible du Projet`).toBe(true);
            const addedBy = commits.findIndex((commit, index) => index >= created && commit.linked.includes(history.id) && commit.at.getTime() === link.addedAt.getTime());
            expect(addedBy, `${where} : posée par un commit, après la création du ticket`).toBeGreaterThanOrEqual(0);
            if (!link.removedAt) continue;
            removed++;
            expect(link.removedAt.getTime(), `${where} : retirée après avoir été posée`).toBeGreaterThanOrEqual(link.addedAt.getTime());
            expect(commits.some((commit) => commit.at.getTime() === link.removedAt?.getTime()), `${where} : retirée par un commit`).toBe(true);
          }
        }
      }

      expect(links).toBeGreaterThan(500);
      expect(removed).toBeGreaterThan(100);
    });

    it('relie chaque bug, à sa création, au ticket en cours duquel il a été découvert', () => {
      const random = seededRandom(20_261_116);
      let bugs = 0;
      let linked = 0;
      for (let round = 0; round < 100; round++) {
        const { histories, commits } = randomLineage(random, OPTIONS);

        for (const bug of histories.filter((history) => history.type === 'bug')) {
          bugs++;
          const origin = bug.dependencies.find((link) => link.type === 'discovered-from');
          if (!origin) continue;
          linked++;
          const creation = commits.findIndex((commit) => commit.tickets.includes(bug.id));
          const originCreation = commits.findIndex((commit) => commit.tickets.includes(origin.target));
          expect(origin.addedAt, `${round}/${bug.id}`).toEqual(bug.statusSnapshots[0]?.at);
          expect(originCreation, `${round}/${bug.id} : l’origine existe déjà`).toBeLessThan(creation);
          expect(originCreation).toBeGreaterThanOrEqual(0);
        }
      }

      expect(bugs).toBeGreaterThan(100);
      expect(linked).toBeGreaterThan(bugs / 2);
    });
  });
});
