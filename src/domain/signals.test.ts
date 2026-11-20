import { describe, expect, it } from 'vitest';
import { analyzeProject, type MetricsTicket } from './metrics';
import { signalsOf } from './signals';
import { declareStatuses, NO_DECLARED_STATUSES } from './statuses';

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
  signalsOf([{ id: 'p', name: 'Projet P', analysis: analyzeProject(tickets, NO_DECLARED_STATUSES) }], { now, timeZone: PARIS });

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
    const p = { id: 'p', name: 'P', analysis: analyzeProject([...tenDeliveries(), working('w1', 10), working('w2', 20), ready('r1', 15)], NO_DECLARED_STATUSES) };
    const q = { id: 'q', name: 'Q', analysis: analyzeProject([ready('r2', 30), blocked('b1', 4), blocked('b2', 6)], NO_DECLARED_STATUSES) };

    const order = signalsOf([p, q], { now: NOW, timeZone: PARIS }).flatMap((signal) => ('ticket' in signal ? [signal.ticket.id] : []));

    // b1 et b2 sont aussi en travail : la colonne Bloqué. Sans Livraison dans Q, ils ne dérivent pas.
    expect(order).toEqual(['w2', 'w1', 'b2', 'b1', 'r2', 'r1']);
  });
});

describe('signalsOf : Validation qui attend', () => {
  it('un ticket À valider depuis plus de 24 heures est un Signal, daté de son passage À valider, avec sa Durée écoulée', () => {
    const waiting = ticket('v', [
      ['open', ago(5)],
      ['in_progress', ago(4)],
      ['awaiting_human', ago(2)],
    ]);

    expect(signalsAt([waiting])).toEqual([
      {
        kind: 'waitingValidation',
        project: 'p',
        ticket: { id: 'v', title: 'Titre de v', type: 'task', priority: 2 },
        since: ago(2),
        duration: 2 * DAY,
      },
    ]);
  });

  it('24 heures pile ne suffisent pas ; 24 heures et une milliseconde, si', () => {
    const exactly = ticket('e', [
      ['in_progress', ago(3)],
      ['awaiting_human', NOW - DAY],
    ]);
    const justOver = ticket('j', [
      ['in_progress', ago(3)],
      ['awaiting_human', NOW - DAY - 1],
    ]);

    expect(signalsAt([exactly])).toEqual([]);
    expect(signalsAt([exactly], NOW + 1)).toMatchObject([{ kind: 'waitingValidation', ticket: { id: 'e' }, duration: DAY + 1 }]);
    expect(signalsAt([justOver])).toMatchObject([{ kind: 'waitingValidation', ticket: { id: 'j' }, since: NOW - DAY - 1, duration: DAY + 1 }]);
  });

  it('se compte depuis le dernier passage À valider, ou depuis la création dans ce statut', () => {
    const backAgain = ticket('b', [
      ['in_progress', ago(10)],
      ['awaiting_human', ago(8)],
      ['in_progress', ago(6)],
      ['awaiting_human', NOW - 12 * HOUR],
    ]);
    const createdWaiting = ticket('c', [['awaiting_human', ago(3)]]);

    expect(signalsAt([backAgain, createdWaiting])).toEqual([expect.objectContaining({ kind: 'waitingValidation', ticket: expect.objectContaining({ id: 'c' }), since: ago(3) })]);
  });

  it('un ticket fermé, ou sorti de À valider, n’attend plus de validation', () => {
    const closed = ticket('f', [
      ['in_progress', ago(10)],
      ['awaiting_human', ago(9)],
      ['closed', ago(2)],
    ]);
    const greenLit = ticket('g', [
      ['in_progress', ago(10)],
      ['awaiting_human', ago(9)],
      ['in_integration', ago(2)],
    ]);
    const inReview = ticket('r', [
      ['in_progress', ago(10)],
      ['in_review', ago(2)],
    ]);

    expect(signalsAt([closed, greenLit, inReview])).toEqual([]);
  });

  it('le statut seul compte : À valider en Blocage, il attend tout autant', () => {
    const blocker = ticket('x', [['in_progress', ago(2)]]);
    const waiting = ticket('w', [['awaiting_human', ago(2)]], { dependencies: [{ type: 'blocks', target: 'x', addedAt: new Date(ago(2)) }] });

    expect(signalsAt([blocker, waiting])).toMatchObject([{ kind: 'waitingValidation', ticket: { id: 'w' }, since: ago(2) }]);
  });

  it('se lit au Dernier commit qu’on lui donne : ce qui vient après `now` n’en fait pas partie', () => {
    const waiting = ticket('v', [
      ['in_progress', ago(5)],
      ['awaiting_human', ago(2)],
      ['in_progress', NOW + HOUR],
    ]);

    expect(signalsAt([waiting])).toMatchObject([{ kind: 'waitingValidation', since: ago(2) }]);
  });
});

