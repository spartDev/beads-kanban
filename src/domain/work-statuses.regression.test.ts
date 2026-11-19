import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { analyzeChronologies } from './chronology';
import { columnFor } from './columns';
import { groupByColumn } from './epics';
import { analyzeFlow, type TicketHistory } from './flow';
import { computeHealth } from './health';
import { longTrendOf } from './longTrend';
import { analyzeProject, computeMetrics, type MetricsInput } from './metrics';
import { signalsOf } from './signals';
import { lastVisitWindow, sinceLastVisit } from './sinceLastVisit';
import { randomLineage, seededRandom } from './testing/random-histories';
import { columnAt } from './timeline';
import { NO_DECLARED_STATUSES } from './statuses';

/**
 * Non-régression des Statuts de relais (bdesk-pz0.3) : sur des historiques où aucun ticket n'a jamais porté de Statut de relais ni de statut
 * personnalisé, tout ce que l'app calcule est resté ce qu'il était avant que les Statuts de relais deviennent des statuts de travail. Les empreintes
 * ci-dessous ont été relevées sur le code d'avant (commit 7b9aade, cinq colonnes et trois statuts de travail), sur le même lot.
 *
 * Le lot : trois Projets tirés au hasard (graines fixes, une seule horloge par Projet comme dans Dolt, qui recule de temps en temps), de quarante tickets
 * chacun, avec tous les statuts de base (ouvert, en cours, rattaché à un agent, bloqué, différé, fermé : Réouvertures et Prises rendues comprises), des
 * dépendances qui bloquent et des bugs reliés à leur origine. Il est mesuré à un instant où un quart des tickets est encore ouvert.
 *
 * Les limites de ce garde-fou :
 * - une empreinte dit QUELLE partie a changé, pas QUOI : un écart se cherche en comparant la partie, champ par champ, avec le code d'avant ;
 * - n'entrent dans les empreintes que les champs qui existaient au code d'avant (`FIELDS`) : un champ qu'un ticket suivant ajoute aux rapports (bdesk-pz0.5,
 *   bdesk-pz0.6) n'y change rien, mais un champ ajouté qui reprendrait le nom d'un champ d'avant, ou un champ d'avant qui change de sens, les changerait.
 *   Le jour où un ticket suivant change, comme il le doit, une valeur que ces empreintes couvrent, il faut retirer ce fichier, et non relever ses
 *   empreintes à nouveau : relevées sur le nouveau code, elles ne compareraient plus rien au code d'avant ;
 * - le filtre cacherait un champ nouveau qui ne devrait pas apparaître ici, comme une colonne de relais dans le CFD d'un Projet sans relais : le
 *   premier test vérifie à part que le CFD n'a que ses cinq colonnes ;
 * - le lot n'a ni statut épinglé (`pinned`), ni statut inconnu, ni statut personnalisé, ni critères d'acceptation (aucune Intention écrite connue) :
 *   ces cas ne sont couverts que par les tests unitaires (`columns.test.ts`, `flow.test.ts`, `handoff-statuses.test.ts`).
 */

const PROJECTS = [
  { id: 'p', seed: 7, clockBack: 0 },
  { id: 'q', seed: 21, clockBack: 10 },
  { id: 'r', seed: 1337, clockBack: 20 },
] as const;

const TIME_ZONE = 'Europe/Paris';
const HOUR = 3_600_000;

const histories = new Map(PROJECTS.map(({ id, seed, clockBack }) => [id, randomLineage(seededRandom(seed), { tickets: 40, clockBack, sharedClock: true }).histories]));
const allSnapshots = [...histories.values()].flat().flatMap((ticket) => ticket.statusSnapshots);
/** Un jour et demi après le dernier commit du lot. */
const NOW = Math.max(...allSnapshots.map((snapshot) => snapshot.at.getTime())) + 36 * HOUR;

const metricsTickets = (tickets: TicketHistory[]) => tickets.map((ticket, index) => ({ ...ticket, title: `Titre de ${ticket.id}`, priority: index % 5 }));
const inputs: MetricsInput[] = PROJECTS.map(({ id }) => ({ id, name: `Projet ${id}`, analysis: analyzeProject(metricsTickets(histories.get(id) ?? []), NO_DECLARED_STATUSES) }));

