/**
 * Outils des tests de la page Métriques : des réponses de `GET /api/metrics` complètes et cohérentes, un faux serveur
 * qui les sert, et la largeur des graphiques (jsdom ne mesure rien). Aucun test n'invente de forme : ce sont les types
 * du contrat (`src/shared/api.ts`) qui disent ce qu'une réponse contient.
 */
import { beforeAll, vi } from 'vitest';
import type {
  MetricsLongTrend,
  MetricsLongTrendWeek,
  MetricsBucket,
  MetricsCfdPoint,
  MetricsCycleTimePoint,
  MetricsDateRange,
  MetricsDurationTile,
  MetricsHealth,
  MetricsInProgressTicket,
  MetricsProject,
  MetricsReadyTicket,
  MetricsResponse,
  MetricsSlice,
  MetricsTrend,
} from '../../shared/api';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { addDays } from './scales';
import { httpFailure, stubApi, type HttpFailure } from '../test/render';

export { httpFailure };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Le texte d'un nœud, espaces insécables comprises comme des espaces : « 3,4 j » s'écrit avec une insécable à l'écran. */
export const plain = (text: string | null | undefined): string => (text ?? '').replace(/[\u00a0\u202f]/g, ' ');

/** Le texte d'un nœud sans les sous-arbres que `skip` écarte. Les blocs se suivent sans séparateur, comme avec `textContent`. */
function textWithout(node: Node, skip: (element: Element) => boolean): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE || skip(node as Element)) return '';
  return Array.from(node.childNodes, (child) => textWithout(child, skip)).join('');
}

/** Le texte que l'œil lit : tout sauf ce qui n'est écrit que pour les lecteurs d'écran (`sr-only`). */
export const shownText = (node: Node): string => textWithout(node, (element) => element.classList.contains('sr-only'));

/** Le texte que l'oreille entend : tout sauf ce que les lecteurs d'écran ignorent (`aria-hidden="true"`). */
export const spokenText = (node: Node): string => textWithout(node, (element) => element.getAttribute('aria-hidden') === 'true');

/**
 * Les noms (`aria-label`) et descriptions (`title`) que les lecteurs d'écran annoncent dans une partie de la page : ceux des
 * éléments que `aria-hidden="true"` ne cache pas, lui ni aucun de ses ancêtres. L'intérieur d'un dessin nommé (`<svg role="img">`)
 * compte : les enfants d'une image sont présentationnels pour la norme, mais Chromium expose le texte d'un SVG dans son arbre
 * d'accessibilité (`Accessibility.getFullAXTree`), et un chevron y serait lu. Seul `aria-hidden` le cache pour de bon.
 */
export function spokenNames(root: Element): string[] {
  if (root.getAttribute('aria-hidden') === 'true') return [];
  const own = [root.getAttribute('aria-label'), root.getAttribute('title')].filter((name): name is string => name !== null);
  return [...own, ...Array.from(root.children, spokenNames).flat()];
}

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

const ready = (id: string, type: string, priority: number, project: string, since: string, age: number): MetricsReadyTicket => ({
  id,
  title: `Prêt ${id}`,
  type,
  priority,
  project,
  since,
  age,
  stagnant: age > 14 * DAY,
});

/** Les Prêts à `AS_OF`, du plus ancien au plus récent : trois stagnent (plus de 14 jours). */
const readyTickets: MetricsReadyTicket[] = [
  ready('mpm-r1', 'chore', 3, 'mpm', '2026-09-23T09:00:00.000Z', 40 * DAY + 10 * HOUR),
  ready('mpm-r2', 'bug', 1, 'mpm', '2026-10-16T09:00:00.000Z', 17 * DAY + 10 * HOUR),
  ready('bdesk-r3', 'feature', 2, 'bdesk', '2026-10-18T09:00:00.000Z', 15 * DAY + 10 * HOUR),
  ready('mpm-r4', 'task', 2, 'mpm', '2026-10-30T09:00:00.000Z', 3 * DAY + 10 * HOUR),
  ready('bdesk-r5', 'task', 2, 'bdesk', '2026-11-02T14:00:00.000Z', 5 * HOUR),
];

