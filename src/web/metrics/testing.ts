/**
 * Outils des tests de la page Métriques : des réponses de `GET /api/metrics` complètes et cohérentes, un faux serveur
 * qui les sert, et la largeur des graphiques (jsdom ne mesure rien). Aucun test n'invente de forme : ce sont les types
 * du contrat (`src/shared/api.ts`) qui disent ce qu'une réponse contient.
 */
import { configure, getConfig } from '@testing-library/react';
import { afterAll, beforeAll, vi } from 'vitest';
import type {
  MetricsBucket,
  MetricsCfdPoint,
  MetricsCycleTimePoint,
  MetricsDateRange,
  MetricsDurationTile,
  MetricsInProgressTicket,
  MetricsResponse,
  MetricsSlice,
  MetricsTrend,
} from '../../shared/api';
import { httpFailure, stubApi, type HttpFailure } from '../test/render';

export { httpFailure };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Le texte d'un nœud, espaces insécables comprises comme des espaces : « 3,4 j » s'écrit avec une insécable à l'écran. */
export const plain = (text: string | null | undefined): string => (text ?? '').replace(/[\u00a0\u202f]/g, ' ');

const noTrend: MetricsTrend = { previous: null, delta: null, ratio: null };

/** Une tendance comme l'API la calcule : `delta` est le courant moins le précédent, `ratio` est `delta / previous`. */
export function trendOf(current: number | null, previous: number | null): MetricsTrend {
  if (current === null || previous === null) return { previous, delta: null, ratio: null };
  const delta = current - previous;
  return { previous, delta, ratio: previous === 0 ? null : delta / previous };
}

function durationTile(median: number | null, p85: number | null, n: number, before: [number | null, number | null]): MetricsDurationTile {
  return { median, p85, n, trend: { median: trendOf(median, before[0]), p85: trendOf(p85, before[1]) } };
}

/** Les 7 jours du 27 octobre au 2 novembre 2026, mesurés le 2 novembre à 20:00 à Paris : la période court encore. */
const PERIOD: MetricsDateRange = {
  from: '2026-10-27',
  to: '2026-11-02',
  days: 7,
  start: '2026-10-26T23:00:00.000Z',
  end: '2026-11-02T23:00:00.000Z',
};
const PREVIOUS_PERIOD: MetricsDateRange = {
  from: '2026-10-20',
  to: '2026-10-26',
  days: 7,
  start: '2026-10-19T22:00:00.000Z',
  end: '2026-10-26T23:00:00.000Z',
};
export const AS_OF = '2026-11-02T19:00:15.242Z';
const PREVIOUS_AS_OF = '2026-10-26T18:00:15.242Z';

const DAYS = ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'];
const DELIVERIES = [2, 2, 0, 0, 2, 0, 12];
const ARRIVALS = [1, 3, 0, 2, 1, 5, 8];

const buckets: MetricsBucket[] = DAYS.map((day, index) => ({
  from: day,
  to: day,
  days: 1,
  deliveries: DELIVERIES[index] ?? 0,
  arrivals: ARRIVALS[index] ?? 0,
}));

const cfd: MetricsCfdPoint[] = DAYS.map((date, index) => ({
  date,
  backlog: 5,
  ready: 37 - Math.min(index, 4),
  inProgress: 9 + (index > 4 ? 2 : 0),
  blocked: index === 2 ? 1 : 0,
  done: 154 + [0, 2, 4, 4, 6, 6, 16][index]!,
}));

const point = (id: string, type: string, priority: number, project: string, day: string, hours: number): MetricsCycleTimePoint => ({
  id,
  title: `Ticket ${id}`,
  type,
  priority,
  project,
  deliveredAt: `${day}T10:00:00.000Z`,
  cycleTime: Math.round(hours * HOUR),
});

const cycleTimeScatter: MetricsCycleTimePoint[] = [
  point('bdesk-a1', 'bug', 1, 'bdesk', '2026-10-27', 1.5),
  point('mpm-b2', 'task', 2, 'mpm', '2026-10-28', 54.7),
  point('bdesk-c3', 'feature', 2, 'bdesk', '2026-10-31', 12.5),
  point('mpm-d4', 'chore', 3, 'mpm', '2026-11-02', 88.3),
  point('mpm-e5', 'bug', 0, 'mpm', '2026-11-02', 240.7),
];

const inProgress: MetricsInProgressTicket[] = [
  { id: 'mpm-old', title: 'Le plus vieux ticket en cours', type: 'bug', priority: 1, project: 'mpm', status: 'in_progress', blocked: false, startedAt: '2026-04-27T09:02:44.278Z', age: 189 * DAY },
  { id: 'bdesk-mid', title: 'Un ticket bloqué', type: 'task', priority: 2, project: 'bdesk', status: 'blocked', blocked: true, startedAt: '2026-09-29T09:00:00.000Z', age: 34 * DAY },
  { id: 'bdesk-new', title: 'Un ticket récent', type: 'feature', priority: 2, project: 'bdesk', status: 'hooked', blocked: false, startedAt: '2026-11-02T17:00:00.000Z', age: 2 * HOUR },
];

