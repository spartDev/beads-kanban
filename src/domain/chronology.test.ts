import { describe, expect, it } from 'vitest';
import { analyzeChronologies, chronologyFromDates } from './chronology';
import { analyzeFlow, isWork, type DependencyHistory, type TicketHistory } from './flow';
import { intersect, measure, type Interval } from './intervals';

const at = (iso: string) => new Date(`${iso}Z`);
const iso = (value: string) => at(value).toISOString();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function ticket(id: string, statuses: [string, string][], extra: Partial<TicketHistory> = {}): TicketHistory {
  return {
    id,
    type: 'task',
    statusSnapshots: statuses.map(([status, when]) => ({ status, at: at(when) })),
    dependencies: [],
    ...extra,
  };
}

const chronologyOf = (tickets: TicketHistory[], id = tickets[0]?.id ?? '') => analyzeChronologies(tickets).of(id);

const blocks = (target: string, added: string, removed?: string): DependencyHistory => ({
  type: 'blocks',
  target,
  addedAt: at(added),
  ...(removed ? { removedAt: at(removed) } : {}),
});

describe('Transitions', () => {
  it('liste les statuts successifs d’un ticket livré, avec le temps passé dans chacun', () => {
    const chronology = chronologyOf([
      ticket('t-1', [
        ['open', '2026-10-01T09:00'],
        ['in_progress', '2026-10-02T09:00'],
        ['closed', '2026-10-03T21:00'],
      ]),
    ]);

    expect(chronology?.source).toBe('history');
    expect(chronology?.transitions).toEqual([
      { status: 'open', at: iso('2026-10-01T09:00'), duration: DAY },
      { status: 'in_progress', at: iso('2026-10-02T09:00'), duration: 1.5 * DAY },
      { status: 'closed', at: iso('2026-10-03T21:00'), duration: null },
    ]);
  });

  it('reprend les durées des métriques : Lead Time, Cycle Time, temps bloqué, Livraison', () => {
    const chronology = chronologyOf([
      ticket('t-1', [
        ['open', '2026-10-01T09:00'],
        ['in_progress', '2026-10-02T09:00'],
        ['closed', '2026-10-03T21:00'],
      ]),
    ]);

    expect(chronology).toMatchObject({
      leadTime: 2.5 * DAY,
      cycleTime: 1.5 * DAY,
      blockedTime: 0,
      reopenings: 0,
      outcome: { kind: 'delivered', at: iso('2026-10-03T21:00') },
    });
  });

  it('réduit les instantanés répétés en une seule Transition', () => {
    const chronology = chronologyOf([
      ticket('t-1', [
        ['open', '2026-10-01T09:00'],
        ['open', '2026-10-01T10:00'],
        ['in_progress', '2026-10-02T09:00'],
        ['in_progress', '2026-10-02T12:00'],
      ]),
    ]);

    expect(chronology?.transitions.map((t) => t.status)).toEqual(['open', 'in_progress']);
  });

  it('laisse le statut actuel d’un ticket ouvert sans durée, et sans Lead Time, Cycle Time ni temps bloqué', () => {
    const chronology = chronologyOf([
      ticket('t-1', [
        ['open', '2026-10-01T09:00'],
        ['in_progress', '2026-10-02T09:00'],
      ]),
    ]);

    expect(chronology?.transitions.at(-1)).toEqual({ status: 'in_progress', at: iso('2026-10-02T09:00'), duration: null });
    expect(chronology).toMatchObject({
      outcome: { kind: 'open' },
      leadTime: null,
      cycleTime: null,
      blockedTime: null,
    });
  });

  it('garde chaque clôture, compte les Réouvertures et mesure le Lead Time jusqu’à la dernière', () => {
    const chronology = chronologyOf([
      ticket('t-1', [
        ['open', '2026-10-01T09:00'],
        ['closed', '2026-10-02T09:00'],
        ['open', '2026-10-05T09:00'],
        ['in_progress', '2026-10-05T10:00'],
        ['closed', '2026-10-06T10:00'],
      ]),
    ]);

    expect(chronology?.transitions.map((t) => [t.status, t.duration])).toEqual([
      ['open', DAY],
      ['closed', 3 * DAY],
      ['open', HOUR],
      ['in_progress', DAY],
      ['closed', null],
    ]);
    expect(chronology).toMatchObject({
      reopenings: 1,
      leadTime: 5 * DAY + HOUR,
      cycleTime: DAY,
      outcome: { kind: 'delivered', at: iso('2026-10-06T10:00') },
    });
  });

  it('ne donne jamais une durée négative quand l’horloge d’un commit a reculé', () => {
    const chronology = chronologyOf([
      ticket('t-1', [
        ['open', '2026-10-01T09:00'],
        ['in_progress', '2026-10-02T09:00'],
        ['closed', '2026-10-01T20:00'],
      ]),
    ]);

    expect(chronology?.transitions.map((t) => t.duration)).toEqual([DAY, 0, null]);
    expect(chronology?.transitions.map((t) => t.at)).toEqual([
      iso('2026-10-01T09:00'),
      iso('2026-10-02T09:00'),
      iso('2026-10-02T09:00'),
    ]);
  });

  it('ne connaît pas un ticket absent de l’historique, ni un ticket sans aucun statut', () => {
    const chronologies = analyzeChronologies([ticket('vide', [])]);

    expect(chronologies.of('vide')).toBeUndefined();
    expect(chronologies.of('inconnu')).toBeUndefined();
  });
});