/** 7 jours de 24 heures : mardi à jeudi aux heures de bureau, un peu le lundi et le vendredi, le week-end à peine. */
function activityCells(): number[][] {
  const cells = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const fill = (day: number, hours: number[], count: number) => hours.forEach((hour) => (cells[day]![hour] = count));
  fill(0, [9, 10, 14, 15], 2); // lundi
  fill(1, [9, 10, 11, 14, 15, 16], 5); // mardi
  fill(2, [9, 10, 11, 14, 15, 16], 4); // mercredi
  fill(3, [9, 10, 11, 14, 15], 6); // jeudi
  fill(3, [20], 1);
  fill(4, [9, 10, 14], 2); // vendredi
  fill(5, [11], 1); // samedi
  return cells;
}

const sumOf = (cells: number[][]) => cells.flat().reduce((total, count) => total + count, 0);

/**
 * La santé du flux de la Vue globale sur 7 jours : 15 Livraisons démarrées (31 j de Cycle Time dont 2,5 j de Blocage), 21
 * clôtures dont 2 suivies d'une Réouverture (deux tickets en Retravail), 20 tickets fermés dont 2 Abandons, 6 Livraisons qui ont attendu une
 * dépendance, 5 Prêts dont 3 stagnent, 100 Transitions.
 */
export function healthFixture(overrides: Partial<MetricsHealth> = {}): MetricsHealth {
  const cells = activityCells();
  const ratio = (31 * DAY - 2.5 * DAY) / (31 * DAY);
  return {
    efficiency: { n: 15, cycleTime: 31 * DAY, blockedTime: 2.5 * DAY, ratio, blockedDeliveries: 3, trend: trendOf(ratio, 0.97) },
    reopening: { closures: 21, reopened: 2, rate: 2 / 21, trend: trendOf(2 / 21, 0.04) },
    rework: {
      tickets: [
        { id: 'bdesk-r1', title: 'Palette ⌘K', type: 'feature', priority: 1, project: 'bdesk', reopenings: 2, returns: 0, originBugs: ['bdesk-b9'], lastAt: '2026-10-22T14:00:00.000Z' },
        { id: 'mpm-r2', title: 'Import des prompts', type: 'task', priority: 2, project: 'mpm', reopenings: 0, returns: 1, originBugs: [], lastAt: '2026-10-21T09:00:00.000Z' },
      ],
    },
    abandonment: { closed: 20, abandoned: 2, duplicates: 1, superseded: 1, rate: 0.1, trend: trendOf(0.1, 0.05) },
    leadTimeBreakdown: {
      deliveries: 18,
      total: 120 * DAY,
      dependencyWait: 21 * DAY,
      readyWait: 52 * DAY,
      work: 28.5 * DAY,
      blocked: 2.5 * DAY,
      otherWait: 16 * DAY,
      waited: 6,
      waits: { median: 2.1 * DAY, p85: 6 * DAY, n: 6 },
    },
    readyAges: { stagnantAfter: 14 * DAY, tickets: readyTickets, stagnant: 3, trend: trendOf(3, 2) },
    activity: { cells, total: sumOf(cells) },
    ...overrides,
  };
}

/** La santé d'un Projet sans Livraison, sans clôture, sans Prêt ni Transition : tout est indéfini ou à zéro. */
export function emptyHealthFixture(overrides: Partial<MetricsHealth> = {}): MetricsHealth {
  return {
    efficiency: { n: 0, cycleTime: 0, blockedTime: 0, ratio: null, blockedDeliveries: 0, trend: noTrend },
    reopening: { closures: 0, reopened: 0, rate: null, trend: noTrend },
    rework: { tickets: [] },
    abandonment: { closed: 0, abandoned: 0, duplicates: 0, superseded: 0, rate: null, trend: noTrend },
    leadTimeBreakdown: { deliveries: 0, total: 0, dependencyWait: 0, readyWait: 0, work: 0, blocked: 0, otherWait: 0, waited: 0, waits: { median: null, p85: null, n: 0 } },
    readyAges: { stagnantAfter: 14 * DAY, tickets: [], stagnant: 0, trend: trendOf(0, 0) },
    activity: { cells: Array.from({ length: 7 }, () => new Array<number>(24).fill(0)), total: 0 },
    ...overrides,
  };
}

