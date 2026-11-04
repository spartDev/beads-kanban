import { describe, expect, it } from 'vitest';
import { analyzeFailures } from './failures';
import { analyzeFlow, type TicketHistory } from './flow';
import { randomHistories, seededRandom } from './testing/random-histories';

const at = (iso: string) => new Date(`${iso}Z`);

function ticket(id: string, statuses: [string, string][], extra: Partial<TicketHistory> = {}): TicketHistory {
  return {
    id,
    type: 'task',
    statusSnapshots: statuses.map(([status, iso]) => ({ status, at: at(iso) })),
    dependencies: [],
    ...extra,
  };
}

/** Ticket fermé : une Livraison, sauf Epic ou Abandon. Livré le 3 octobre à 09:00 par défaut. */
const delivered = (id: string, closedAt = '2026-10-03T09:00', extra: Partial<TicketHistory> = {}) =>
  ticket(
    id,
    [
      ['open', '2026-10-01T09:00'],
      ['closed', closedAt],
    ],
    extra,
  );

const stillOpen = (id: string, extra: Partial<TicketHistory> = {}) => ticket(id, [['open', '2026-10-01T09:00']], extra);

/** Ticket fermé comme doublon d'un autre : un Abandon. */
const duplicate = (id: string) =>
  delivered(id, '2026-10-03T09:00', {
    dependencies: [{ type: 'duplicates', target: 'original', addedAt: at('2026-10-03T09:00') }],
  });

const discoveredFrom = (target: string) => ({ type: 'discovered-from', target, addedAt: at('2026-10-04T09:00') });

/** Bug resté ouvert, créé à `createdAt` et relié par discovered-from aux `targets`. */
const bug = (id: string, createdAt: string, ...targets: string[]) =>
  ticket(id, [['open', createdAt]], { type: 'bug', dependencies: targets.map(discoveredFrom) });

type AbandonLink = 'duplicates' | 'supersedes';

/**
 * Bug créé à `createdAt` puis fermé en Abandon : doublon de `survivor` (`duplicates`) ou remplacé par lui
 * (`supersedes`). Il a constaté le défaut en cours de travail sur les `origins`, vers lesquelles il est relié.
 */
const abandonedBug = (id: string, createdAt: string, link: AbandonLink, survivor: string, ...origins: string[]) =>
  ticket(
    id,
    [
      ['open', createdAt],
      ['closed', '2026-10-31T09:00'],
    ],
    {
      type: 'bug',
      dependencies: [...origins.map(discoveredFrom), { type: link, target: survivor, addedAt: at('2026-10-31T09:00') }],
    },
  );

const analyze = (tickets: TicketHistory[]) => analyzeFailures(tickets, analyzeFlow(tickets));

