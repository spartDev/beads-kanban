import { describe, expect, it } from 'vitest';
import { analyzeFlow, isWork, recordedTransitions, type TicketFlow, type TicketHistory } from './flow';
import { CLOCKS, clockWentBack, randomHistories, seededRandom } from './testing';

const at = (iso: string) => new Date(`${iso}Z`);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function ticket(id: string, statuses: [string, string][], extra: Partial<TicketHistory> = {}): TicketHistory {
  return {
    id,
    type: 'task',
    statusSnapshots: statuses.map(([status, iso]) => ({ status, at: at(iso) })),
    dependencies: [],
    ...extra,
  };
}

describe('analyzeFlow', () => {
  it('réduit les instantanés répétés en Transitions', () => {
    const flow = analyzeFlow([
      ticket('t-1', [
        ['open', '2026-10-01T09:00'],
        ['open', '2026-10-01T10:00'],
        ['in_progress', '2026-10-02T09:00'],
        ['in_progress', '2026-10-02T12:00'],
        ['closed', '2026-10-03T09:00'],
      ]),
    ]).get('t-1');

    expect(flow?.transitions).toEqual([
      { status: 'open', at: at('2026-10-01T09:00') },
      { status: 'in_progress', at: at('2026-10-02T09:00') },
      { status: 'closed', at: at('2026-10-03T09:00') },
    ]);
  });

  it('compte un ticket fermé comme Livraison, avec son Lead Time', () => {
    const flow = analyzeFlow([
      ticket('t-1', [
        ['open', '2026-10-01T09:00'],
        ['in_progress', '2026-10-02T09:00'],
        ['closed', '2026-10-03T21:00'],
      ]),
    ]).get('t-1');

    expect(flow?.outcome).toEqual({ kind: 'delivered', at: at('2026-10-03T21:00') });
    expect(flow?.leadTime).toBe(2.5 * DAY);
  });

  it("laisse un ticket non fermé sans Livraison ni Lead Time", () => {
    const flow = analyzeFlow([ticket('t-1', [['open', '2026-10-01T09:00']])]).get('t-1');

    expect(flow?.outcome).toEqual({ kind: 'open' });
    expect(flow?.leadTime).toBeNull();
  });

  it('ne compte jamais une Epic fermée comme Livraison, mais mesure son Lead Time', () => {
    const flow = analyzeFlow([
      ticket(
        'e-1',
        [
          ['open', '2026-10-01T09:00'],
          ['closed', '2026-10-05T09:00'],
        ],
        { type: 'epic' },
      ),
    ]).get('e-1');

    expect(flow?.outcome).toEqual({ kind: 'closed', at: at('2026-10-05T09:00') });
    expect(flow?.leadTime).toBe(4 * DAY);
  });

  describe('Abandon', () => {
    const closedWith = (type: string) =>
      analyzeFlow([
        ticket(
          'old',
          [
            ['open', '2026-10-01T09:00'],
            ['closed', '2026-10-02T09:00'],
          ],
          { dependencies: [{ type, target: 'other', addedAt: at('2026-10-02T09:00') }] },
        ),
      ]).get('old');

    it('classe en Abandon un ticket remplacé par un autre (bd supersede)', () => {
      expect(closedWith('supersedes')?.outcome).toEqual({
        kind: 'abandoned',
        at: at('2026-10-02T09:00'),
        cause: 'superseded',
      });
    });

    it('classe en Abandon un doublon (bd duplicate)', () => {
      expect(closedWith('duplicates')?.outcome).toEqual({
        kind: 'abandoned',
        at: at('2026-10-02T09:00'),
        cause: 'duplicate',
      });
    });

    it('garde en Livraison un ticket qui n’a qu’un lien informatif', () => {
      expect(closedWith('relates-to')?.outcome.kind).toBe('delivered');
    });
  });

  describe('Cycle Time', () => {
    it('compte les statuts de travail : en cours, rattaché à un agent, bloqué', () => {
      const flow = analyzeFlow([
        ticket('t-1', [
          ['open', '2026-10-01T09:00'],
          ['hooked', '2026-10-01T10:00'],
          ['blocked', '2026-10-01T12:00'],
          ['in_progress', '2026-10-01T15:00'],
          ['closed', '2026-10-01T16:00'],
        ]),
      ]).get('t-1');

      expect(flow?.cycleTime).toBe(6 * HOUR);
    });

    it('est indéfini pour un ticket fermé sans avoir jamais été démarré', () => {
      const flow = analyzeFlow([
        ticket('t-1', [
          ['open', '2026-10-01T09:00'],
          ['closed', '2026-10-02T09:00'],
        ]),
      ]).get('t-1');

      expect(flow?.leadTime).toBe(DAY);
      expect(flow?.cycleTime).toBeNull();
    });

    it('est indéfini tant que le ticket n’est pas fermé', () => {
      const flow = analyzeFlow([
        ticket('t-1', [
          ['open', '2026-10-01T09:00'],
          ['in_progress', '2026-10-02T09:00'],
        ]),
      ]).get('t-1');

      expect(flow?.cycleTime).toBeNull();
    });
  });

  describe('Blocage', () => {
    const blocker = (statuses: [string, string][]) => ticket('b', statuses);
    const blocks = (target: string, added: string, removed?: string) => ({
      type: 'blocks',
      target,
      addedAt: at(added),
      ...(removed ? { removedAt: at(removed) } : {}),
    });

    it('mesure l’Attente de dépendance d’un ticket resté en Backlog avant son démarrage', () => {
      const flows = analyzeFlow([
        blocker([
          ['open', '2026-10-01T09:00'],
          ['closed', '2026-10-03T09:00'],
        ]),
        ticket(
          't',
          [
            ['open', '2026-10-01T09:00'],
            ['in_progress', '2026-10-04T09:00'],
            ['closed', '2026-10-05T09:00'],
          ],
          { dependencies: [blocks('b', '2026-10-01T09:00')] },
        ),
      ]);

      expect(flows.get('t')?.dependencyWait).toBe(2 * DAY);
      expect(flows.get('t')?.blockedTime).toBe(0);
    });

    it('compte en temps bloqué un Blocage survenu pendant le travail, Cycle Time inchangé', () => {
      const flows = analyzeFlow([
        blocker([
          ['open', '2026-10-01T09:00'],
          ['closed', '2026-10-02T15:00'],
        ]),
        ticket(
          't',
          [
            ['open', '2026-10-01T09:00'],
            ['in_progress', '2026-10-02T09:00'],
            ['closed', '2026-10-03T09:00'],
          ],
          { dependencies: [blocks('b', '2026-10-02T12:00')] },
        ),
      ]);

      expect(flows.get('t')?.blockedTime).toBe(3 * HOUR);
      expect(flows.get('t')?.cycleTime).toBe(DAY);
      expect(flows.get('t')?.dependencyWait).toBe(0);
    });

    it('lève le Blocage quand la dépendance est retirée', () => {
      const flows = analyzeFlow([
        blocker([['open', '2026-10-01T09:00']]),
        ticket(
          't',
          [
            ['open', '2026-10-01T09:00'],
            ['in_progress', '2026-10-02T09:00'],
            ['closed', '2026-10-03T09:00'],
          ],
          { dependencies: [blocks('b', '2026-10-01T09:00', '2026-10-01T21:00')] },
        ),
      ]);

      expect(flows.get('t')?.dependencyWait).toBe(12 * HOUR);
    });

    it('rétablit le Blocage quand la cible est rouverte', () => {
      const flows = analyzeFlow([
        blocker([
          ['open', '2026-10-01T09:00'],
          ['closed', '2026-10-02T09:00'],
          ['open', '2026-10-04T09:00'],
          ['closed', '2026-10-04T15:00'],
        ]),
        ticket(
          't',
          [
            ['open', '2026-10-01T09:00'],
            ['in_progress', '2026-10-03T09:00'],
            ['closed', '2026-10-05T09:00'],
          ],
          { dependencies: [blocks('b', '2026-10-01T09:00')] },
        ),
      ]);

      expect(flows.get('t')?.dependencyWait).toBe(DAY);
      expect(flows.get('t')?.blockedTime).toBe(6 * HOUR);
    });

    it('ignore une dépendance vers un ticket hors Projet', () => {
      const flows = analyzeFlow([
        ticket(
          't',
          [
            ['open', '2026-10-01T09:00'],
            ['closed', '2026-10-02T09:00'],
          ],
          { dependencies: [blocks('ailleurs', '2026-10-01T09:00')] },
        ),
      ]);

      expect(flows.get('t')?.dependencyWait).toBe(0);
    });

    it('compte le statut bloqué comme un Blocage', () => {
      const flows = analyzeFlow([
        ticket('t', [
          ['open', '2026-10-01T09:00'],
          ['in_progress', '2026-10-01T10:00'],
          ['blocked', '2026-10-01T12:00'],
          ['in_progress', '2026-10-01T16:00'],
          ['closed', '2026-10-01T18:00'],
        ]),
      ]);

      expect(flows.get('t')?.blockedTime).toBe(4 * HOUR);
      expect(flows.get('t')?.cycleTime).toBe(8 * HOUR);
    });
  });

  describe('Réouverture (scénario sais-42)', () => {
    const sais42: [string, string][] = [
      ['open', '2026-10-01T09:00'],
      ['in_progress', '2026-10-02T09:00'],
      ['closed', '2026-10-03T09:00'],
      ['open', '2026-10-10T09:00'],
      ['in_progress', '2026-10-11T09:00'],
      ['closed', '2026-10-12T09:00'],
    ];

    it('ne compte qu’une Livraison, datée de la dernière clôture', () => {
      const flow = analyzeFlow([ticket('sais-42', sais42)]).get('sais-42');

      expect(flow?.outcome).toEqual({ kind: 'delivered', at: at('2026-10-12T09:00') });
      expect(flow?.leadTime).toBe(11 * DAY);
      expect(flow?.reopenings).toBe(1);
    });

    it('cumule dans le Cycle Time les seules périodes de travail', () => {
      const flow = analyzeFlow([ticket('sais-42', sais42)]).get('sais-42');

      expect(flow?.cycleTime).toBe(2 * DAY);
    });

    it('annule la Livraison tant que le ticket rouvert n’est pas refermé', () => {
      const flow = analyzeFlow([ticket('sais-42', sais42.slice(0, 4))]).get('sais-42');

      expect(flow?.outcome).toEqual({ kind: 'open' });
      expect(flow?.reopenings).toBe(1);
    });
  });

  describe('horloge de commit qui recule', () => {
    // Les instantanés d'un ticket arrivent dans l'ordre des commits de la lignée du premier parent, qui n'est pas celui des
    // dates : une horloge peut reculer. Une Transition n'est jamais datée avant la précédente du même ticket : si l'horloge de
    // son commit a reculé, elle l'est au même instant. Le Lead Time, le Cycle Time et les temps passés dans les statuts sont
    // alors des différences d'instants qui se suivent, jamais négatives, et le Cycle Time tient dans le Lead Time. Les tirages
    // au sort se font avec une horloge par ticket, puis avec une horloge partagée par le Projet (reculs communs à plusieurs
    // tickets, dépendances datées des mêmes commits que les statuts).
    const blocks = (target: string, added: string, removed?: string) => ({
      type: 'blocks',
      target,
      addedAt: at(added),
      ...(removed ? { removedAt: at(removed) } : {}),
    });

    it('date au même instant que la précédente la Transition dont l’horloge a reculé : le Cycle Time ne dépasse pas le Lead Time', () => {
      const flow = analyzeFlow([
        ticket('t-1', [
          ['open', '2026-10-01T10:00'],
          ['in_progress', '2026-10-01T05:00'], // l'horloge de ce commit est en retard de 5 h sur le précédent
          ['closed', '2026-10-01T20:00'],
        ]),
      ]).get('t-1');

      // Les Transitions suivent l'ordre des commits, pas celui des dates : le ticket est bien créé ouvert.
      expect(flow?.transitions).toEqual([
        { status: 'open', at: at('2026-10-01T10:00') },
        { status: 'in_progress', at: at('2026-10-01T10:00') },
        { status: 'closed', at: at('2026-10-01T20:00') },
      ]);
      expect(flow?.leadTime).toBe(10 * HOUR);
      expect(flow?.cycleTime).toBe(10 * HOUR); // 15 h sans cela : le travail aurait commencé 5 h avant la création du ticket
    });

    it('date la clôture au plus tôt de la Transition précédente : la Livraison et le Lead Time ne s’arrêtent pas avant le démarrage', () => {
      const flow = analyzeFlow([
        ticket('t-1', [
          ['open', '2026-10-01T09:00'],
          ['in_progress', '2026-10-02T09:00'],
          ['closed', '2026-10-01T20:00'], // l'horloge de la clôture est en retard d'une demi-journée sur le démarrage
        ]),
      ]).get('t-1');

      expect(flow?.outcome).toEqual({ kind: 'delivered', at: at('2026-10-02T09:00') });
      expect(flow?.leadTime).toBe(DAY);
      expect(flow?.cycleTime).toBe(0); // démarré, puis fermé au même instant : 0, pas « jamais démarré »
    });

    it('ne donne jamais un Lead Time négatif : une clôture datée avant la création tombe à la création', () => {
      const flow = analyzeFlow([
        ticket('t-1', [
          ['open', '2026-10-05T09:00'],
          ['closed', '2026-10-04T09:00'],
        ]),
      ]).get('t-1');

      expect(flow?.outcome).toEqual({ kind: 'delivered', at: at('2026-10-05T09:00') });
      expect(flow?.leadTime).toBe(0);
    });

    it('borne chaque instant par le précédent déjà borné : une date qui dépasse le précédent brut, mais pas le plus tardif, reste à celui-ci', () => {
      const flow = analyzeFlow([
        ticket('t-1', [
          ['open', '2026-10-01T10:00'],
          ['in_progress', '2026-10-01T08:00'], // recule : 10:00
          ['blocked', '2026-10-01T09:00'], // après 08:00, mais avant 10:00 : 10:00
          ['in_progress', '2026-10-01T12:00'],
          ['closed', '2026-10-01T11:00'], // recule : 12:00
        ]),
      ]).get('t-1');

      expect(flow?.transitions.map((t) => t.at.toISOString().slice(11, 16))).toEqual(['10:00', '10:00', '10:00', '12:00', '12:00']);
      expect(flow).toMatchObject({ leadTime: 2 * HOUR, cycleTime: 2 * HOUR, blockedTime: 2 * HOUR });
    });

    it('ne date rien avec un instantané qui répète le statut, et ne borne rien non plus : seul un changement de statut est une Transition', () => {
      const flow = analyzeFlow([
        ticket('t-1', [
          ['open', '2026-10-01T10:00'],
          ['open', '2026-10-01T15:00'], // le statut se répète : ce n'est pas une Transition
          ['in_progress', '2026-10-01T12:00'], // avant ce 15:00, mais après la Transition précédente (10:00) : il reste à 12:00
          ['closed', '2026-10-01T20:00'],
        ]),
      ]).get('t-1');

      expect(flow?.transitions.map((t) => t.at.toISOString().slice(11, 16))).toEqual(['10:00', '12:00', '20:00']);
    });

    it('borne aussi la clôture et la Réouverture d’un ticket rouvert : une Livraison, datée de la dernière clôture bornée', () => {
      const flow = analyzeFlow([
        ticket('t-1', [
          ['open', '2026-10-01T09:00'],
          ['in_progress', '2026-10-01T10:00'],
          ['closed', '2026-10-01T12:00'],
          ['open', '2026-10-01T08:00'], // la Réouverture, horloge en arrière : 12:00
          ['in_progress', '2026-10-01T09:00'], // 12:00
          ['closed', '2026-10-01T15:00'],
        ]),
      ]).get('t-1');

      expect(flow?.reopenings).toBe(1);
      expect(flow?.outcome).toEqual({ kind: 'delivered', at: at('2026-10-01T15:00') });
      expect(flow).toMatchObject({ leadTime: 6 * HOUR, cycleTime: 5 * HOUR }); // 2 h avant la clôture, 3 h après la Réouverture
    });

    it('garde l’Attente de dépendance dans le Lead Time : elle en est une composante', () => {
      // `t` est démarré à 13:00 d'après l'historique, mais la clôture qui le suit est datée de 11:00 : elle tombe à 13:00.
      const flows = analyzeFlow([
        ticket('b', [
          ['open', '2026-10-01T09:00'],
          ['closed', '2026-10-01T14:00'],
        ]),
        ticket(
          't',
          [
            ['open', '2026-10-01T10:00'],
            ['in_progress', '2026-10-01T13:00'],
            ['closed', '2026-10-01T11:00'],
          ],
          { dependencies: [blocks('b', '2026-10-01T10:00', '2026-10-01T13:00')] },
        ),
      ]);

      expect(flows.get('t')).toMatchObject({ leadTime: 3 * HOUR, dependencyWait: 3 * HOUR, cycleTime: 0, blockedTime: 0 });
    });

    it('date chaque Transition de la plus tardive des dates enregistrées jusqu’à elle : la précédente, déjà bornée, suffit', () => {
      const random = seededRandom(20_261_107);
      for (const [, sharedClock] of CLOCKS) {
        for (let round = 0; round < 200; round++) {
          for (const history of randomHistories(random, { tickets: 5, clockBack: 25, sharedClock })) {
            const recorded = history.statusSnapshots.filter((snapshot, index) => history.statusSnapshots[index - 1]?.status !== snapshot.status);
            const latestSoFar = recorded.map((_, index) => Math.max(...recorded.slice(0, index + 1).map((snapshot) => snapshot.at.getTime())));

            const transitions = analyzeFlow([history]).get(history.id)?.transitions ?? [];

            expect(transitions.map((t) => [t.status, t.at.getTime()]), `${round}/${history.id}`).toEqual(recorded.map((snapshot, index) => [snapshot.status, latestSoFar[index]]));
          }
        }
      }
    });

    describe('horloge en avance', () => {
      // L'autre sens du même défaut : un commit daté trop tard. On ne sait pas laquelle des dates est fausse, et la borne ne peut
      // que repousser : l'avance se propage aux Transitions suivantes du ticket, jusqu'à ce que les dates la rattrapent. C'est la
      // contrepartie du choix de ne jamais ramener une Transition avant la précédente (ADR 0001).
      const ahead = () =>
        ticket('t-1', [
          ['open', '2026-10-01T09:00'],
          ['in_progress', '2026-10-03T09:00'], // l'horloge de ce commit est en avance de deux jours
          ['blocked', '2026-10-01T11:00'],
          ['in_progress', '2026-10-01T13:00'],
          ['closed', '2026-10-04T09:00'], // les dates ont rattrapé
        ]);

      it('se propage aux Transitions suivantes du ticket jusqu’à ce que les dates la rattrapent : aucune durée n’est négative', () => {
        const flow = analyzeFlow([ahead()]).get('t-1');

        expect(flow?.transitions.map((t) => [t.status, t.at.toISOString().slice(0, 16)])).toEqual([
          ['open', '2026-10-01T09:00'],
          ['in_progress', '2026-10-03T09:00'],
          ['blocked', '2026-10-03T09:00'], // 11:00 le 1er : repoussé à la date du commit en avance
          ['in_progress', '2026-10-03T09:00'], // 13:00 le 1er : de même
          ['closed', '2026-10-04T09:00'],
        ]);
        // Le travail commence à la date en avance, pas à celle de ses propres commits : un jour de Cycle Time, pas trois.
        expect(flow).toMatchObject({ leadTime: 3 * DAY, cycleTime: DAY, blockedTime: 0, dependencyWait: 0 });
      });

      it('tient les durées dans l’ordre malgré l’avance : le Cycle Time ne dépasse pas le Lead Time', () => {
        const flow = analyzeFlow([ahead()]).get('t-1');

        expect(flow?.cycleTime ?? Number.NaN).toBeLessThanOrEqual(flow?.leadTime ?? Number.NaN);
        expect(flow?.blockedTime ?? Number.NaN).toBeLessThanOrEqual(flow?.cycleTime ?? Number.NaN);
      });

      it('ne décale que le ticket concerné : un autre, créé et fermé dans des commits qui suivent le sien, garde ses dates', () => {
        // `u` est créé et fermé le 1er octobre, dans des commits qui suivent celui de `t-1` daté du 3 : la borne est propre au ticket.
        const flows = analyzeFlow([
          ahead(),
          ticket('u', [
            ['open', '2026-10-01T12:00'],
            ['closed', '2026-10-01T14:00'],
          ]),
        ]);

        expect(flows.get('u')?.transitions).toEqual([
          { status: 'open', at: at('2026-10-01T12:00') },
          { status: 'closed', at: at('2026-10-01T14:00') },
        ]);
        expect(flows.get('u')).toMatchObject({ leadTime: 2 * HOUR, outcome: { kind: 'delivered', at: at('2026-10-01T14:00') } });
      });
    });

    describe('limites du bornage par ticket (ADR 0001)', () => {
      // La borne ne porte que sur les Transitions d'un même ticket. Les dates des dépendances (`addedAt`, `removedAt`) sont celles
      // de leurs commits, et les Transitions d'un ticket bloquant sont bornées pour lui seul : le Blocage par un autre ticket croise
      // des dates qui peuvent se contredire, parce que rien, dans ces historiques, ne dit l'ordre des commits entre deux tickets.
      // Seule la précision du Blocage en souffre. Ces tests figent le choix ; borner sur toute la lignée du Projet les changerait
      // (et ferait propager une horloge en avance à tous les tickets).
      const invariantsHold = (flow: TicketFlow | undefined) => {
        const [leadTime, cycleTime, blockedTime, dependencyWait] = [flow?.leadTime ?? NaN, flow?.cycleTime ?? 0, flow?.blockedTime ?? NaN, flow?.dependencyWait ?? NaN];
        expect(blockedTime).toBeGreaterThanOrEqual(0);
        expect(dependencyWait).toBeGreaterThanOrEqual(0);
        expect(blockedTime).toBeLessThanOrEqual(cycleTime);
        expect(cycleTime).toBeLessThanOrEqual(leadTime);
        expect(dependencyWait + cycleTime).toBeLessThanOrEqual(leadTime);
      };

      it('lit la date d’une dépendance telle que son commit l’enregistre : posée par un commit en retard, après le démarrage, elle semble l’avoir été avant', () => {
        // c1 10:00 `t` est créé · c2 14:00 `t` est en cours · c3 « 11:00 » (horloge en retard) `t` est bloqué par `b`, resté ouvert · c4 20:00 `t` est fermé.
        // Dans la lignée, la dépendance est posée après le démarrage : aucune Attente de dépendance. Sa date, 11:00, la place avant.
        const flow = analyzeFlow([
          ticket('b', [['open', '2026-10-01T09:00']]),
          ticket(
            't',
            [
              ['open', '2026-10-01T10:00'],
              ['in_progress', '2026-10-01T14:00'],
              ['closed', '2026-10-01T20:00'],
            ],
            { dependencies: [blocks('b', '2026-10-01T11:00')] },
          ),
        ]).get('t');

        expect(flow).toMatchObject({ dependencyWait: 3 * HOUR, blockedTime: 6 * HOUR }); // 3 h d'Attente de dépendance de trop
        invariantsHold(flow);
      });

      it('borne les Transitions du bloqueur pour lui seul : fermé par un commit en retard, après le démarrage de `t`, il semble l’avoir été avant', () => {
        // c1 09:00 `b` et `t` sont créés, `t` bloqué par `b` · c2 12:00 `t` est en cours · c3 « 10:00 » (horloge en retard) `b` est fermé · c4 15:00 `t` est fermé.
        // Dans la lignée, `b` est fermé après le démarrage de `t` : 3 h d'Attente de dépendance. Sa date, 10:00, n'en laisse qu'une.
        const flow = analyzeFlow([
          ticket('b', [
            ['open', '2026-10-01T09:00'],
            ['closed', '2026-10-01T10:00'],
          ]),
          ticket(
            't',
            [
              ['open', '2026-10-01T09:00'],
              ['in_progress', '2026-10-01T12:00'],
              ['closed', '2026-10-01T15:00'],
            ],
            { dependencies: [blocks('b', '2026-10-01T09:00')] },
          ),
        ]).get('t');

        expect(flow?.dependencyWait).toBe(1 * HOUR); // 2 h de moins : comptées en Prêt (elles ne sont plus une Attente de dépendance)
        invariantsHold(flow);
      });
    });

    it.each(CLOCKS)('tient les invariants sur des historiques tirés au hasard dont l’horloge recule : durées positives, Cycle Time ≤ Lead Time, parts qui ne se chevauchent pas (%s)', (_, sharedClock) => {
      const random = seededRandom(20_261_104);
      const seen = { closed: 0, clockBack: 0, started: 0, blocked: 0, waited: 0 };
      for (let round = 0; round < 400; round++) {
        const tickets = randomHistories(random, { tickets: 5, clockBack: 25, sharedClock });
        const flows = analyzeFlow(tickets);
        for (const history of tickets) {
          const flow = flows.get(history.id) as TicketFlow;
          const where = `${round}/${history.id}`;
          const instants = flow.transitions.map((t) => t.at.getTime());
          // Les dates des Transitions ne reculent jamais, quelle que soit l'horloge des commits.
          instants.forEach((instant, index) => expect(instant, `${where} : Transition ${index}`).toBeGreaterThanOrEqual(instants[index - 1] ?? Number.NEGATIVE_INFINITY));
          if (flow.leadTime === null) {
            expect([flow.cycleTime, flow.blockedTime, flow.dependencyWait], `${where} : ticket non fermé`).toEqual([null, null, null]);
            continue;
          }
          seen.closed++;
          if (clockWentBack(history.statusSnapshots)) seen.clockBack++;
          const [cycleTime, blockedTime, dependencyWait] = [flow.cycleTime ?? 0, flow.blockedTime ?? NaN, flow.dependencyWait ?? NaN];
          expect(flow.leadTime, `${where} : Lead Time`).toBe((instants.at(-1) ?? 0) - (instants[0] ?? 0));
          expect(cycleTime, `${where} : Cycle Time`).toBeGreaterThanOrEqual(0);
          expect(cycleTime, `${where} : Cycle Time ≤ Lead Time`).toBeLessThanOrEqual(flow.leadTime);
          expect(blockedTime, `${where} : temps bloqué`).toBeGreaterThanOrEqual(0);
          expect(blockedTime, `${where} : temps bloqué ≤ Cycle Time`).toBeLessThanOrEqual(cycleTime);
          expect(dependencyWait, `${where} : Attente de dépendance`).toBeGreaterThanOrEqual(0);
          expect(dependencyWait + cycleTime, `${where} : Attente de dépendance + Cycle Time ≤ Lead Time`).toBeLessThanOrEqual(flow.leadTime);
          if (flow.cycleTime !== null) seen.started++;
          if (blockedTime > 0) seen.blocked++;
          if (dependencyWait > 0) seen.waited++;
        }
      }
      // Le tirage au sort doit exercer les cas : des tickets fermés dont l'horloge a reculé, démarrés, bloqués, en attente.
      expect(seen.clockBack).toBeGreaterThan(300);
      expect(seen.started).toBeGreaterThan(500);
      expect(seen.blocked).toBeGreaterThan(100);
      expect(seen.waited).toBeGreaterThan(100);
    });

    it.each(CLOCKS)('ne change rien tant que l’horloge ne recule pas : mêmes dates de Transitions, mêmes durées que la somme des temps passés (%s)', (_, sharedClock) => {
      // Sans dépendance, les durées se calculent à la main : le Lead Time est la somme des temps passés dans tous les statuts,
      // le Cycle Time celle des statuts de travail, le temps bloqué celle du statut bloqué.
      const random = seededRandom(20_261_105);
      let started = 0;
      for (let round = 0; round < 400; round++) {
        const tickets = randomHistories(random, { tickets: 5, clockBack: 0, sharedClock }).map((t) => ({ ...t, dependencies: [] }));
        const flows = analyzeFlow(tickets);
        for (const history of tickets) {
          const flow = flows.get(history.id) as TicketFlow;
          const where = `${round}/${history.id}`;
          const snapshots = history.statusSnapshots;
          expect(clockWentBack(snapshots), where).toBe(false);
          // Les Transitions sont les instantanés, répétitions réduites, avec leurs dates telles quelles.
          expect(flow.transitions, `${where} : Transitions`).toEqual(snapshots.filter((s, index) => snapshots[index - 1]?.status !== s.status));
          if (flow.leadTime === null) continue;
          const stays = flow.transitions.slice(0, -1).map((t, index) => ({ status: t.status, ms: (flow.transitions[index + 1]?.at.getTime() ?? 0) - t.at.getTime() }));
          const spent = (matches: (status: string) => boolean) => stays.filter((stay) => matches(stay.status)).reduce((total, stay) => total + stay.ms, 0);
          const worked = stays.some((stay) => isWork(stay.status));
          if (worked) started++;
          expect(flow.leadTime, `${where} : Lead Time`).toBe(spent(() => true));
          expect(flow.cycleTime, `${where} : Cycle Time`).toBe(worked ? spent(isWork) : null);
          expect(flow.blockedTime, `${where} : temps bloqué`).toBe(spent((status) => status === 'blocked'));
          expect(flow.dependencyWait, `${where} : Attente de dépendance`).toBe(0);
        }
      }
      expect(started).toBeGreaterThan(500);
    });

    it.each(CLOCKS)('ne doit son résultat qu’aux dates bornées : analyser ces dates, déjà bornées, redonne exactement le même (%s)', (_, sharedClock) => {
      const random = seededRandom(20_261_106);
      for (let round = 0; round < 200; round++) {
        const tickets = randomHistories(random, { tickets: 5, clockBack: 25, sharedClock });
        const flows = analyzeFlow(tickets);
        const bounded = tickets.map((t) => ({ ...t, statusSnapshots: flows.get(t.id)?.transitions ?? [] }));

        expect(analyzeFlow(bounded), `tour ${round}`).toEqual(flows);
      }
    });
  });
});

