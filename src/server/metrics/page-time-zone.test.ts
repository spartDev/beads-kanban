import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from '../../domain/calendar';
import type { StatusSnapshot, TicketHistory } from '../../domain/flow';
import type { ApiErrorBody, Issue, MetricsResponse, Project } from '../../shared/api';
import { browserTimeZone } from '../../web/lib/instant';
import { dayInZone } from '../../web/metrics/format';
import { checkRange, metricsPath, type PeriodChoice } from '../../web/metrics/params';
import type { ProjectService } from '../projects/service';
import { buildServer } from '../server';
import { createMetricsService } from './service';

/**
 * bdesk-38k.48 : ce que la page Métriques demande et ce que le serveur sert sont d'accord sur le jour d'aujourd'hui. La page est jouée avec
 * ses propres fonctions (le fuseau de son navigateur, `dayInZone`, `checkRange`, `metricsPath`), dans un navigateur dont `TZ` est posé ; le
 * serveur est le vrai (`buildServer` et `inject`), lancé en UTC : celui qui, avant, ne connaissait pas le fuseau du navigateur. Chaque cas est
 * un fuseau et un instant autour de minuit, là où le jour de la page et celui d'UTC diffèrent.
 */

const project: Project = { id: 'p', name: 'P', path: '/p', prefix: 'p', mode: 'embedded', status: 'ok' };
const issue: Issue = {
  id: 'p-1',
  title: 'Titre de p-1',
  type: 'task',
  status: 'closed',
  priority: 2,
  assignee: null,
  parentId: null,
  createdAt: '2026-03-01T08:00:00.000Z',
  updatedAt: '2026-03-02T08:00:00.000Z',
  closedAt: '2026-03-02T08:00:00.000Z',
  blockedBy: [],
};
const statuses: StatusSnapshot[] = [
  { status: 'open', at: new Date('2026-03-01T08:00:00Z') },
  { status: 'closed', at: new Date('2026-03-02T08:00:00Z') },
];
const history: TicketHistory = { id: 'p-1', type: 'task', statusSnapshots: statuses, dependencies: [] };
const projects: ProjectService = {
  list: async () => ({ projects: [project], ignored: [] }),
  head: async () => 'h1',
  issues: async () => [issue],
  histories: async () => [history],
  issue: async () => {
    throw new Error('inutile ici');
  },
};

// Les noms que le moteur rend pour son fuseau (`Asia/Calcutta`, et non l'alias `Asia/Kolkata`) : un nom que `Intl` accepte aussi, et le serveur le lui renvoie.
const ZONES = ['Europe/Paris', 'Asia/Tokyo', 'Pacific/Honolulu', 'Pacific/Kiritimati', 'America/St_Johns', 'Asia/Calcutta', 'Pacific/Apia', 'UTC'];
const INSTANTS = [
  '2026-11-04T23:30:00Z', // 00:30 le 5 à Paris, 08:30 le 5 à Tokyo, 13:30 le 4 à Honolulu
  '2026-11-05T00:30:00Z',
  '2026-11-05T12:00:00Z',
  '2026-03-28T23:30:00Z', // la nuit du passage à l'heure d'été à Paris
  '2026-10-24T23:30:00Z', // la nuit qui précède le retour à l'heure d'hiver à Paris
];

describe('la page et le serveur (en UTC) comptent « aujourd’hui » dans le même fuseau : celui du navigateur', () => {
  let now = new Date(INSTANTS[0] as string);
  const app = buildServer({
    config: { roots: [], projects: [], hiddenProjects: [] },
    projects,
    metrics: createMetricsService(projects, { now: () => now, timeZone: 'UTC' }),
  });

  afterAll(() => app.close());
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  /** Le navigateur de l'utilisateur : son fuseau, l'heure qu'il est, et ce qu'il en tire (aujourd'hui, le fuseau qu'il donne au serveur). */
  function browserAt(instant: string, zone: string) {
    now = new Date(instant);
    vi.stubEnv('TZ', zone);
    vi.setSystemTime(now);
    const timeZone = browserTimeZone();
    return { timeZone, today: dayInZone(new Date().toISOString(), timeZone) };
  }

  const ask = (period: PeriodChoice, timeZone: string) => app.inject({ method: 'GET', url: metricsPath({ period, timeZone }) });
  const cases = ZONES.flatMap((zone) => INSTANTS.map((instant): [string, string] => [zone, instant]));

  it.each(cases)('%s à %s : « 7 jours » finit aujourd’hui, le jour de la page', async (zone, instant) => {
    const { timeZone, today } = browserAt(instant, zone);

    const res = await ask({ kind: 'preset', range: '7d' }, timeZone);

    expect(timeZone).toBe(zone);
    expect(res.statusCode).toBe(200);
    // Le serveur compte dans le fuseau que la page lui donne, sous le même nom, et dit qu'il l'a honoré (bdesk-38k.71) : l'avis de la page se lit là.
    expect(res.json<MetricsResponse>()).toMatchObject({ timeZone: zone, timeZoneHonoured: true, period: { to: today, from: addDays(today, -6) } });
  });

  it.each(cases)('%s à %s : la plage qui finit aujourd’hui, que la page accepte, est acceptée ; celle qui finit demain, qu’elle refuse, est refusée', async (zone, instant) => {
    const { timeZone, today } = browserAt(instant, zone);
    const endsToday = checkRange(addDays(today, -13), today, today);
    const endsTomorrow = checkRange(addDays(today, -12), addDays(today, 1), today);
    if (typeof endsToday === 'string') throw new Error(`la page refuse une plage qui finit aujourd’hui : ${endsToday}`);
    expect(typeof endsTomorrow, 'la page refuse la plage qui finit demain').toBe('string');

    const accepted = await ask(endsToday, timeZone);
    const refused = await app.inject({ method: 'GET', url: metricsPath({ period: { kind: 'custom', from: addDays(today, -12), to: addDays(today, 1) }, timeZone }) });

    expect(accepted.statusCode).toBe(200);
    expect(accepted.json<MetricsResponse>().period).toMatchObject({ from: addDays(today, -13), to: today });
    expect(refused.statusCode).toBe(400);
    expect(refused.json<ApiErrorBody>().message).toContain('dans le futur');
  });

  it('à 00:30 à Paris, la plage de la page est refusée (400) quand le serveur ne reçoit pas le fuseau du navigateur : la panne de départ', async () => {
    const { today } = browserAt('2026-11-04T23:30:00Z', 'Europe/Paris');
    const endsToday = checkRange('2026-10-30', today, today);
    expect(endsToday).toEqual({ kind: 'custom', from: '2026-10-30', to: '2026-11-05' }); // la page l'accepte

    const withoutZone = await app.inject({ method: 'GET', url: '/api/metrics?from=2026-10-30&to=2026-11-05' }); // ce que la page envoyait

    expect(withoutZone.statusCode).toBe(400);
    expect(withoutZone.json<ApiErrorBody>().message).toContain('dans le futur');
  });

  it('un navigateur sans fuseau reconnu (TZ vide) donne UTC au serveur, qui compte comme lui', async () => {
    const { timeZone, today } = browserAt('2026-11-04T23:30:00Z', '');

    const res = await ask({ kind: 'preset', range: '7d' }, timeZone);

    expect(timeZone).toBe('UTC');
    expect(res.statusCode).toBe(200);
    expect(res.json<MetricsResponse>()).toMatchObject({ timeZone: 'UTC', period: { to: today } });
    expect(today).toBe('2026-11-04');
  });
});