const slice = (key: string, label: string, overrides: Partial<MetricsSlice> = {}): MetricsSlice => ({
  key,
  label,
  throughput: 6,
  arrivals: 7,
  leadTime: { median: 3 * DAY, p85: 9 * DAY, n: 6 },
  cycleTime: { median: DAY, p85: 4 * DAY, n: 5 },
  failedDeliveries: 0,
  failureRate: 0,
  coverage: { bugs: 67, linked: 13, ratio: 13 / 67 },
  significant: false,
  wip: 3,
  ...overrides,
});

/**
 * Une réponse de la Vue globale sur 7 jours : deux Projets, des Livraisons presque tous les jours, un Taux d'échec non
 * significatif (Couverture de 19 %), un temps de rétablissement sans bug critique livré, un ticket de 189 jours en cours.
 * `overrides` remplace des morceaux entiers (`tiles`, `slices`…) ; les tests qui veulent une seule valeur la dérivent.
 */
export function metricsFixture(overrides: Partial<MetricsResponse> = {}): MetricsResponse {
  return {
    generatedAt: AS_OF,
    timeZone: 'Europe/Paris',
    projects: [
      { id: 'bdesk', name: 'beads-desktop' },
      { id: 'mpm', name: 'My-Prompt-Manager' },
    ],
    unreadable: [],
    range: '7d',
    period: PERIOD,
    previousPeriod: PREVIOUS_PERIOD,
    bucket: 'day',
    asOf: AS_OF,
    previousAsOf: PREVIOUS_AS_OF,
    tiles: {
      throughput: { total: 18, trend: trendOf(18, 28) },
      leadTime: durationTile(594_878_465, 1_398_268_193.5, 18, [59_296_172.5, 345_927_383.55]),
      cycleTime: durationTile(177_911_777, 196_921_694.8, 15, [15_146_964, 244_272_997]),
      failureRate: {
        deliveries: 18,
        failed: 0,
        rate: 0,
        coverage: { bugs: 67, linked: 13, ratio: 13 / 67 },
        significant: false,
        reasons: ['low-coverage'],
        reason: 'Couverture insuffisante : 19 % des bugs ont une origine renseignée (minimum 50 %).',
        thresholds: { minCoverage: 0.5, minBugs: 5 },
        trend: trendOf(0, 0),
      },
      recoveryTime: durationTile(null, null, 0, [346_627_583, 586_631_460.4]),
      wip: { current: 11, average: 10.582381585941508, trend: trendOf(10.582381585941508, 10.567218972642985) },
      arrivals: { total: 20, trend: trendOf(20, 32) },
    },
    buckets,
    cycleTimeScatter,
    cfd,
    inProgress,
    slices: {
      type: [
        slice('bug', 'bug', { throughput: 10, wip: 5 }),
        slice('task', 'task', { throughput: 3, wip: 3 }),
        slice('feature', 'feature', { throughput: 1, wip: 3 }),
      ],
      priority: [slice('1', 'P1', { throughput: 1 }), slice('2', 'P2', { throughput: 4 }), slice('3', 'P3', { throughput: 10 })],
      project: [
        slice('bdesk', 'beads-desktop', { throughput: 2, wip: 2, coverage: { bugs: 1, linked: 0, ratio: 0 } }),
        slice('mpm', 'My-Prompt-Manager', { throughput: 16, wip: 3, coverage: { bugs: 36, linked: 13, ratio: 13 / 36 } }),
      ],
    },
    ...overrides,
  };
}

/** Un Projet sans Livraison sur la période : toutes les durées sont indéfinies, le CFD ne bouge pas, rien n'est en cours. */
export function emptyMetricsFixture(overrides: Partial<MetricsResponse> = {}): MetricsResponse {
  const base = metricsFixture();
  return metricsFixture({
    projects: [{ id: 'bdesk', name: 'beads-desktop' }],
    tiles: {
      throughput: { total: 0, trend: trendOf(0, 0) },
      leadTime: durationTile(null, null, 0, [null, null]),
      cycleTime: durationTile(null, null, 0, [null, null]),
      failureRate: { ...base.tiles.failureRate, deliveries: 0, failed: 0, rate: null, coverage: { bugs: 0, linked: 0, ratio: null }, reasons: ['few-bugs'], reason: 'Trop peu de bugs pour conclure : 0 (minimum 5).', trend: noTrend },
      recoveryTime: durationTile(null, null, 0, [null, null]),
      wip: { current: 0, average: 0, trend: trendOf(0, 0) },
      arrivals: { total: 0, trend: trendOf(0, 0) },
    },
    buckets: buckets.map((bucket) => ({ ...bucket, deliveries: 0, arrivals: 0 })),
    cycleTimeScatter: [],
    cfd: cfd.map((row) => ({ ...row, backlog: 0, ready: 0, inProgress: 0, blocked: 0, done: 0 })),
    inProgress: [],
    slices: { type: [], priority: [], project: [slice('bdesk', 'beads-desktop', { throughput: 0, arrivals: 0, wip: 0, failureRate: null, leadTime: { median: null, p85: null, n: 0 }, cycleTime: { median: null, p85: null, n: 0 }, coverage: { bugs: 0, linked: 0, ratio: null } })] },
    ...overrides,
  });
}