describe('signalsOf : Boucle de Retours', () => {
  /** Un ticket créé il y a 2 jours, puis passé par `statuses`, une heure d'écart chacun, jusqu'à 10 heures avant NOW. */
  const passedThrough = (id: string, statuses: string[], extra: Partial<MetricsTicket> = {}) =>
    ticket(
      id,
      statuses.map((status, i): [string, number] => [status, ago(2) + i * HOUR]),
      extra,
    );
  const loops = (signals: ReturnType<typeof signalsAt>) => signals.filter((signal) => signal.kind === 'sendBackLoop');
  /** `n` Retours depuis `relay`. */
  const bounced = (relay: string, n: number) => ['open', ...Array.from({ length: n }, () => ['in_progress', relay]).flat(), 'in_progress'];

  it('un ticket non fermé qui a subi 3 Retours est un Signal, avec leur nombre', () => {
    const loop = passedThrough('l', ['open', 'in_progress', 'in_review', 'in_progress', 'in_integration', 'in_progress', 'awaiting_human', 'in_progress']);

    expect(signalsAt([loop])).toEqual([
      { kind: 'sendBackLoop', project: 'p', ticket: { id: 'l', title: 'Titre de l', type: 'task', priority: 2 }, sendBacks: 3 },
    ]);
  });

  it('2 Retours ne suffisent pas ; 3, si', () => {
    expect(loops(signalsAt([passedThrough('two', bounced('in_review', 2))]))).toEqual([]);
    expect(loops(signalsAt([passedThrough('three', bounced('in_review', 3))]))).toMatchObject([{ ticket: { id: 'three' }, sendBacks: 3 }]);
  });

  it('compte les Retours de chaque origine : relecture, intégration, validation', () => {
    for (const relay of ['in_review', 'in_integration', 'awaiting_human']) {
      expect(loops(signalsAt([passedThrough('r', bounced(relay, 3))])), relay).toMatchObject([{ sendBacks: 3 }]);
      expect(loops(signalsAt([passedThrough('r', bounced(relay, 2))])), relay).toEqual([]);
    }
  });

  it('un Retour mène à en cours, rattaché à un agent ou un statut que le Projet déclare `wip` ; pas à ouvert, ni à un autre Statut de relais', () => {
    const toHooked = passedThrough('h', ['open', 'hooked', 'in_review', 'hooked', 'in_review', 'hooked', 'in_review', 'hooked']);
    const toDeclaredWip = passedThrough('d', ['open', 'in_progress', 'in_review', 'rework', 'in_review', 'rework', 'in_review', 'rework']);
    const notSentBack = passedThrough('n', ['open', 'in_progress', 'in_review', 'open', 'in_progress', 'in_review', 'in_integration', 'in_review', 'in_progress', 'in_review', 'in_progress']);
    const declared = declareStatuses([{ name: 'rework', category: 'wip' }]);
    const at = (tickets: MetricsTicket[], statuses = declared) =>
      loops(signalsOf([{ id: 'p', name: 'Projet P', analysis: analyzeProject(tickets, statuses) }], { now: NOW, timeZone: PARIS }));

    expect(at([toHooked, toDeclaredWip, notSentBack]).map((signal) => signal.ticket.id).sort()).toEqual(['d', 'h']);
    // Non déclaré, `rework` reste « En pause » : y passer n'est pas un Retour.
    expect(at([toDeclaredWip], NO_DECLARED_STATUSES)).toEqual([]);
  });

  it('un ticket fermé n’est pas une Boucle de Retours, même après 3 Retours', () => {
    expect(loops(signalsAt([passedThrough('f', [...bounced('in_review', 3), 'closed'])]))).toEqual([]);
  });

  it('un ticket rouvert compte tous ses Retours, ceux d’avant la Réouverture compris', () => {
    const reopened = passedThrough('o', [...bounced('in_review', 2), 'closed', 'open', 'in_progress', 'in_integration', 'in_progress']);

    expect(loops(signalsAt([reopened]))).toMatchObject([{ ticket: { id: 'o' }, sendBacks: 3 }]);
  });

  it('se lit au Dernier commit qu’on lui donne : un Retour ou une clôture après `now` n’en font pas partie', () => {
    const later = ticket('t', [
      ['open', ago(2)],
      ['in_progress', ago(2) + HOUR],
      ['in_review', ago(2) + 2 * HOUR],
      ['in_progress', ago(2) + 3 * HOUR],
      ['in_review', ago(2) + 4 * HOUR],
      ['in_progress', ago(2) + 5 * HOUR],
      ['in_review', ago(2) + 6 * HOUR],
      ['in_progress', NOW + HOUR],
    ]);
    const closedLater = passedThrough('c', bounced('in_review', 3));
    closedLater.statusSnapshots.push({ status: 'closed', at: new Date(NOW + HOUR) });

    expect(loops(signalsAt([later, closedLater])).map((signal) => signal.ticket.id)).toEqual(['c']);
    // Un Retour enregistré à `now` même en fait partie.
    expect(loops(signalsAt([later], NOW + HOUR))).toMatchObject([{ ticket: { id: 't' }, sendBacks: 3 }]);
  });
});

