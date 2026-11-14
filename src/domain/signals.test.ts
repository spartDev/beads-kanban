import { describe, expect, it } from 'vitest';
import { analyzeProject, type MetricsTicket } from './metrics';
import { signalsOf } from './signals';

/** Vendredi 23 octobre 2026, 18:00Z (20:00 à Paris). */
const NOW = new Date('2026-10-23T18:00:00Z').getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PARIS = 'Europe/Paris';
const iso = (ms: number) => new Date(ms).toISOString().slice(0, -1);

function ticket(id: string, statuses: [string, number][], extra: Partial<MetricsTicket> = {}): MetricsTicket {
  return {
    id,
    title: `Titre de ${id}`,
    type: 'task',
    priority: 2,
    statusSnapshots: statuses.map(([status, at]) => ({ status, at: new Date(`${iso(at)}Z`) })),
    dependencies: [],
    ...extra,
  };
}

const ago = (days: number) => NOW - days * DAY;

/** Les Signaux d'un seul Projet, « p », à NOW. */
const signalsAt = (tickets: MetricsTicket[], now = NOW) =>
  signalsOf([{ id: 'p', name: 'Projet P', analysis: analyzeProject(tickets) }], { now, timeZone: PARIS });

describe('signalsOf : Blocage long', () => {
  it('un ticket en travail et en Blocage depuis plus de 3 jours est un Blocage long, daté du début de cette phase', () => {
    const blocked = ticket('b', [
      ['open', ago(10)],
      ['in_progress', ago(8)],
      ['blocked', ago(4)],
    ]);

    expect(signalsAt([blocked])).toEqual([
      {
        kind: 'longBlockage',
        project: 'p',
        ticket: { id: 'b', title: 'Titre de b', type: 'task', priority: 2 },
        since: ago(4),
        duration: 4 * DAY,
      },
    ]);
  });

  it('3 jours pile ne font pas un Blocage long', () => {
    const blocked = ticket('b', [
      ['open', ago(10)],
      ['blocked', ago(3)],
    ]);

    expect(signalsAt([blocked])).toEqual([]);
    expect(signalsAt([blocked], NOW + 1)).toHaveLength(1);
  });

  it('un Blocage par dépendance commencé en Backlog ne compte qu’à partir du démarrage : la phase en cours de travail', () => {
    const blocker = ticket('x', [['open', ago(20)]]);
    const waiting = ticket(
      'w',
      [
        ['open', ago(10)], // en Backlog dès sa création : il dépend de x, ouvert
        ['in_progress', ago(5)],
      ],
      { dependencies: [{ type: 'blocks', target: 'x', addedAt: new Date(ago(10)) }] },
    );

    const longBlockages = signalsAt([blocker, waiting]).filter((signal) => signal.kind === 'longBlockage'); // x, Prêt depuis 20 jours, stagne aussi

    expect(longBlockages).toMatchObject([{ ticket: { id: 'w' }, since: ago(5), duration: 5 * DAY }]);
  });
});

/** Dix Livraisons démarrées il y a 30 jours, de Cycle Time 1 à 10 jours : P85 de 8,65 jours. */
const tenDeliveries = () =>
  Array.from({ length: 10 }, (_, i) =>
    ticket(`d${i + 1}`, [
      ['open', ago(31)],
      ['in_progress', ago(30)],
      ['closed', ago(30 - (i + 1))],
    ]),
  );

describe('signalsOf : Dérive', () => {
  it('un ticket en Dérive est un Signal, avec son Cycle Time en cours et sa référence', () => {
    const working = ticket('w', [
      ['open', ago(13)],
      ['in_progress', ago(12)],
    ]);

    expect(signalsAt([...tenDeliveries(), working])).toEqual([
      {
        kind: 'drift',
        project: 'p',
        ticket: { id: 'w', title: 'Titre de w', type: 'task', priority: 2 },
        cycleTime: 12 * DAY,
        reference: expect.closeTo(8.65 * DAY, 3),
        scope: 'type',
      },
    ]);
  });
});