describe('issue du ticket fermé', () => {
  it('ne fait pas d’une Epic fermée une Livraison, mais mesure son Lead Time', () => {
    const chronology = chronologyOf([
      ticket(
        'e-1',
        [
          ['open', '2026-10-01T09:00'],
          ['closed', '2026-10-05T09:00'],
        ],
        { type: 'epic' },
      ),
    ]);

    expect(chronology).toMatchObject({ outcome: { kind: 'closed', at: iso('2026-10-05T09:00') }, leadTime: 4 * DAY });
  });

  it.each([
    ['duplicates', 'duplicate'],
    ['supersedes', 'superseded'],
  ] as const)('dit l’Abandon d’un ticket relié par « %s »', (type, cause) => {
    const dependency: DependencyHistory = { type, target: 'autre', addedAt: at('2026-10-02T09:00') };
    const chronology = chronologyOf([
      ticket(
        'old',
        [
          ['open', '2026-10-01T09:00'],
          ['closed', '2026-10-02T09:00'],
        ],
        { dependencies: [dependency] },
      ),
    ]);

    expect(chronology?.outcome).toEqual({ kind: 'abandoned', at: iso('2026-10-02T09:00'), cause });
  });
});

describe('Blocages', () => {
  const dependee = ticket('b', [
    ['open', '2026-10-01T09:00'],
    ['closed', '2026-10-03T09:00'],
  ]);
  const dependent = (dependencies: DependencyHistory[], statuses: [string, string][] = []) =>
    ticket(
      'a',
      statuses.length > 0
        ? statuses
        : [
            ['open', '2026-10-01T09:00'],
            ['in_progress', '2026-10-01T12:00'],
            ['closed', '2026-10-04T12:00'],
          ],
      { dependencies },
    );

  it('décrit le Blocage par dépendance : sa période, le ticket attendu, et la part du Cycle Time qu’il a prise', () => {
    const chronology = chronologyOf([dependent([blocks('b', '2026-10-02T09:00')]), dependee]);

    expect(chronology?.blockages).toEqual([
      {
        from: iso('2026-10-02T09:00'),
        to: iso('2026-10-03T09:00'),
        blockedBy: ['b'],
        statusBlocked: false,
        phases: [{ kind: 'work', from: iso('2026-10-02T09:00'), to: iso('2026-10-03T09:00') }],
      },
    ]);
    expect(chronology?.blockedTime).toBe(DAY);
  });

  it('ne finit le Blocage qu’à la fermeture de la cible, ou au retrait de la dépendance s’il vient avant', () => {
    const chronology = chronologyOf([dependent([blocks('b', '2026-10-02T09:00', '2026-10-02T15:00')]), dependee]);

    expect(chronology?.blockages).toEqual([
      {
        from: iso('2026-10-02T09:00'),
        to: iso('2026-10-02T15:00'),
        blockedBy: ['b'],
        statusBlocked: false,
        phases: [{ kind: 'work', from: iso('2026-10-02T09:00'), to: iso('2026-10-02T15:00') }],
      },
    ]);
  });

  it('laisse un Blocage en cours sans fin, tant que le ticket attendu n’est pas fermé', () => {
    const waiting = ticket('c', [['open', '2026-10-01T09:00']]);
    const chronology = chronologyOf([
      dependent([blocks('c', '2026-10-02T09:00')], [
        ['open', '2026-10-01T09:00'],
        ['in_progress', '2026-10-01T12:00'],
      ]),
      waiting,
    ]);

    expect(chronology?.blockages).toEqual([
      {
        from: iso('2026-10-02T09:00'),
        to: null,
        blockedBy: ['c'],
        statusBlocked: false,
        phases: [{ kind: 'work', from: iso('2026-10-02T09:00'), to: null }],
      },
    ]);
    expect(chronology?.blockedTime).toBeNull();
  });

  it('ne compte pas une dépendance vers un ticket déjà fermé, hors Projet, ou qui ne bloque pas', () => {
    const chronology = chronologyOf([
      dependent([
        blocks('b', '2026-10-05T09:00'), // b est fermé depuis le 3
        blocks('externe', '2026-10-02T09:00'), // hors Projet : on ne peut pas l'évaluer
        { type: 'related', target: 'b', addedAt: at('2026-10-02T09:00') },
        { type: 'parent-child', target: 'b', addedAt: at('2026-10-02T09:00') },
      ]),
      dependee,
    ]);

    expect(chronology?.blockages).toEqual([]);
    expect(chronology?.blockedTime).toBe(0);
  });

  it('ne compte plus de Blocage une fois le ticket fermé, même si la cible ne l’est pas', () => {
    const forever = ticket('c', [['open', '2026-10-01T09:00']]);
    const chronology = chronologyOf([dependent([blocks('c', '2026-10-02T09:00')]), forever]);

    expect(chronology?.blockages).toEqual([
      {
        from: iso('2026-10-02T09:00'),
        to: iso('2026-10-04T12:00'),
        blockedBy: ['c'],
        statusBlocked: false,
        phases: [{ kind: 'work', from: iso('2026-10-02T09:00'), to: iso('2026-10-04T12:00') }],
      },
    ]);
  });

  it('fait une seule période de deux dépendances qui se chevauchent, et nomme les deux tickets attendus', () => {
    const c = ticket('c', [
      ['open', '2026-10-01T09:00'],
      ['closed', '2026-10-03T21:00'],
    ]);
    const chronology = chronologyOf([
      dependent([blocks('c', '2026-10-02T09:00'), blocks('b', '2026-10-02T09:00')]),
      dependee,
      c,
    ]);

    expect(chronology?.blockages).toEqual([
      {
        from: iso('2026-10-02T09:00'),
        to: iso('2026-10-03T21:00'),
        blockedBy: ['b', 'c'],
        statusBlocked: false,
        phases: [{ kind: 'work', from: iso('2026-10-02T09:00'), to: iso('2026-10-03T21:00') }],
      },
    ]);
    expect(chronology?.blockedTime).toBe(DAY + 12 * HOUR);
  });

  it('garde deux périodes quand le Blocage s’interrompt', () => {
    const chronology = chronologyOf([
      dependent([blocks('b', '2026-10-01T10:00', '2026-10-01T11:00'), blocks('b', '2026-10-02T09:00')]),
      dependee,
    ]);

    expect(chronology?.blockages.map((b) => [b.from, b.to])).toEqual([
      [iso('2026-10-01T10:00'), iso('2026-10-01T11:00')],
      [iso('2026-10-02T09:00'), iso('2026-10-03T09:00')],
    ]);
  });

  it('compte aussi le statut bloqué, sans ticket attendu', () => {
    const chronology = chronologyOf([
      ticket('a', [
        ['open', '2026-10-01T09:00'],
        ['in_progress', '2026-10-01T12:00'],
        ['blocked', '2026-10-02T09:00'],
        ['in_progress', '2026-10-02T15:00'],
        ['closed', '2026-10-03T09:00'],
      ]),
    ]);

    expect(chronology?.blockages).toEqual([
      {
        from: iso('2026-10-02T09:00'),
        to: iso('2026-10-02T15:00'),
        blockedBy: [],
        statusBlocked: true,
        phases: [{ kind: 'work', from: iso('2026-10-02T09:00'), to: iso('2026-10-02T15:00') }],
      },
    ]);
    expect(chronology?.blockedTime).toBe(6 * HOUR);
  });

  it('réunit le statut bloqué et la dépendance qui se recouvrent en un seul Blocage', () => {
    const chronology = chronologyOf([
      dependent([blocks('b', '2026-10-02T09:00')], [
        ['open', '2026-10-01T09:00'],
        ['in_progress', '2026-10-01T12:00'],
        ['blocked', '2026-10-02T18:00'],
        ['in_progress', '2026-10-03T18:00'],
        ['closed', '2026-10-04T12:00'],
      ]),
      dependee,
    ]);

    expect(chronology?.blockages).toEqual([
      {
        from: iso('2026-10-02T09:00'),
        to: iso('2026-10-03T18:00'),
        blockedBy: ['b'],
        statusBlocked: true,
        phases: [{ kind: 'work', from: iso('2026-10-02T09:00'), to: iso('2026-10-03T18:00') }], // en cours puis bloqué puis en cours : une seule phase
      },
    ]);
  });

  describe('phases : ce qui compte dans le temps bloqué, et ce qui n’y compte pas', () => {
    const waited = (id: string, statuses: [string, string][], dependencies: DependencyHistory[] = []) => ticket(id, statuses, { dependencies });

    it('range avant le premier démarrage le Blocage d’un ticket encore ouvert : l’Attente de dépendance, que le temps bloqué ne compte pas', () => {
      // A attend B pendant 17 h en statut ouvert, puis A est démarré une fois B fermé, puis fermé.
      const chronology = chronologyOf([
        waited(
          'a',
          [
            ['open', '2026-10-01T00:00'],
            ['in_progress', '2026-10-01T17:00'],
            ['closed', '2026-10-01T20:00'],
          ],
          [blocks('b', '2026-10-01T00:00')],
        ),
        ticket('b', [
          ['open', '2026-09-30T00:00'],
          ['closed', '2026-10-01T17:00'],
        ]),
      ]);

      expect(chronology?.blockedTime).toBe(0);
      expect(chronology?.blockages).toEqual([
        {
          from: iso('2026-10-01T00:00'),
          to: iso('2026-10-01T17:00'),
          blockedBy: ['b'],
          statusBlocked: false,
          phases: [{ kind: 'dependencyWait', from: iso('2026-10-01T00:00'), to: iso('2026-10-01T17:00') }],
        },
      ]);
    });

    it('coupe en deux phases un Blocage qui traverse le premier démarrage : l’attente, puis le travail, seul compté dans le temps bloqué', () => {
      const chronology = chronologyOf([
        waited(
          'a',
          [
            ['open', '2026-10-01T09:00'],
            ['in_progress', '2026-10-01T12:00'],
            ['closed', '2026-10-01T20:00'],
          ],
          [blocks('b', '2026-10-01T09:00')],
        ),
        ticket('b', [
          ['open', '2026-09-30T00:00'],
          ['closed', '2026-10-01T15:00'],
        ]),
      ]);

      expect(chronology?.blockedTime).toBe(3 * HOUR);
      expect(chronology?.blockages.map((blockage) => blockage.phases)).toEqual([
        [
          { kind: 'dependencyWait', from: iso('2026-10-01T09:00'), to: iso('2026-10-01T12:00') },
          { kind: 'work', from: iso('2026-10-01T12:00'), to: iso('2026-10-01T15:00') },
        ],
      ]);
    });

    it('range hors du travail le Blocage d’un ticket revenu à ouvert après un démarrage, ou différé : ce n’est pas l’Attente de dépendance', () => {
      const chronology = chronologyOf([
        waited(
          'a',
          [
            ['open', '2026-10-01T09:00'],
            ['in_progress', '2026-10-01T10:00'],
            ['open', '2026-10-01T12:00'], // revenu à ouvert après un premier démarrage
            ['deferred', '2026-10-01T13:00'],
            ['in_progress', '2026-10-01T16:00'],
            ['closed', '2026-10-01T20:00'],
          ],
          [blocks('b', '2026-10-01T11:00')],
        ),
        ticket('b', [
          ['open', '2026-09-30T00:00'],
          ['closed', '2026-10-01T15:00'],
        ]),
      ]);

      expect(chronology?.blockedTime).toBe(HOUR);
      expect(chronology?.blockages.map((blockage) => blockage.phases)).toEqual([
        [
          { kind: 'work', from: iso('2026-10-01T11:00'), to: iso('2026-10-01T12:00') },
          { kind: 'otherWait', from: iso('2026-10-01T12:00'), to: iso('2026-10-01T15:00') },
        ],
      ]);
    });

    it('range en travail le Blocage d’un ticket au statut bloqué, quel que soit le statut de travail d’avant ou d’après', () => {
      const chronology = chronologyOf([
        ticket('a', [
          ['open', '2026-10-01T09:00'],
          ['hooked', '2026-10-01T10:00'],
          ['blocked', '2026-10-01T12:00'],
          ['in_progress', '2026-10-01T14:00'],
          ['closed', '2026-10-01T20:00'],
        ]),
      ]);

      expect(chronology?.blockages.map((blockage) => blockage.phases)).toEqual([
        [{ kind: 'work', from: iso('2026-10-01T12:00'), to: iso('2026-10-01T14:00') }],
      ]);
    });

    it('laisse ouverte la dernière phase d’un Blocage qui dure encore, avant ou après le premier démarrage', () => {
      const never = ticket('c', [['open', '2026-09-30T00:00']]);
      const idle = chronologyOf([waited('a', [['open', '2026-10-01T09:00']], [blocks('c', '2026-10-01T10:00')]), never]);
      const working = chronologyOf([
        waited(
          'a',
          [
            ['open', '2026-10-01T09:00'],
            ['in_progress', '2026-10-01T12:00'],
          ],
          [blocks('c', '2026-10-01T10:00')],
        ),
        never,
      ]);

      expect(idle?.blockages.map((blockage) => blockage.phases)).toEqual([[{ kind: 'dependencyWait', from: iso('2026-10-01T10:00'), to: null }]]);
      expect(working?.blockages.map((blockage) => blockage.phases)).toEqual([
        [
          { kind: 'dependencyWait', from: iso('2026-10-01T10:00'), to: iso('2026-10-01T12:00') },
          { kind: 'work', from: iso('2026-10-01T12:00'), to: null },
        ],
      ]);
    });

    it('ventile chaque Blocage sans rien perdre ni compter deux fois, et retombe sur les durées des métriques, pour tout historique', () => {
      // Des historiques tirés au hasard (graine fixe) : trois tickets, des statuts de toutes sortes, des dépendances qui vont et viennent.
      let seed = 20_261_104;
      const random = (n: number) => {
        seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
        return Math.floor((seed / 4_294_967_296) * n);
      };
      const STATUSES = ['open', 'in_progress', 'blocked', 'deferred', 'hooked', 'closed'];
      const BASE = Date.UTC(2026, 9, 1);
      const history = (id: string, others: string[]): TicketHistory => {
        let time = BASE + random(48) * HOUR;
        const first = time;
        const snapshots = [{ status: 'open', at: new Date(time) }];
        for (let count = random(8); count > 0; count--) {
          time += (1 + random(30)) * HOUR;
          snapshots.push({ status: STATUSES[random(STATUSES.length)] as string, at: new Date(time) });
        }
        const dependencies: DependencyHistory[] = [];
        for (let count = random(3); count > 0; count--) {
          const added = first + random(Math.max(1, (time - first) / HOUR)) * HOUR;
          const removed = random(3) === 0 ? added + (1 + random(40)) * HOUR : undefined;
          dependencies.push({ type: 'blocks', target: others[random(others.length)] as string, addedAt: new Date(added), ...(removed ? { removedAt: new Date(removed) } : {}) });
        }
        return { id, type: 'task', statusSnapshots: snapshots, dependencies };
      };
      const duration = (from: string, to: string | null) => (to === null ? 0 : Date.parse(to) - Date.parse(from));

      let blockagesChecked = 0;
      let mixed = 0;
      for (let round = 0; round < 400; round++) {
        const tickets = [history('a', ['b', 'c']), history('b', ['a', 'c']), history('c', ['a', 'b'])];
        const flows = analyzeFlow(tickets);
        const chronologies = analyzeChronologies(tickets);
        for (const { id } of tickets) {
          const flow = flows.get(id);
          const chronology = chronologies.of(id);
          if (flow?.leadTime == null || !chronology) continue; // ni fermé ni Blocage achevé : rien à comparer aux métriques
          const total = (kind: string) =>
            chronology.blockages.flatMap((blockage) => blockage.phases).filter((phase) => phase.kind === kind).reduce((sum, phase) => sum + duration(phase.from, phase.to), 0);
          for (const blockage of chronology.blockages) {
            blockagesChecked++;
            if (blockage.phases.length > 1) mixed++;
            // Les phases se suivent sans trou ni recouvrement, de bout en bout du Blocage.
            expect(blockage.phases[0]?.from).toBe(blockage.from);
            expect(blockage.phases.at(-1)?.to).toBe(blockage.to);
            blockage.phases.forEach((phase, index) => expect(phase.from).toBe(index === 0 ? blockage.from : blockage.phases[index - 1]?.to));
          }
          expect(total('work'), `${round}/${id} : temps bloqué`).toBe(flow.blockedTime);
          expect(total('dependencyWait'), `${round}/${id} : Attente de dépendance`).toBe(flow.dependencyWait);
        }
      }
      // Le tirage au sort doit réellement exercer les cas : des Blocages, dont certains sur plusieurs phases.
      expect(blockagesChecked).toBeGreaterThan(100);
      expect(mixed).toBeGreaterThan(10);
    });
  });

  it('explique le temps bloqué : les Blocages, pris sur les périodes de travail, totalisent le temps bloqué des métriques', () => {
    const c = ticket('c', [
      ['open', '2026-10-01T09:00'],
      ['in_progress', '2026-10-02T00:00'],
      ['closed', '2026-10-06T00:00'],
    ]);
    const chronology = chronologyOf([
      ticket(
        'a',
        [
          ['open', '2026-10-01T09:00'],
          ['in_progress', '2026-10-01T12:00'],
          ['open', '2026-10-02T12:00'], // hors travail : le Blocage ne compte pas dans le Cycle Time
          ['in_progress', '2026-10-04T08:00'],
          ['blocked', '2026-10-04T20:00'],
          ['in_progress', '2026-10-05T04:00'],
          ['closed', '2026-10-07T00:00'],
        ],
        { dependencies: [blocks('b', '2026-10-01T18:00'), blocks('c', '2026-10-03T00:00', '2026-10-05T12:00')] },
      ),
      dependee,
      c,
    ]);

    const working: Interval[] = (chronology?.transitions ?? []).flatMap((t, i, all): Interval[] => {
      const next = all[i + 1];
      return isWork(t.status) && next ? [[Date.parse(t.at), Date.parse(next.at)]] : [];
    });
    const blocked: Interval[] = (chronology?.blockages ?? []).map((b) => [
      Date.parse(b.from),
      b.to === null ? Number.POSITIVE_INFINITY : Date.parse(b.to),
    ]);

    expect(chronology?.blockedTime).toBeGreaterThan(0);
    expect(measure(intersect(blocked, working))).toBe(chronology?.blockedTime);
  });
});