describe('signalsOf : sans Statut de relais', () => {
  it('un Projet qui n’en a jamais porté n’a aucun nouveau Signal, et garde les autres', () => {
    const bouncing = ticket('b', [
      ['open', ago(10)],
      ['in_progress', ago(9)],
      ['open', ago(8)],
      ['in_progress', ago(7)],
      ['blocked', ago(6)],
      ['in_progress', ago(5)],
      ['open', ago(4)],
      ['in_progress', ago(3)],
      ['blocked', ago(2)],
      ['in_progress', ago(1)],
    ]);
    const blocked = ticket('k', [
      ['open', ago(10)],
      ['blocked', ago(4)],
    ]);
    const ready = ticket('r', [['open', ago(20)]]);

    expect(signalsAt([bouncing, blocked, ready]).map(({ kind }) => kind)).toEqual(['longBlockage', 'stagnantReady', 'unusualWip']);
  });
});

describe('signalsOf : ordre des nouveaux Signaux', () => {
  it('après le WIP inhabituel : les Validations qui attendent, la plus longue d’abord, puis les Boucles de Retours, la plus longue d’abord', () => {
    const waiting = (id: string, days: number) =>
      ticket(id, [
        ['in_progress', ago(days + 1)],
        ['awaiting_human', ago(days)],
      ]);
    const looping = (id: string, n: number) =>
      ticket(
        id,
        ['open', ...Array.from({ length: n }, () => ['in_progress', 'in_review']).flat(), 'in_progress'].map((status, i): [string, number] => [status, ago(2) + i * HOUR]),
      );
    const blocked = ticket('k', [
      ['open', ago(10)],
      ['blocked', ago(4)],
    ]);

    const order = signalsAt([looping('l3', 3), waiting('vb', 2), looping('l4', 4), blocked, waiting('va', 1.5)]).map((signal) =>
      'ticket' in signal ? `${signal.kind}:${signal.ticket.id}` : signal.kind,
    );

    expect(order).toEqual(['longBlockage:k', 'waitingValidation:vb', 'waitingValidation:va', 'sendBackLoop:l4', 'sendBackLoop:l3']);
  });
});
