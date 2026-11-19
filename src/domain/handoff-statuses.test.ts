import { describe, expect, it } from 'vitest';
import type { DeclaredStatuses, MetricsCfdPoint } from '../shared/api';
import { analyzeChronologies } from './chronology';
import type { DependencyHistory } from './flow';
import { computeHealth } from './health';
import { analyzeProject, computeMetrics, type MetricsInput, type MetricsTicket } from './metrics';
import { signalsOf } from './signals';
import { columnAt } from './timeline';

/**
 * Les Statuts de relais (En relecture, En intégration, À valider) sont des statuts de travail (bdesk-pz0.3, ADR 0007) : leur temps compte dans le Cycle
 * Time, et le WIP, la Dérive, le Blocage long, la Prise rendue et l'Efficacité du flux les incluent ; le CFD gagne leurs colonnes. Un autre statut que
 * le Projet déclare de catégorie `wip` compte comme en cours. Les historiques sont fictifs ; chaque scénario dit les dates qu'il fabrique.
 */

const PARIS = 'Europe/Paris';
/** Vendredi 23 octobre 2026, 18:00Z (20:00 à Paris). */
const NOW = Date.parse('2026-10-23T18:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (days: number) => NOW - days * DAY;

function ticket(id: string, statuses: [string, number][], extra: Partial<MetricsTicket> = {}): MetricsTicket {
  return {
    id,
    title: `Titre de ${id}`,
    type: 'task',
    priority: 2,
    statusSnapshots: statuses.map(([status, at]) => ({ status, at: new Date(at) })),
    dependencies: [],
    ...extra,
  };
}

/** Bloqué par `target` depuis `from` (ms), jusqu'à `to` s'il est donné. */
const blockedBy = (target: string, from: number, to?: number): DependencyHistory => ({
  type: 'blocks',
  target,
  addedAt: new Date(from),
  ...(to === undefined ? {} : { removedAt: new Date(to) }),
});

/** Un ticket ouvert depuis 9 jours (Prêt, pas encore un Prêt qui stagne), jamais démarré, qui en bloque d'autres. */
const blocker = (id = 'x') => ticket(id, [['open', ago(9)]]);

const project = (tickets: MetricsTicket[], declared?: DeclaredStatuses, id = 'p'): MetricsInput => ({
  id,
  name: `Projet ${id}`,
  analysis: analyzeProject(tickets, declared),
});

const metricsOf = (projects: MetricsInput[]) => computeMetrics(projects, { period: { range: '7d' }, now: new Date(NOW), timeZone: PARIS });
const healthOf = (projects: MetricsInput[]) => computeHealth(projects, { period: { range: '7d' }, now: new Date(NOW), timeZone: PARIS });
const signalsAt = (projects: MetricsInput[]) => signalsOf(projects, { now: NOW, timeZone: PARIS });
const columnsIn = (point: MetricsCfdPoint | undefined) => Object.keys(point ?? {}).filter((key) => key !== 'date');

/** Les tickets qui passent par chaque Statut de relais, à l'instant de la mesure. */
const relaying = () => [
  ticket('rel', [['open', ago(6)], ['in_progress', ago(5)], ['in_review', ago(1)]]),
  ticket('int', [['open', ago(6)], ['in_progress', ago(5)], ['in_integration', ago(1)]]),
  ticket('val', [['open', ago(6)], ['in_progress', ago(5)], ['awaiting_human', ago(1)]]),
  ticket('dev', [['open', ago(6)], ['in_progress', ago(5)]]),
  ticket('pret', [['open', ago(6)]]),
  ticket('pause', [['open', ago(6)], ['in_progress', ago(5)], ['deferred', ago(1)]]),
];

describe('WIP et âges des tickets en cours', () => {
  it('comptent les tickets dans un Statut de relais, déclaré ou non, comme ceux en cours', () => {
    const report = metricsOf([project(relaying())]);

    expect(report.tiles.wip.current).toBe(4);
    expect(report.inProgress.map(({ id, status, blocked }) => [id, status, blocked]).sort()).toEqual([
      ['dev', 'in_progress', false],
      ['int', 'in_integration', false],
      ['rel', 'in_review', false],
      ['val', 'awaiting_human', false],
    ]);
    expect(report.inProgress.find(({ id }) => id === 'rel')).toMatchObject({ startedAt: new Date(ago(5)).toISOString(), age: 5 * DAY });
  });

  it('disent bloqué un ticket dans un Statut de relais et en Blocage, sans le sortir du WIP', () => {
    const report = metricsOf([project([blocker(), ticket('rel', [['open', ago(6)], ['in_review', ago(2)]], { dependencies: [blockedBy('x', ago(1))] })])]);

    expect(report.tiles.wip.current).toBe(1);
    expect(report.inProgress).toMatchObject([{ id: 'rel', status: 'in_review', blocked: true }]);
  });

  it('comptent un statut que le Projet déclare wip avec sa déclaration, et pas sans elle', () => {
    const tickets = [ticket('qa', [['open', ago(6)], ['in_progress', ago(5)], ['qa_testing', ago(1)]])];
    const declared: DeclaredStatuses = { handoff: [], others: [{ name: 'qa_testing', category: 'wip' }] };

    expect(metricsOf([project(tickets, declared)]).tiles.wip.current).toBe(1);
    expect(metricsOf([project(tickets)]).tiles.wip.current).toBe(0);
  });
});

describe('CFD : les colonnes des Statuts de relais (columnFor, à chaque instant)', () => {
  it('garde ses cinq colonnes pour un Projet qui ne déclare aucun Statut de relais et dont aucun ticket n’en a porté', () => {
    const report = metricsOf([project([ticket('dev', [['open', ago(6)], ['in_progress', ago(5)]])])]);

    expect(columnsIn(report.cfd.at(-1))).toEqual(['backlog', 'ready', 'inProgress', 'blocked', 'done']);
  });

  it('range chaque ticket dans la colonne de son Statut de relais, entre En cours et Bloqué, sans déclaration', () => {
    const report = metricsOf([project(relaying())]);

    expect(report.cfd.at(-1)).toEqual({
      date: '2026-10-23',
      backlog: 0,
      ready: 1,
      inProgress: 1,
      inReview: 1,
      inIntegration: 1,
      awaitingHuman: 1,
      blocked: 0,
      done: 0,
    });
    expect(columnsIn(report.cfd[0])).toEqual(['backlog', 'ready', 'inProgress', 'inReview', 'inIntegration', 'awaitingHuman', 'blocked', 'done']);
    // Avant leur passage en relais ou en pause, ces tickets étaient En cours : les colonnes existent sur toute la période, vides jusque-là.
    expect(report.cfd.at(-3)).toMatchObject({ date: '2026-10-21', inProgress: 5, inReview: 0, inIntegration: 0, awaitingHuman: 0 });
  });

  it('n’ajoute que les colonnes des Statuts de relais portés ou déclarés, et une colonne déclarée reste là, vide, sans ticket', () => {
    const carried = metricsOf([project([ticket('val', [['open', ago(6)], ['awaiting_human', ago(1)]])])]);
    const declared = metricsOf([project([ticket('pret', [['open', ago(6)]])], { handoff: ['in_integration'], others: [] })]);

    expect(columnsIn(carried.cfd.at(-1))).toEqual(['backlog', 'ready', 'inProgress', 'awaitingHuman', 'blocked', 'done']);
    expect(declared.cfd.at(-1)).toEqual({ date: '2026-10-23', backlog: 0, ready: 1, inProgress: 0, inIntegration: 0, blocked: 0, done: 0 });
  });

  it('garde la colonne d’un Statut de relais qu’un ticket a quitté avant la période : son historique l’a porté', () => {
    const report = metricsOf([project([ticket('t', [['open', ago(30)], ['in_review', ago(29)], ['closed', ago(28)]])])]);

    expect(report.cfd.at(-1)).toMatchObject({ inReview: 0, done: 1 });
  });

  it('range un ticket dans un Statut de relais et en Blocage dans Bloqué', () => {
    const report = metricsOf([project([blocker(), ticket('rel', [['open', ago(6)], ['in_review', ago(2)]], { dependencies: [blockedBy('x', ago(1))] })])]);

    expect(report.cfd.at(-1)).toMatchObject({ ready: 1, inReview: 0, blocked: 1 });
    expect(report.cfd.at(-3)).toMatchObject({ date: '2026-10-21', ready: 1, inReview: 1, blocked: 0 }); // en relecture le 21 à 18:00Z, bloqué le 22 à 18:00Z
  });

  it('réunit les colonnes de relais des Projets mesurés : un Projet qui n’en a pas y compte zéro', () => {
    const report = metricsOf([
      project([ticket('rel', [['open', ago(6)], ['in_review', ago(1)]])], undefined, 'p'),
      project([ticket('dev', [['open', ago(6)], ['in_progress', ago(5)]])], undefined, 'q'),
    ]);

    expect(report.cfd.at(-1)).toEqual({ date: '2026-10-23', backlog: 0, ready: 0, inProgress: 1, inReview: 1, blocked: 0, done: 0 });
  });

  it('range un statut déclaré wip dans En cours, et le laisse hors des colonnes (« En pause ») sans la déclaration', () => {
    const tickets = [ticket('qa', [['open', ago(6)], ['qa_testing', ago(1)]])];

    expect(metricsOf([project(tickets, { handoff: [], others: [{ name: 'qa_testing', category: 'wip' }] })]).cfd.at(-1)).toMatchObject({ inProgress: 1 });
    expect(metricsOf([project(tickets)]).cfd.at(-1)).toMatchObject({ ready: 0, inProgress: 0 });
  });
});

describe('Cycle Time et Efficacité du flux', () => {
  it('comptent le temps des Statuts de relais dans le Cycle Time, et son Blocage dans la part bloquée', () => {
    // 2 h en cours, puis 4 h en relecture dont les 2 dernières bloquées par x : Cycle Time 6 h, dont 2 h de Blocage.
    const delivered = ticket(
      'd',
      [
        ['open', ago(2)],
        ['in_progress', ago(2) + 1 * HOUR],
        ['in_review', ago(2) + 3 * HOUR],
        ['closed', ago(2) + 7 * HOUR],
      ],
      { dependencies: [blockedBy('x', ago(2) + 5 * HOUR)] },
    );
    const projects = [project([blocker(), delivered])];

    expect(metricsOf(projects).tiles.cycleTime).toMatchObject({ median: 6 * HOUR, n: 1 });
    expect(healthOf(projects).efficiency).toMatchObject({ n: 1, cycleTime: 6 * HOUR, blockedTime: 2 * HOUR, blockedDeliveries: 1, ratio: 4 / 6 });
  });
});

describe('Dérive', () => {
  /** Dix Livraisons démarrées il y a 30 jours, livrées en 1 à 10 jours : le Cycle Time de référence vaut 8,65 jours. */
  const tenDeliveries = () =>
    Array.from({ length: 10 }, (_, i) =>
      ticket(`d${i + 1}`, [
        ['open', ago(31)],
        ['in_progress', ago(30)],
        ['closed', ago(30 - (i + 1))],
      ]),
    );

  it('mesure le Cycle Time en cours d’un ticket passé en relais, temps de relais compris', () => {
    const relayed = ticket('r', [['open', ago(13)], ['in_progress', ago(12)], ['in_review', ago(6)], ['in_progress', ago(4)], ['awaiting_human', ago(1)]]);

    expect(signalsAt([project([...tenDeliveries(), relayed])])).toEqual([
      expect.objectContaining({ kind: 'drift', ticket: expect.objectContaining({ id: 'r' }), cycleTime: 12 * DAY }),
    ]);
  });

  it('ne fait plus dériver un ticket revenu à ouvert depuis un Statut de relais', () => {
    const handedBack = ticket('r', [['open', ago(13)], ['in_progress', ago(12)], ['in_review', ago(2)], ['open', ago(1)]]);

    expect(signalsAt([project([...tenDeliveries(), handedBack])]).filter(({ kind }) => kind === 'drift')).toEqual([]);
  });
});

describe('Blocage long', () => {
  it('ne recommence pas quand le ticket passe d’en cours à En relecture, puis à À valider, toujours en Blocage', () => {
    const moving = ticket('m', [['open', ago(10)], ['in_progress', ago(8)], ['in_review', ago(2)], ['awaiting_human', ago(1)]], {
      dependencies: [blockedBy('x', ago(5))],
    });

    expect(signalsAt([project([blocker(), moving])])).toEqual([
      { kind: 'longBlockage', project: 'p', ticket: expect.objectContaining({ id: 'm' }), since: ago(5), duration: 5 * DAY },
    ]);
  });

  it('court aussi pour un ticket bloqué depuis plus de 3 jours dans un Statut de relais', () => {
    const waiting = ticket('w', [['open', ago(10)], ['in_integration', ago(8)]], { dependencies: [blockedBy('x', ago(4))] });

    expect(signalsAt([project([blocker(), waiting])])).toMatchObject([{ kind: 'longBlockage', since: ago(4), duration: 4 * DAY }]);
  });

  it('s’arrête quand le ticket revient à ouvert depuis un Statut de relais : il n’est plus en travail', () => {
    const back = ticket('b', [['open', ago(10)], ['in_review', ago(8)], ['open', ago(1)]], { dependencies: [blockedBy('x', ago(5))] });
    const analysis = analyzeProject([blocker(), back]);

    expect(signalsAt([{ id: 'p', name: 'Projet p', analysis }])).toEqual([]);
    const timeline = analysis.tickets.find(({ id }) => id === 'b')?.timeline;
    expect(timeline && columnAt(timeline, NOW)).toBe('backlog');
  });
});

describe('Prise rendue et Retravail', () => {
  it('compte une Prise rendue depuis En relecture ou En intégration vers ouvert, mais pas un Report depuis À valider', () => {
    const tickets = [
      ticket('relu', [['open', ago(6)], ['in_progress', ago(5)], ['in_review', ago(4)], ['open', ago(3)]]),
      ticket('integre', [['open', ago(6)], ['in_integration', ago(4)], ['open', ago(2)]]),
      ticket('reporte', [['open', ago(6)], ['in_progress', ago(5)], ['awaiting_human', ago(4)], ['open', ago(3)]]),
      ticket('retour', [['open', ago(6)], ['in_progress', ago(5)], ['in_review', ago(4)], ['in_progress', ago(3)]]), // un Retour, pas du Retravail
    ];

    expect(healthOf([project(tickets)]).rework.tickets.map(({ id, returns, reopenings }) => [id, returns, reopenings])).toEqual([
      ['integre', 1, 0],
      ['relu', 1, 0],
    ]);
  });

  it('compte une Prise rendue depuis un statut que le Projet déclare wip, avec sa déclaration seulement', () => {
    const tickets = [ticket('qa', [['open', ago(6)], ['qa_testing', ago(4)], ['open', ago(3)]])];

    expect(healthOf([project(tickets, { handoff: [], others: [{ name: 'qa_testing', category: 'wip' }] })]).rework.tickets).toMatchObject([{ id: 'qa', returns: 1 }]);
    expect(healthOf([project(tickets)]).rework.tickets).toEqual([]);
  });
});

describe('Chronologie', () => {
  it('compte le temps de relais dans le Cycle Time, et le Blocage pendant le relais dans la phase en cours de travail, d’un seul tenant', () => {
    const base = Date.parse('2026-10-01T09:00:00Z');
    const t = (hours: number) => new Date(base + hours * HOUR);
    const history = {
      id: 'c',
      type: 'task',
      statusSnapshots: [
        { status: 'open', at: t(0) },
        { status: 'in_progress', at: t(1) },
        { status: 'in_review', at: t(3) },
        { status: 'awaiting_human', at: t(4) },
        { status: 'deferred', at: t(6) },
        { status: 'closed', at: t(8) },
      ],
      dependencies: [{ type: 'blocks', target: 'x', addedAt: t(2), removedAt: t(7) }],
    };
    const target = { id: 'x', type: 'task', statusSnapshots: [{ status: 'open', at: t(0) }], dependencies: [] };

    const chronology = analyzeChronologies([history, target]).of('c');

    expect(chronology).toMatchObject({ cycleTime: 5 * HOUR, blockedTime: 4 * HOUR, leadTime: 8 * HOUR });
    expect(chronology?.blockages).toEqual([
      {
        from: t(2).toISOString(),
        to: t(7).toISOString(),
        blockedBy: ['x'],
        statusBlocked: false,
        phases: [
          { kind: 'work', from: t(2).toISOString(), to: t(6).toISOString() },
          { kind: 'otherWait', from: t(6).toISOString(), to: t(7).toISOString() },
        ],
      },
    ]);
  });

  it('compte le temps d’un statut déclaré wip avec la déclaration du Projet', () => {
    const at = (hours: number) => new Date(Date.parse('2026-10-01T09:00:00Z') + hours * HOUR);
    const history = {
      id: 'q',
      type: 'task',
      statusSnapshots: [
        { status: 'open', at: at(0) },
        { status: 'qa_testing', at: at(1) },
        { status: 'closed', at: at(4) },
      ],
      dependencies: [],
    };

    expect(analyzeChronologies([history], { handoff: [], others: [{ name: 'qa_testing', category: 'wip' }] }).of('q')?.cycleTime).toBe(3 * HOUR);
    expect(analyzeChronologies([history]).of('q')?.cycleTime).toBeNull();
  });
});