describe('recordedTransitions', () => {
  it('réduit les instantanés à un par changement de statut, daté du premier instantané de la série', () => {
    const history = ticket('t-1', [
      ['open', '2026-10-01T09:00'],
      ['open', '2026-10-01T10:00'],
      ['in_progress', '2026-10-02T09:00'],
      ['in_progress', '2026-10-02T12:00'],
      ['closed', '2026-10-03T09:00'],
    ]);

    expect(recordedTransitions(history.statusSnapshots)).toEqual([
      { status: 'open', at: at('2026-10-01T09:00') },
      { status: 'in_progress', at: at('2026-10-02T09:00') },
      { status: 'closed', at: at('2026-10-03T09:00') },
    ]);
  });

  it('ne borne aucune date : une horloge qui a reculé reste telle que son commit l’a enregistrée', () => {
    const history = ticket('t-1', [
      ['open', '2026-10-01T10:00'],
      ['in_progress', '2026-10-01T05:00'],
      ['closed', '2026-10-01T20:00'],
    ]);

    expect(recordedTransitions(history.statusSnapshots).map((t) => t.at.toISOString().slice(11, 16))).toEqual(['10:00', '05:00', '20:00']);
    expect(analyzeFlow([history]).get('t-1')?.transitions.map((t) => t.at.toISOString().slice(11, 16))).toEqual(['10:00', '10:00', '20:00']);
  });

  it('ne rend rien sans instantané', () => {
    expect(recordedTransitions([])).toEqual([]);
  });
});