/** Les 90 jours du 5 août au 2 novembre 2026 : des tranches hebdomadaires, la première tronquée à 5 jours, la dernière à 1 jour. */
export function weeklyMetricsFixture(): MetricsResponse {
  const weeks: MetricsBucket[] = [
    { from: '2026-08-05', to: '2026-08-09', days: 5, deliveries: 0, arrivals: 1 },
    { from: '2026-08-10', to: '2026-08-16', days: 7, deliveries: 0, arrivals: 0 },
    { from: '2026-08-17', to: '2026-08-23', days: 7, deliveries: 3, arrivals: 4 },
    { from: '2026-10-26', to: '2026-11-01', days: 7, deliveries: 11, arrivals: 10 },
    { from: '2026-11-02', to: '2026-11-02', days: 1, deliveries: 12, arrivals: 8 },
  ];
  return metricsFixture({
    range: '90d',
    bucket: 'week',
    period: { from: '2026-08-05', to: '2026-11-02', days: 90, start: '2026-08-04T22:00:00.000Z', end: '2026-11-02T23:00:00.000Z' },
    previousPeriod: { from: '2026-05-07', to: '2026-08-04', days: 90, start: '2026-05-06T22:00:00.000Z', end: '2026-08-04T22:00:00.000Z' },
    previousAsOf: '2026-08-04T22:00:00.000Z',
    buckets: weeks,
  });
}

/** Réponse scriptée du faux serveur : les données, une erreur (500) ou une réponse d'erreur précise. */
export type MetricsReply = MetricsResponse | Error | HttpFailure;

const isFailure = (value: unknown): value is HttpFailure =>
  typeof value === 'object' && value !== null && 'status' in value && 'body' in value;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * `stubApi` (Projets, tickets) qui sert aussi `GET /api/metrics`. `reply` reçoit l'adresse demandée et renvoie la
 * réponse : les paramètres (`project`, `range`, `from`, `to`) sont ceux que la page a envoyés. Une promesse suspendue
 * (`new Promise(() => undefined)`) fait attendre la page.
 */
export function stubMetricsApi(
  fixture: Parameters<typeof stubApi>[0],
  reply: (url: URL) => MetricsReply | Promise<MetricsReply>,
) {
  const fetchMock = stubApi(fixture);
  const projectsApi = fetchMock.getMockImplementation();
  if (!projectsApi) throw new Error('stubApi devait installer un faux fetch.');
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname !== '/api/metrics') return projectsApi(input);
    const answer = await reply(url);
    if (answer instanceof Error) return json({ message: answer.message }, 500);
    if (isFailure(answer)) return json(answer.body, answer.status);
    return json(answer);
  });
  return fetchMock;
}

/**
 * À appeler au premier niveau d'un fichier de tests qui monte la page Métriques ou la Vue globale. La vue des métriques est un
 * morceau chargé à la demande (`LazyMetricsView`) : dans un test, son premier affichage lit et évalue tout son module (visx, d3,
 * les graphiques), puis dessine les graphiques. On lit le module une fois, hors du délai d'un test ; et le premier affichage
 * d'un fichier, sous la charge de toute la suite en parallèle, dépasse la seconde que les `findBy…` accordent par défaut : le
 * délai est de 5 s pour ces fichiers, et rendu ensuite (il ne change rien aux tests qui réussissent).
 */
export function warmUpMetricsPages(): void {
  let previous = getConfig().asyncUtilTimeout;
  beforeAll(async () => {
    previous = getConfig().asyncUtilTimeout;
    configure({ asyncUtilTimeout: 5000 });
    await import('./MetricsView');
  });
  afterAll(() => configure({ asyncUtilTimeout: previous }));
}

/** Les adresses de `/api/metrics` demandées jusqu'ici, dans l'ordre. */
export function metricsRequests(fetchMock: ReturnType<typeof stubApi>): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input)).filter((url) => url.startsWith('/api/metrics'));
}

/**
 * jsdom ne mesure aucun élément : les cadres des graphiques (`data-chart-frame`) reçoivent la largeur demandée, les
 * autres éléments gardent zéro. À appeler dans un `beforeEach` ; `vi.restoreAllMocks()` la retire.
 */
export function stubChartWidth(width = 640): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const measured = this.hasAttribute('data-chart-frame') ? width : 0;
    return { x: 0, y: 0, top: 0, left: 0, right: measured, bottom: 0, width: measured, height: 0, toJSON: () => ({}) } as DOMRect;
  });
}