/** Minuit à Paris de ce jour : 22:00Z la veille en heure d'été, 23:00Z en heure d'hiver (depuis le 25 octobre 2026). */
const parisMidnight = (day: string) => `${addDays(day, -1)}T${day > '2026-10-25' ? '23' : '22'}:00:00.000Z`;

/**
 * La Tendance longue des fixtures : les 12 semaines qui finissent par celle du 2 novembre 2026 (en cours, à `AS_OF`). `deliveries[i]` est le Débit de la
 * semaine i ; son Lead Time au P85 vaut i + 1 jours, fiable à partir de 4 Livraisons ; ses clôtures sont ses Livraisons, et une sur quatre est rouverte.
 */
export function longTrendFixture(deliveries: readonly number[] = [5, 6, 4, 0, 3, 7, 5, 8, 6, 4, 5, 1]): MetricsLongTrend {
  const weeks = deliveries.map((throughput, index): MetricsLongTrendWeek => {
    const from = addDays('2026-08-17', 7 * index);
    const reopened = Math.floor(throughput / 4);
    return {
      from,
      to: addDays(from, 6),
      start: parisMidnight(from),
      end: parisMidnight(addDays(from, 7)),
      partial: index === deliveries.length - 1,
      throughput,
      leadTimeP85: throughput === 0 ? null : (index + 1) * DAY,
      reliable: throughput >= 4,
      closures: throughput,
      reopened,
      reopeningRate: throughput === 0 ? null : reopened / throughput,
    };
  });
  return { weeks, minDeliveries: 4 };
}

/**
 * La réponse d'une Vue globale dont les Projets mesurés sont `projects` (bdesk-38k.65, revue). Le serveur la compose ainsi (`slicesOf`, `domain/metrics.ts`) : le découpage par Projet a une ligne par
 * Projet mesuré, et son libellé est le nom du Projet, écrit une deuxième fois à côté de `projects`. Les chiffres sont ceux de la première ligne de `metricsFixture`, pour chacune : seuls les noms
 * et les identifiants comptent ici. `overrides` remplace des morceaux entiers, comme pour `metricsFixture`.
 */
export function metricsOf(projects: MetricsProject[], overrides: Partial<MetricsResponse> = {}): MetricsResponse {
  const base = metricsFixture();
  const model = base.slices.project[0];
  if (!model) throw new Error('metricsFixture devait avoir un découpage par Projet.');
  return metricsFixture({
    projects,
    slices: { ...base.slices, project: projects.map(({ id, name }) => ({ ...model, key: id, label: name })) },
    ...overrides,
  });
}

/**
 * Une réponse de la Vue globale sur 7 jours : deux Projets, des Livraisons presque tous les jours, un Taux d'échec non
 * significatif (Couverture de 19 %), un temps de rétablissement sans bug critique livré, un ticket de 189 jours en cours.
 * `overrides` remplace des morceaux entiers (`tiles`, `slices`…) ; les tests qui veulent une seule valeur la dérivent.
 */
export function metricsFixture(overrides: Partial<MetricsResponse> = {}): MetricsResponse {
  return {
    generatedAt: AS_OF,
    timeZone: 'Europe/Paris',
    // Honoré par défaut : le serveur a compté dans le fuseau que la page lui demandait, quel qu'il soit. Un test qui veut un serveur qui ne le connaît pas dit `timeZoneHonoured: false`.
    timeZoneHonoured: true,
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
    health: healthFixture(),
    longTrend: longTrendFixture(),
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
    health: emptyHealthFixture(),
    longTrend: longTrendFixture(new Array<number>(12).fill(0)),
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
 * délai est de 5 s pour ces fichiers, et rendu ensuite (`withAsyncTimeout` ; il ne change rien aux tests qui réussissent).
 */
export function warmUpMetricsPages(): void {
  withAsyncTimeout(5000);
  beforeAll(async () => {
    await import('./MetricsView');
  });
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