/** Les noms des champs des parties empreintées au code d'avant (commit 7b9aade) : les seuls que `digest` garde. */
const FIELDS: ReadonlySet<string> = new Set(
  [
    'abandoned', 'abandonment', 'activity', 'age', 'arrivals', 'asOf', 'at', 'average', 'backlog', 'blockages', 'blocked', 'blockedBy',
    'blockedDeliveries', 'blockedTime', 'board', 'bucket', 'buckets', 'bugs', 'cells', 'cfd', 'closed', 'closures', 'column', 'coverage', 'current',
    'cycleTime', 'cycleTimeScatter', 'date', 'days', 'declines', 'deliveredAt', 'deliveries', 'delta', 'dependencyWait', 'done', 'duplicates',
    'duration', 'efficiency', 'end', 'epic', 'failed', 'failedDeliveries', 'failureRate', 'from', 'id', 'inProgress', 'key', 'kind', 'label',
    'lastAt', 'leadTime', 'leadTimeBreakdown', 'leadTimeP85', 'linked', 'median', 'minBugs', 'minCoverage', 'minDeliveries', 'n', 'originBugs',
    'otherWait', 'outcome', 'p85', 'partial', 'paused', 'period', 'phases', 'previous', 'previousAsOf', 'previousPeriod', 'priority', 'project',
    'provisional', 'range', 'rate', 'ratio', 'ready', 'readyAges', 'readyWait', 'reason', 'reasons', 'recoveryTime', 'reference', 'reliable',
    'reopened', 'reopening', 'reopeningRate', 'reopenings', 'returns', 'rework', 'rule', 'scope', 'segments', 'significant', 'since', 'slices',
    'soundSignificance', 'soundThroughput', 'source', 'stagnant', 'stagnantAfter', 'start', 'startedAt', 'status', 'statusBlocked', 'steps',
    'superseded', 'thresholds', 'throughput', 'ticket', 'tickets', 'tiles', 'title', 'to', 'total', 'transitions', 'trend', 'type', 'waited',
    'waits', 'weeks', 'wip', 'work', 'writtenIntent',
  ],
);

/** L'empreinte d'une partie, sur ses seuls champs d'avant (`FIELDS`). */
const digest = (value: unknown): string =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_key, inner: unknown) => {
        if (inner instanceof Map) return [...inner];
        if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) return inner;
        return Object.fromEntries(Object.entries(inner).filter(([field]) => FIELDS.has(field)));
      }),
    )
    .digest('hex')
    .slice(0, 16);