describe('repli sur les dates : un ticket sans historique', () => {
  it('ne connaît que la création d’un ticket ouvert, et ne dit rien de plus', () => {
    expect(chronologyFromDates({ createdAt: at('2026-10-01T09:00'), closedAt: null })).toEqual({
      source: 'dates',
      transitions: [{ status: 'open', at: iso('2026-10-01T09:00'), duration: null }],
      blockages: [],
      outcome: { kind: 'open' },
      leadTime: null,
      cycleTime: null,
      blockedTime: null,
      reopenings: 0,
    });
  });

  it('dit la clôture d’un ticket fermé et son Lead Time, sans Cycle Time ni Livraison : l’historique ne dit pas pourquoi il est fermé', () => {
    expect(chronologyFromDates({ createdAt: at('2026-10-01T09:00'), closedAt: at('2026-10-03T21:00') })).toEqual({
      source: 'dates',
      transitions: [
        { status: 'open', at: iso('2026-10-01T09:00'), duration: 2.5 * DAY },
        { status: 'closed', at: iso('2026-10-03T21:00'), duration: null },
      ],
      blockages: [],
      outcome: { kind: 'closed', at: iso('2026-10-03T21:00') },
      leadTime: 2.5 * DAY,
      cycleTime: null,
      blockedTime: null,
      reopenings: 0,
    });
  });

  it('ne donne pas de durée négative quand la clôture précède la création', () => {
    const chronology = chronologyFromDates({ createdAt: at('2026-10-03T09:00'), closedAt: at('2026-10-01T09:00') });

    expect(chronology.leadTime).toBe(0);
    expect(chronology.transitions.map((t) => t.duration)).toEqual([0, null]);
    expect(chronology.transitions[1]?.at).toBe(iso('2026-10-03T09:00'));
  });
});