describe('signalsOf : Prêt qui stagne', () => {
  it('un Prêt depuis plus de 14 jours est un Signal, avec depuis quand il l’est et son Âge calendaire', () => {
    const ready = ticket('r', [['open', ago(20)]]);

    expect(signalsAt([ready])).toEqual([
      { kind: 'stagnantReady', project: 'p', ticket: { id: 'r', title: 'Titre de r', type: 'task', priority: 2 }, since: ago(20), age: 20 * DAY },
    ]);
  });

  it('14 jours pile ne stagnent pas ; l’âge se compte depuis qu’il est redevenu Prêt', () => {
    const exactly = ticket('e', [['open', ago(14)]]);
    const returned = ticket('t', [
      ['open', ago(40)],
      ['in_progress', ago(30)],
      ['open', ago(10)],
    ]);

    expect(signalsAt([exactly, returned])).toEqual([]);
  });
});

describe('signalsOf : WIP inhabituel', () => {
  /** Un ticket en cours depuis `days` jours, créé une heure avant. */
  const workingSince = (id: string, days: number) =>
    ticket(id, [
      ['open', ago(days) - HOUR],
      ['in_progress', ago(days)],
    ]);
  const onlyWip = (signals: ReturnType<typeof signalsAt>) => signals.filter((signal) => signal.kind === 'unusualWip');

  it('un WIP au-dessus du P85 des relevés quotidiens des 90 derniers jours est un Signal, avec ce seuil', () => {
    // Un ticket en cours depuis 30 jours : 30 relevés à 1. Trois de plus démarrés il y a une heure : un WIP de 4.
    const tickets = [workingSince('a', 30), workingSince('b', 1 / 24), workingSince('c', 1 / 24), workingSince('d', 1 / 24)];

    expect(onlyWip(signalsAt(tickets))).toEqual([{ kind: 'unusualWip', project: 'p', wip: 4, threshold: 1 }]);
  });

  it('un WIP égal au seuil n’est pas inhabituel', () => {
    expect(onlyWip(signalsAt([workingSince('a', 30)]))).toEqual([]);
  });

  it('ne relève que les jours où le Projet existait : sous 14 relevés, on ne sait pas ce qui est habituel', () => {
    // Le Projet a 13 jours et quelques heures : 13 relevés.
    const young = [workingSince('a', 13), workingSince('b', 1 / 24), workingSince('c', 1 / 24)];
    const older = [workingSince('a', 14), workingSince('b', 1 / 24), workingSince('c', 1 / 24)];

    expect(onlyWip(signalsAt(young))).toEqual([]);
    expect(onlyWip(signalsAt(older))).toHaveLength(1);
  });
});

describe('signalsOf : ordre', () => {
  it('groupe par sorte (Dérive, Blocage long, Prêt qui stagne), le plus en excès d’abord, sur tous les Projets', () => {
    const working = (id: string, days: number) =>
      ticket(id, [
        ['open', ago(days + 1)],
        ['in_progress', ago(days)],
      ]);
    const blocked = (id: string, days: number) =>
      ticket(id, [
        ['open', ago(days + 1)],
        ['blocked', ago(days)],
      ]);
    const ready = (id: string, days: number) => ticket(id, [['open', ago(days)]]);
    const p = { id: 'p', name: 'P', analysis: analyzeProject([...tenDeliveries(), working('w1', 10), working('w2', 20), ready('r1', 15)]) };
    const q = { id: 'q', name: 'Q', analysis: analyzeProject([ready('r2', 30), blocked('b1', 4), blocked('b2', 6)]) };

    const order = signalsOf([p, q], { now: NOW, timeZone: PARIS }).flatMap((signal) => ('ticket' in signal ? [signal.ticket.id] : []));

    // b1 et b2 sont aussi en travail : la colonne Bloqué. Sans Livraison dans Q, ils ne dérivent pas.
    expect(order).toEqual(['w2', 'w1', 'b2', 'b1', 'r2', 'r1']);
  });
});