describe('analyzeFailures', () => {
  describe('Bug d’origine', () => {
    it('relie à sa Livraison un bug créé après elle', () => {
      const failures = analyze([delivered('t'), bug('b', '2026-10-04T09:00', 't')]);

      expect(failures.originBugs.get('t')).toEqual(['b']);
    });

    it('laisse sans Bug d’origine une Livraison qu’aucun bug ne met en cause', () => {
      const failures = analyze([delivered('t')]);

      expect(failures.originBugs.get('t')).toEqual([]);
    });

    it('ignore un ticket qui n’est pas un bug : une tâche découverte en chemin n’est pas un échec', () => {
      const task = { ...bug('c', '2026-10-04T09:00', 't'), type: 'chore' };

      const failures = analyze([delivered('t'), task]);

      expect(failures.originBugs.get('t')).toEqual([]);
    });

    it('ignore un bug créé avant la Livraison : trouvé en cours de travail, ce n’est pas un échec de livraison', () => {
      const failures = analyze([delivered('t', '2026-10-03T09:00'), bug('b', '2026-10-02T09:00', 't')]);

      expect(failures.originBugs.get('t')).toEqual([]);
    });

    it('compte un bug créé à l’instant même de la Livraison, quand ils partagent un commit', () => {
      const failures = analyze([delivered('t', '2026-10-03T09:00'), bug('b', '2026-10-03T09:00', 't')]);

      expect(failures.originBugs.get('t')).toEqual(['b']);
    });

    it('ignore un lien retiré depuis : l’origine a été corrigée', () => {
      const retired = {
        ...bug('b', '2026-10-04T09:00'),
        dependencies: [{ ...discoveredFrom('t'), removedAt: at('2026-10-05T09:00') }],
      };

      const failures = analyze([delivered('t'), retired]);

      expect(failures.originBugs.get('t')).toEqual([]);
    });

    it('n’attribue pas un bug sans historique : sa date de découverte est inconnue', () => {
      const undated = { ...bug('b', '2026-10-04T09:00', 't'), statusSnapshots: [] };

      const failures = analyze([delivered('t'), undated]);

      expect(failures.originBugs.get('t')).toEqual([]);
      expect(failures.bugs.get('b')).toEqual({ linked: true, failedDeliveries: [] });
    });

    it('ne tient compte que de discovered-from : un lien informatif ne désigne pas une origine', () => {
      const related = {
        ...bug('b', '2026-10-04T09:00'),
        dependencies: [
          { type: 'relates-to', target: 't', addedAt: at('2026-10-04T09:00') },
          { type: 'blocks', target: 't', addedAt: at('2026-10-04T09:00') },
        ],
      };

      const failures = analyze([delivered('t'), related]);

      expect(failures.originBugs.get('t')).toEqual([]);
    });
  });

  describe('cible qui n’est pas une Livraison', () => {
    it('ignore un ticket encore ouvert : le bug a été trouvé en cours de travail', () => {
      const failures = analyze([stillOpen('t'), bug('b', '2026-10-04T09:00', 't')]);

      expect(failures.originBugs.get('t')).toBeUndefined();
    });

    it('ignore un Abandon : rien n’a été livré', () => {
      const failures = analyze([duplicate('t'), bug('b', '2026-10-04T09:00', 't')]);

      expect(failures.originBugs.get('t')).toBeUndefined();
    });

    it('ignore une Epic sans en attribuer le bug à ses Enfants', () => {
      const epic = delivered('e', '2026-10-05T09:00', { type: 'epic' });
      const child = delivered('c', '2026-10-03T09:00', {
        dependencies: [{ type: 'parent-child', target: 'e', addedAt: at('2026-10-01T09:00') }],
      });

      const failures = analyze([epic, child, bug('b', '2026-10-06T09:00', 'e')]);

      expect(failures.originBugs.get('e')).toBeUndefined();
      expect(failures.originBugs.get('c')).toEqual([]);
    });

    it('ignore un ticket hors Projet', () => {
      const failures = analyze([bug('b', '2026-10-04T09:00', 'ailleurs-12')]);

      expect(failures.originBugs.get('ailleurs-12')).toBeUndefined();
    });
  });

  describe('Réouverture de la cible', () => {
    const closedThenReopened: [string, string][] = [
      ['open', '2026-10-01T09:00'],
      ['closed', '2026-10-03T09:00'],
      ['open', '2026-10-10T09:00'],
    ];
    const redelivered: [string, string][] = [...closedThenReopened, ['closed', '2026-10-12T09:00']];

    it('date la Livraison de la dernière clôture : un bug créé entre la première clôture et la Réouverture n’est pas un échec', () => {
      const failures = analyze([ticket('t', redelivered), bug('b', '2026-10-05T09:00', 't')]);

      expect(failures.originBugs.get('t')).toEqual([]);
    });

    it('relie à la Livraison un bug créé après la dernière clôture', () => {
      const failures = analyze([ticket('t', redelivered), bug('b', '2026-10-13T09:00', 't')]);

      expect(failures.originBugs.get('t')).toEqual(['b']);
    });

    it('n’attribue rien à un ticket rouvert tant qu’il n’est pas refermé', () => {
      const failures = analyze([ticket('t', closedThenReopened), bug('b', '2026-10-05T09:00', 't')]);

      expect(failures.originBugs.get('t')).toBeUndefined();
    });
  });

  describe('bug relié à plusieurs tickets', () => {
    it('est le Bug d’origine de chacune des Livraisons vers lesquelles il pointe', () => {
      const failures = analyze([
        delivered('t1', '2026-10-03T09:00'),
        delivered('t2', '2026-10-04T09:00'),
        bug('b', '2026-10-05T09:00', 't1', 't2'),
      ]);

      expect(failures.bugs.get('b')?.failedDeliveries).toEqual(['t1', 't2']);
      expect(failures.originBugs.get('t1')).toEqual(['b']);
      expect(failures.originBugs.get('t2')).toEqual(['b']);
    });

    it('n’est celui d’aucune des cibles qui ne sont pas des Livraisons antérieures', () => {
      const failures = analyze([
        delivered('livré', '2026-10-03T09:00'),
        stillOpen('en-cours'),
        delivered('livré-après', '2026-10-09T09:00'),
        bug('b', '2026-10-05T09:00', 'livré', 'en-cours', 'livré-après'),
      ]);

      expect(failures.bugs.get('b')?.failedDeliveries).toEqual(['livré']);
      expect(failures.originBugs.get('livré-après')).toEqual([]);
    });

    it('n’est compté qu’une fois par Livraison, même si le lien figure en double', () => {
      const failures = analyze([delivered('t'), bug('b', '2026-10-04T09:00', 't', 't')]);

      expect(failures.originBugs.get('t')).toEqual(['b']);
      expect(failures.bugs.get('b')?.failedDeliveries).toEqual(['t']);
    });
  });

  describe('Livraison visée par plusieurs bugs', () => {
    it('liste tous ses Bugs d’origine', () => {
      const failures = analyze([
        delivered('t'),
        bug('b1', '2026-10-04T09:00', 't'),
        bug('b2', '2026-10-06T09:00', 't'),
      ]);

      expect(failures.originBugs.get('t')).toEqual(['b1', 'b2']);
    });
  });

  describe('lien d’un bug vers lui-même', () => {
    it('ne compte pas comme relié un bug dont le seul lien pointe vers lui-même', () => {
      const failures = analyze([bug('b', '2026-10-04T09:00', 'b')]);

      expect(failures.coverage).toEqual({ bugs: 1, linked: 0, ratio: 0 });
      expect(failures.bugs.get('b')).toEqual({ linked: false, failedDeliveries: [] });
    });

    it('n’est jamais son propre Bug d’origine, même créé et fermé au même instant', () => {
      const closedAtCreation = ticket('b', [['closed', '2026-10-04T09:00']], {
        type: 'bug',
        dependencies: [discoveredFrom('b')],
      });

      const failures = analyze([closedAtCreation]);

      expect(failures.originBugs.get('b')).toEqual([]);
      expect(failures.bugs.get('b')).toEqual({ linked: false, failedDeliveries: [] });
    });

    it('ne retire que le lien vers lui-même : les autres liens du bug comptent toujours', () => {
      const failures = analyze([delivered('t'), bug('b', '2026-10-04T09:00', 'b', 't')]);

      expect(failures.bugs.get('b')).toEqual({ linked: true, failedDeliveries: ['t'] });
      expect(failures.originBugs.get('t')).toEqual(['b']);
    });
  });

  describe('bug en Abandon', () => {
    // Doublon d’un autre bug (`duplicates`) ou remplacé par lui (`supersedes`) : c’est le même défaut, qu’un seul des
    // deux bugs représente. Celui qui reste, le survivant, reprend les liens de l’autre.
    const withAbandoned = (link: AbandonLink) =>
      analyze([
        delivered('t'),
        bug('b1', '2026-10-04T09:00', 't'),
        abandonedBug('b2', '2026-10-04T10:00', link, 'b1', 't'),
      ]);

    it('n’est pas un Bug d’origine : c’est le même défaut qu’un autre bug', () => {
      expect(withAbandoned('duplicates').originBugs.get('t')).toEqual(['b1']);
    });

    it('ne figure pas parmi les bugs analysés', () => {
      expect([...withAbandoned('duplicates').bugs.keys()]).toEqual(['b1']);
    });

    it('n’est pas compté dans la Couverture', () => {
      expect(withAbandoned('duplicates').coverage).toEqual({ bugs: 1, linked: 1, ratio: 1 });
    });

    it('vaut aussi pour un bug remplacé par un autre', () => {
      const failures = withAbandoned('supersedes');

      expect(failures.originBugs.get('t')).toEqual(['b1']);
      expect(failures.coverage).toEqual({ bugs: 1, linked: 1, ratio: 1 });
    });

    describe('transmet ses liens au bug qui le remplace', () => {
      it.each<AbandonLink>(['duplicates', 'supersedes'])(
        'met la Livraison en échec par le bug qui remplace celui qui avait constaté le défaut (%s)',
        (link) => {
          const failures = analyze([
            delivered('livraison'),
            abandonedBug('b-ancien', '2026-10-04T09:00', link, 'b-nouveau', 'livraison'),
            bug('b-nouveau', '2026-10-05T09:00'),
          ]);

          expect(failures.originBugs.get('livraison')).toEqual(['b-nouveau']);
          expect(failures.bugs.get('b-nouveau')).toEqual({ linked: true, failedDeliveries: ['livraison'] });
        },
      );

      it('compte le survivant comme relié, sans que le bug en Abandon entre dans la Couverture', () => {
        const failures = analyze([
          stillOpen('en-cours'),
          abandonedBug('b-ancien', '2026-10-04T09:00', 'duplicates', 'b-nouveau', 'en-cours'),
          bug('b-nouveau', '2026-10-05T09:00'),
        ]);

        expect(failures.bugs.get('b-nouveau')).toEqual({ linked: true, failedDeliveries: [] });
        expect(failures.coverage).toEqual({ bugs: 1, linked: 1, ratio: 1 });
      });

      describe('date le lien transmis de la création du bug en Abandon, qui a constaté le défaut', () => {
        it('met la Livraison en échec s’il l’a constaté après elle, même si le survivant est plus ancien', () => {
          const failures = analyze([
            delivered('livraison', '2026-10-03T09:00'),
            bug('original', '2026-10-02T09:00'),
            abandonedBug('doublon', '2026-10-04T09:00', 'duplicates', 'original', 'livraison'),
          ]);

          expect(failures.originBugs.get('livraison')).toEqual(['original']);
        });

        it('ne la met pas en échec s’il l’a constaté avant elle, même si le survivant est plus récent', () => {
          const failures = analyze([
            delivered('livraison', '2026-10-03T09:00'),
            abandonedBug('doublon', '2026-10-02T09:00', 'duplicates', 'original', 'livraison'),
            bug('original', '2026-10-04T09:00'),
          ]);

          expect(failures.originBugs.get('livraison')).toEqual([]);
          expect(failures.bugs.get('original')).toEqual({ linked: true, failedDeliveries: [] });
        });
      });

      it('ne compte le survivant qu’une fois par Livraison, que le lien soit le sien ou transmis', () => {
        const failures = analyze([
          delivered('t1'),
          delivered('t2'),
          delivered('t3'),
          bug('survivant', '2026-10-05T09:00', 't1', 't2'),
          abandonedBug('doublon-1', '2026-10-04T09:00', 'duplicates', 'survivant', 't2', 't3'),
          abandonedBug('doublon-2', '2026-10-04T10:00', 'supersedes', 'survivant', 't3'),
        ]);

        expect(failures.bugs.get('survivant')?.failedDeliveries).toEqual(['t1', 't2', 't3']);
        expect([...failures.originBugs]).toEqual([
          ['t1', ['survivant']],
          ['t2', ['survivant']],
          ['t3', ['survivant']],
        ]);
      });

      it('suit la chaîne des remplacements jusqu’au survivant final', () => {
        const failures = analyze([
          delivered('t1'),
          delivered('t2'),
          abandonedBug('a', '2026-10-04T09:00', 'supersedes', 'b', 't1'),
          abandonedBug('b', '2026-10-05T09:00', 'duplicates', 'c', 't2'),
          bug('c', '2026-10-06T09:00'),
        ]);

        expect(failures.bugs.get('c')).toEqual({ linked: true, failedDeliveries: ['t1', 't2'] });
        expect([...failures.bugs.keys()]).toEqual(['c']);
        expect(failures.coverage).toEqual({ bugs: 1, linked: 1, ratio: 1 });
      });

      it('traverse un ticket en Abandon qui n’est pas un bug pour rejoindre le survivant', () => {
        const task = { ...abandonedBug('x', '2026-10-05T09:00', 'duplicates', 'c'), type: 'task' };

        const failures = analyze([
          delivered('t'),
          abandonedBug('a', '2026-10-04T09:00', 'duplicates', 'x', 't'),
          task,
          bug('c', '2026-10-06T09:00'),
        ]);

        expect(failures.bugs.get('c')).toEqual({ linked: true, failedDeliveries: ['t'] });
      });

      const cycles: [string, TicketHistory[]][] = [
        [
          'deux bugs en Abandon qui se désignent mutuellement',
          [
            abandonedBug('a', '2026-10-04T09:00', 'duplicates', 'b', 'livraison'),
            abandonedBug('b', '2026-10-05T09:00', 'duplicates', 'a', 'livraison'),
          ],
        ],
        [
          'un bug en Abandon qui se désigne lui-même',
          [abandonedBug('a', '2026-10-04T09:00', 'supersedes', 'a', 'livraison')],
        ],
        [
          'une chaîne qui débouche sur un cycle dont elle ne fait pas partie',
          [
            abandonedBug('a', '2026-10-04T09:00', 'duplicates', 'b', 'livraison'),
            abandonedBug('b', '2026-10-05T09:00', 'duplicates', 'c', 'livraison'),
            abandonedBug('c', '2026-10-06T09:00', 'duplicates', 'b', 'livraison'),
          ],
        ],
      ];

      it.each(cycles)('ne transmet rien quand la chaîne boucle, faute de survivant : %s', (_cas, abandoned) => {
        const failures = analyze([delivered('livraison'), ...abandoned]);

        expect(failures.originBugs.get('livraison')).toEqual([]);
        expect(failures.coverage).toEqual({ bugs: 0, linked: 0, ratio: null });
      });

      const notBugs: [string, string, TicketHistory[]][] = [
        ['absent du Projet', 'ailleurs-12', []],
        ['une tâche', 'tâche', [stillOpen('tâche')]],
        ['une Epic', 'epic', [stillOpen('epic', { type: 'epic' })]],
        [
          'une chaîne qui mène hors du Projet',
          'maillon',
          [abandonedBug('maillon', '2026-10-05T09:00', 'duplicates', 'ailleurs-12')],
        ],
      ];

      it.each(notBugs)(
        'perd ses liens quand le ticket qui le remplace n’est pas un bug du Projet : %s',
        (_cas, survivor, others) => {
          const failures = analyze([
            delivered('livraison'),
            ...others,
            abandonedBug('ancien', '2026-10-04T09:00', 'duplicates', survivor, 'livraison'),
          ]);

          expect(failures.originBugs.get('livraison')).toEqual([]);
          expect(failures.coverage).toEqual({ bugs: 0, linked: 0, ratio: null });
        },
      );

      it('suit le lien d’Abandon actif, pas celui qui a été retiré', () => {
        const redirected = ticket(
          'ancien',
          [
            ['open', '2026-10-04T09:00'],
            ['closed', '2026-10-31T09:00'],
          ],
          {
            type: 'bug',
            dependencies: [
              discoveredFrom('livraison'),
              {
                type: 'duplicates',
                target: 'mauvais',
                addedAt: at('2026-10-20T09:00'),
                removedAt: at('2026-10-21T09:00'),
              },
              { type: 'duplicates', target: 'bon', addedAt: at('2026-10-21T09:00') },
            ],
          },
        );

        const failures = analyze([
          delivered('livraison'),
          bug('mauvais', '2026-10-05T09:00'),
          bug('bon', '2026-10-05T09:00'),
          redirected,
        ]);

        expect(failures.bugs.get('bon')).toEqual({ linked: true, failedDeliveries: ['livraison'] });
        expect(failures.bugs.get('mauvais')).toEqual({ linked: false, failedDeliveries: [] });
      });

      const notOrigins: [string, string, TicketHistory[]][] = [
        ['vers une Epic', 'epic', [stillOpen('epic', { type: 'epic' })]],
        ['vers un ticket hors Projet', 'ailleurs-12', []],
      ];

      it.each(notOrigins)('ne relie pas le survivant quand le lien transmis va %s', (_cas, target, others) => {
        const failures = analyze([
          ...others,
          abandonedBug('b-ancien', '2026-10-04T09:00', 'duplicates', 'b-nouveau', target),
          bug('b-nouveau', '2026-10-05T09:00'),
        ]);

        expect(failures.bugs.get('b-nouveau')).toEqual({ linked: false, failedDeliveries: [] });
        expect(failures.coverage).toEqual({ bugs: 1, linked: 0, ratio: 0 });
      });

      it('ne transmet pas les liens d’un ticket en Abandon qui n’est pas un bug', () => {
        const task = { ...abandonedBug('tâche', '2026-10-04T09:00', 'duplicates', 'b', 'livraison'), type: 'task' };

        const failures = analyze([delivered('livraison'), task, bug('b', '2026-10-05T09:00')]);

        expect(failures.originBugs.get('livraison')).toEqual([]);
        expect(failures.bugs.get('b')).toEqual({ linked: false, failedDeliveries: [] });
      });

      it('ne transmet pas un lien retiré depuis : l’origine a été corrigée', () => {
        const replaced = abandonedBug('b-ancien', '2026-10-04T09:00', 'duplicates', 'b-nouveau', 'livraison');
        const retired = {
          ...replaced,
          dependencies: replaced.dependencies.map((d) =>
            d.type === 'discovered-from' ? { ...d, removedAt: at('2026-10-05T09:00') } : d,
          ),
        };

        const failures = analyze([delivered('livraison'), retired, bug('b-nouveau', '2026-10-05T09:00')]);

        expect(failures.originBugs.get('livraison')).toEqual([]);
        expect(failures.bugs.get('b-nouveau')).toEqual({ linked: false, failedDeliveries: [] });
      });

      it('ignore le lien d’un bug en Abandon vers lui-même', () => {
        const failures = analyze([
          bug('b-nouveau', '2026-10-05T09:00'),
          abandonedBug('b-ancien', '2026-10-04T09:00', 'supersedes', 'b-nouveau', 'b-ancien'),
        ]);

        expect(failures.bugs.get('b-nouveau')).toEqual({ linked: false, failedDeliveries: [] });
      });

      it('ne rend pas le survivant son propre Bug d’origine : un lien transmis qui le vise est ignoré', () => {
        // Le bug corrigé est une Livraison ; son doublon, créé après, y est relié.
        // Sans cette règle, le bug corrigé serait son propre Bug d’origine.
        const fixed = ticket(
          'corrigé',
          [
            ['open', '2026-10-04T08:00'],
            ['closed', '2026-10-04T09:00'],
          ],
          { type: 'bug' },
        );

        const failures = analyze([
          fixed,
          abandonedBug('doublon', '2026-10-04T10:00', 'duplicates', 'corrigé', 'corrigé'),
        ]);

        expect(failures.originBugs.get('corrigé')).toEqual([]);
        expect(failures.bugs.get('corrigé')).toEqual({ linked: false, failedDeliveries: [] });
      });
    });
  });

  describe('horloge de commit qui recule', () => {
    // La borne qui rend les dates d'un ticket croissantes (`analyzeFlow`) est propre à ce ticket : elle ne dit rien d'un autre.
    // Le Taux d'échec compare deux tickets, la Livraison et le bug : il lit leurs dates enregistrées, les deux de la même façon.
    //   c1 09:00  `d` est créé                      c2 12:00  `d` est en cours
    //   c3 « 10:00 »  `d` est fermé (l'horloge de ce commit est en retard de deux heures sur c2)
    //   c4 11:00  le bug est créé, découvert à partir de `d`
    // Dans la lignée, le bug est créé après la clôture de `d`. `analyzeFlow` date pourtant cette Livraison de 12:00, puisque la
    // clôture vient après le démarrage de `d` (c2) ; le bug, lui, n'a pas de Transition précédente qui le borne.
    const closedBehind = (closedAt = '2026-10-01T10:00') =>
      ticket('d', [
        ['open', '2026-10-01T09:00'],
        ['in_progress', '2026-10-01T12:00'],
        ['closed', closedAt],
      ]);

    it('compte le bug créé après la clôture dans la lignée comme Bug d’origine, bien que la borne date la Livraison après lui', () => {
      const tickets = [closedBehind(), bug('bug', '2026-10-01T11:00', 'd')];
      const flows = analyzeFlow(tickets);

      const failures = analyzeFailures(tickets, flows);

      expect(flows.get('d')?.outcome).toEqual({ kind: 'delivered', at: at('2026-10-01T12:00') }); // la borne est intacte
      expect(failures.originBugs.get('d')).toEqual(['bug']);
      expect(failures.bugs.get('bug')).toEqual({ linked: true, failedDeliveries: ['d'] });
    });

    it('ne compte pas un bug créé avant la clôture enregistrée : il a été trouvé en cours de travail, borne ou pas', () => {
      const failures = analyze([closedBehind(), bug('bug', '2026-10-01T09:30', 'd')]);

      expect(failures.originBugs.get('d')).toEqual([]);
      expect(failures.bugs.get('bug')).toEqual({ linked: true, failedDeliveries: [] });
    });

    it('compte un bug créé à l’instant enregistré de la clôture : ils partagent un commit', () => {
      const failures = analyze([closedBehind(), bug('bug', '2026-10-01T10:00', 'd')]);

      expect(failures.originBugs.get('d')).toEqual(['bug']);
    });

    it('date la Livraison de la dernière clôture enregistrée d’un ticket rouvert : le bug créé entre la Réouverture et cette clôture n’en est pas un', () => {
      // Fermé à 10:00, rouvert à 11:00, démarré à 12:00, puis refermé à « 11:30 » : l'horloge a reculé, la clôture est bornée à 12:00.
      const reopened = ticket('d', [
        ['open', '2026-10-01T09:00'],
        ['closed', '2026-10-01T10:00'],
        ['open', '2026-10-01T11:00'],
        ['in_progress', '2026-10-01T12:00'],
        ['closed', '2026-10-01T11:30'],
      ]);

      const failures = analyze([reopened, bug('before', '2026-10-01T11:15', 'd'), bug('after', '2026-10-01T11:45', 'd')]);

      expect(failures.originBugs.get('d')).toEqual(['after']);
    });

    it('date de même façon les liens d’un bug en Abandon, que le bug qui le remplace reprend à la date de sa propre création', () => {
      // `old` est créé à 11:00, après la clôture de `d`, et fermé comme doublon de `new`, qui hérite du lien.
      const old = abandonedBug('old', '2026-10-01T11:00', 'duplicates', 'new', 'd');

      const failures = analyze([closedBehind(), old, bug('new', '2026-10-20T09:00')]);

      expect(failures.originBugs.get('d')).toEqual(['new']);
    });

    it('lit les dates enregistrées des deux tickets, que la borne de l’un déplace sans bouger l’autre : horloge partagée tirée au hasard', () => {
      // Le résultat est celui que donnent les dates des commits, comparées entre elles : l'oracle les relit dans les instantanés.
      const closingOf = (history?: TicketHistory) => {
        const snapshots = history?.statusSnapshots ?? [];
        let first = snapshots.length - 1;
        if (snapshots[first]?.status !== 'closed') return undefined;
        while (snapshots[first - 1]?.status === 'closed') first--;
        return snapshots[first]?.at.getTime();
      };
      const random = seededRandom(20_261_110);
      const seen = { links: 0, failed: 0, boundPastTheBug: 0 };
      for (let round = 0; round < 300; round++) {
        const tickets = randomHistories(random, { tickets: 8, clockBack: 40, sharedClock: true });
        const flows = analyzeFlow(tickets);
        const { originBugs } = analyzeFailures(tickets, flows);
        for (const bugTicket of tickets.filter((ticketHistory) => ticketHistory.type === 'bug')) {
          const createdAt = bugTicket.statusSnapshots[0]?.at.getTime() ?? Number.NaN;
          for (const { target } of bugTicket.dependencies.filter((dependency) => dependency.type === 'discovered-from')) {
            seen.links++;
            const closing = closingOf(tickets.find((candidate) => candidate.id === target));
            const expected = closing !== undefined && closing <= createdAt;
            expect(originBugs.get(target)?.includes(bugTicket.id) ?? false, `${round}/${bugTicket.id} → ${target}`).toBe(expected);
            if (!expected) continue;
            seen.failed++;
            const delivery = flows.get(target)?.outcome;
            if (delivery?.kind === 'delivered' && delivery.at.getTime() > createdAt) seen.boundPastTheBug++;
          }
        }
      }
      // Le tirage au sort doit exercer le cas : des Livraisons que la borne date après un bug créé depuis leur clôture.
      expect(seen.links).toBeGreaterThan(300);
      expect(seen.failed).toBeGreaterThan(60);
      expect(seen.boundPastTheBug).toBeGreaterThan(15);
    });
  });

  describe('flows qui ne correspond pas aux tickets', () => {
    // `flows` doit être `analyzeFlow(tickets)` ; si ce n’est pas le cas, `linked` et `failedDeliveries` restent d’accord.
    const epic = delivered('x', '2026-10-03T09:00', { type: 'epic' });
    const b = bug('b', '2026-10-04T09:00', 'x');

    const divergences: [string, TicketHistory[], TicketHistory[]][] = [
      ['une Livraison que seul flows connaît', [], [delivered('x')]],
      ['une Epic que flows prend pour une Livraison', [epic], [delivered('x')]],
      ['un ticket que flows ne connaît pas', [delivered('x')], []],
    ];

    it.each(divergences)('ne relie pas un bug à %s', (_cible, inTickets, inFlows) => {
      const failures = analyzeFailures([...inTickets, b], analyzeFlow([...inFlows, b]));

      expect(failures.bugs.get('b')).toEqual({ linked: false, failedDeliveries: [] });
      expect(failures.originBugs.get('x') ?? []).toEqual([]);
    });

    it('ne met une Livraison en échec que par un bug relié, quel que soit l’écart entre tickets et flows', () => {
      const knowledge: [string, TicketHistory[]][] = [
        ['inconnue', []],
        ['livrée', [delivered('x')]],
        ['ouverte', [stillOpen('x')]],
        ['en Abandon', [duplicate('x')]],
        ['Epic', [epic]],
      ];

      const violations = knowledge.flatMap(([ticketsKnow, inTickets]) =>
        knowledge.flatMap(([flowsKnow, inFlows]) => {
          const attribution = analyzeFailures([...inTickets, b], analyzeFlow([...inFlows, b])).bugs.get('b');
          const unlinkedFailure = attribution && attribution.failedDeliveries.length > 0 && !attribution.linked;
          return unlinkedFailure ? [`tickets : ${ticketsKnow}, flows : ${flowsKnow}`] : [];
        }),
      );

      expect(violations).toEqual([]);
      // Témoin : sans écart, la prémisse de l’invariant se vérifie bien.
      expect(analyze([delivered('x'), b]).bugs.get('b')).toEqual({ linked: true, failedDeliveries: ['x'] });
    });
  });

  describe('couverture', () => {
    it('mesure la part des bugs reliés à un ticket, livré ou non', () => {
      const task = { ...bug('tâche', '2026-10-04T09:00', 'livré'), type: 'task' };

      const failures = analyze([
        delivered('livré'),
        stillOpen('en-cours'),
        task,
        bug('après-livraison', '2026-10-04T09:00', 'livré'),
        bug('en-chemin', '2026-10-02T09:00', 'en-cours'),
        bug('sans-lien-1', '2026-10-04T09:00'),
        bug('sans-lien-2', '2026-10-04T09:00'),
      ]);

      expect(failures.coverage).toEqual({ bugs: 4, linked: 2, ratio: 0.5 });
    });

    it('reste indéfinie tant qu’il n’y a aucun bug', () => {
      const failures = analyze([delivered('t')]);

      expect(failures.coverage).toEqual({ bugs: 0, linked: 0, ratio: null });
    });

    it('ne compte pas comme relié un bug dont le lien vise une Epic : elle n’est l’origine de rien', () => {
      const failures = analyze([stillOpen('e', { type: 'epic' }), bug('b', '2026-10-04T09:00', 'e')]);

      expect(failures.coverage).toEqual({ bugs: 1, linked: 0, ratio: 0 });
    });

    it('ne compte pas comme relié un bug dont le lien vise un ticket hors Projet', () => {
      const failures = analyze([bug('b', '2026-10-04T09:00', 'ailleurs-12')]);

      expect(failures.coverage).toEqual({ bugs: 1, linked: 0, ratio: 0 });
    });

    it('ne compte pas comme relié un bug dont le lien a été retiré', () => {
      const retired = {
        ...bug('b', '2026-10-04T09:00'),
        dependencies: [{ ...discoveredFrom('t'), removedAt: at('2026-10-05T09:00') }],
      };

      const failures = analyze([delivered('t'), retired]);

      expect(failures.coverage).toEqual({ bugs: 1, linked: 0, ratio: 0 });
    });

    it('compte comme relié un bug dont la cible est un Abandon : il a été trouvé en travaillant sur elle', () => {
      const failures = analyze([duplicate('t'), bug('b', '2026-10-04T09:00', 't')]);

      expect(failures.bugs.get('b')).toEqual({ linked: true, failedDeliveries: [] });
    });
  });

  describe('scénario My-Prompt-Manager (ieq.4 et ieq.5)', () => {
    // Données réelles : chaque ticket de suivi est créé moins de 4 s après la clôture de sa cible. L'historique
    // Dolt ne date les liens qu'à la migration de bd (2026-10-18), bien après : seule la création du bug compte.
    const migration = at('2026-10-18T06:54:26.308');
    const followUp = (id: string, type: string, createdAt: string, target: string, closedAt: string) =>
      ticket(
        id,
        [
          ['open', createdAt],
          ['closed', closedAt],
        ],
        { type, dependencies: [{ type: 'discovered-from', target, addedAt: migration }] },
      );
    const slice = (id: string, started: string, closedAt: string) =>
      ticket(id, [
        ['open', '2026-10-01T07:05:39'],
        ['in_progress', started],
        ['closed', closedAt],
      ]);
    const scenario = () =>
      analyze([
        slice('ieq.4', '2026-10-01T11:15:39', '2026-10-02T07:56:18.000'),
        slice('ieq.5', '2026-10-02T08:13:07', '2026-10-06T21:34:52.809'),
        followUp('f9f', 'bug', '2026-10-02T07:56:18.830', 'ieq.4', '2026-10-18T06:54:33'),
        followUp('j7k', 'bug', '2026-10-02T07:56:19.656', 'ieq.4', '2026-10-18T06:54:32'),
        followUp('vb1', 'task', '2026-10-02T07:56:20.714', 'ieq.4', '2026-10-18T06:54:31'),
        followUp('115', 'chore', '2026-10-02T07:56:21.791', 'ieq.4', '2026-10-18T06:54:34'),
        followUp('318', 'bug', '2026-10-06T21:34:54.689', 'ieq.5', '2026-10-18T06:54:34'),
        followUp('q8b', 'chore', '2026-10-06T21:34:55.475', 'ieq.5', '2026-10-18T06:54:35'),
        stillOpen('s5g', { type: 'bug' }),
      ]);

    it('met en échec les deux Livraisons par leurs seuls bugs, pas par les tâches et chores de suivi', () => {
      const failures = scenario();

      expect(failures.originBugs.get('ieq.4')).toEqual(['f9f', 'j7k']);
      expect(failures.originBugs.get('ieq.5')).toEqual(['318']);
    });

    it('laisse sans échec les Livraisons de suivi elles-mêmes', () => {
      const failures = scenario();

      expect(failures.originBugs.get('vb1')).toEqual([]);
      expect(failures.originBugs.get('115')).toEqual([]);
    });

    it('couvre trois bugs sur quatre', () => {
      expect(scenario().coverage).toEqual({ bugs: 4, linked: 3, ratio: 0.75 });
    });
  });
});