describe('sans Statut de relais ni statut personnalisé, tout reste comme avant (bdesk-pz0.3)', () => {
  it('le lot est varié : des Livraisons, des tickets en travail, en Blocage, en pause, rouverts, rendus, et des Signaux', () => {
    const statuses = new Set(allSnapshots.map((snapshot) => snapshot.status));
    expect([...statuses].sort()).toEqual(['blocked', 'closed', 'deferred', 'hooked', 'in_progress', 'open']);

    const report = computeMetrics(inputs, { period: { range: '90d' }, now: new Date(NOW), timeZone: TIME_ZONE });
    const health = computeHealth(inputs, { period: { range: '90d' }, now: new Date(NOW), timeZone: TIME_ZONE });
    const signals = signalsOf(inputs, { now: NOW, timeZone: TIME_ZONE });
    expect(report.tiles.throughput.total).toBeGreaterThan(30);
    expect(report.inProgress.length).toBeGreaterThan(3);
    expect(report.inProgress.some((ticket) => ticket.blocked)).toBe(true);
    expect(health.rework.tickets.some((ticket) => ticket.returns > 0)).toBe(true);
    expect(health.rework.tickets.some((ticket) => ticket.reopenings > 0)).toBe(true);
    expect(new Set(signals.map((signal) => signal.kind))).toEqual(new Set(['drift', 'longBlockage', 'stagnantReady']));
    // Ce que le filtre des empreintes ne verrait pas : le CFD d'un lot sans relais n'a que ses cinq colonnes.
    for (const point of report.cfd) expect(Object.keys(point)).toEqual(['date', 'backlog', 'ready', 'inProgress', 'blocked', 'done']);
  });

  it('Lead Time, Cycle Time, temps bloqué et Attente de dépendance de chaque ticket', () => {
    expect(digest(PROJECTS.map(({ id }) => analyzeFlow(histories.get(id) ?? [])))).toBe(GOLDEN.flows);
  });

  it('les colonnes, les périodes de travail et les Blocages de chaque ticket au fil du temps (le CFD, le WIP)', () => {
    expect(digest(inputs.map(({ analysis }) => analysis.tickets.map(({ id, timeline }) => [id, timeline])))).toBe(GOLDEN.timelines);
  });

  it('le kanban et la page Epic : la colonne de chaque ticket à l’instant de la mesure', () => {
    const board = inputs.map(({ analysis }) => analysis.tickets.map(({ id, timeline }) => [id, columnAt(timeline, NOW)]));
    const statuses = ['open', 'in_progress', 'hooked', 'blocked', 'deferred', 'pinned', 'closed', 'review', ''];
    const rule = statuses.map((status) => [status, columnFor(status, false, NO_DECLARED_STATUSES), columnFor(status, true, NO_DECLARED_STATUSES)]);
    const epic = groupByColumn(statuses.flatMap((status) => [{ status, blockedBy: [] }, { status, blockedBy: ['x'] }]), NO_DECLARED_STATUSES);
    expect(digest({ board, rule, epic })).toBe(GOLDEN.board);
  });

  it.each([['7d'], ['30d'], ['90d']] as const)('les métriques sur %s : tuiles, Débit, nuage, CFD, âges, découpages', (range) => {
    expect(digest(computeMetrics(inputs, { period: { range }, now: new Date(NOW), timeZone: TIME_ZONE }))).toBe(GOLDEN.metrics[range]);
  });

  it.each([['7d'], ['30d'], ['90d']] as const)('la santé du flux sur %s : Efficacité du flux, Retravail, décomposition du Lead Time, Prêts', (range) => {
    expect(digest(computeHealth(inputs, { period: { range }, now: new Date(NOW), timeZone: TIME_ZONE }))).toBe(GOLDEN.health[range]);
  });

  it('les Signaux, la Tendance longue et « Depuis votre dernière visite »', () => {
    expect(digest(signalsOf(inputs, { now: NOW, timeZone: TIME_ZONE }))).toBe(GOLDEN.signals);
    expect(digest(longTrendOf(inputs, { now: new Date(NOW), timeZone: TIME_ZONE }))).toBe(GOLDEN.longTrend);
    expect(digest(sinceLastVisit(inputs, lastVisitWindow(NOW - 10 * 24 * HOUR, NOW)))).toBe(GOLDEN.sinceLastVisit);
  });

  it('la Chronologie de chaque ticket', () => {
    const chronologies = PROJECTS.map(({ id }) => {
      const tickets = histories.get(id) ?? [];
      const analysis = analyzeChronologies(tickets, NO_DECLARED_STATUSES);
      return tickets.map((ticket) => [ticket.id, analysis.of(ticket.id)]);
    });
    expect(digest(chronologies)).toBe(GOLDEN.chronologies);
  });
});

/** Relevées sur le code d'avant les Statuts de relais (commit 7b9aade). */
const GOLDEN = {
  flows: '2ef0a76b4ea320b6',
  timelines: '02ffec34d08fa8ba',
  board: '0da737fe91c46178',
  metrics: { '7d': '60482c7b98817a9b', '30d': '86d0a07d54b44653', '90d': 'a342446ea36ecfb2' },
  health: { '7d': '8d0de9ba79a14383', '30d': 'bb871ea61425def2', '90d': '205fd593a3c9ea4d' },
  signals: 'fe01b512d43bd670',
  longTrend: '56df8a42354ec9b3',
  sinceLastVisit: 'a4a84615d7f208ae',
  chronologies: 'f1090ad19183aff3',
};
