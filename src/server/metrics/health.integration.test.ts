import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { MetricsResponse } from '../../shared/api';
import { createDoltClient } from '../dolt/client';
import { createProjectService } from '../projects/service';
import { buildServer } from '../server';
import { createDatabase, hasBinary, isolatedDoltEnv } from '../testing/dolt-fixture';
import { createMetricsService } from './service';

/**
 * La santé du flux sur une vraie base Dolt, de bout en bout : l'historique écrit commit par commit, lu par le lecteur Dolt,
 * analysé, puis servi par `GET /api/metrics`. Les attendus sont calculés à la main d'après le scénario ci-dessous.
 */

const DAY = 86_400_000;
/** Lundi 12 octobre 2026, 12:00 UTC : les commits des bases d'essai vont du 1er au 10 octobre, à 10:00 UTC. */
const NOW = new Date('2026-10-12T12:00:00Z');
const PERIOD = '?from=2026-10-01&to=2026-10-12&project=gamma';

const SCHEMA = `
  create table issues (
    id varchar(255) primary key, title varchar(500) not null, description text not null, design text not null,
    acceptance_criteria text not null, notes text not null, status varchar(32) not null default 'open',
    priority int not null default 2, issue_type varchar(32) not null default 'task', assignee varchar(255),
    created_at datetime not null, updated_at datetime not null, closed_at datetime, close_reason text not null);
  create table dependencies (
    id char(36) primary key, issue_id varchar(255) not null, depends_on_issue_id varchar(255) not null,
    type varchar(32) not null default 'blocks', created_at datetime not null, created_by varchar(255) not null);
  create table labels (issue_id varchar(255) not null, label varchar(255) not null, primary key (issue_id, label));
  create table comments (id char(36) primary key, issue_id varchar(255) not null, author varchar(255) not null,
    text text not null, created_at datetime not null);
  create table config (\`key\` varchar(255) primary key, value text not null);`;

const stamp = (day: number) => `2026-10-${String(day).padStart(2, '0')} 10:00:00`;

const create = (id: string, type: string, day: number) =>
  `insert into issues (id, title, description, design, acceptance_criteria, notes, issue_type, priority, created_at, updated_at, close_reason)
   values ('${id}', 'Titre ${id}', '', '', '', '', '${type}', 2, '${stamp(day)}', '${stamp(day)}', '')`;

const move = (id: string, status: string, day: number) =>
  `update issues set status = '${status}', updated_at = '${stamp(day)}', closed_at = ${status === 'closed' ? `'${stamp(day)}'` : 'null'} where id = '${id}'`;

const link = (id: string, target: string, type: string, day: number) =>
  `insert into dependencies (id, issue_id, depends_on_issue_id, type, created_at, created_by) values (uuid(), '${id}', '${target}', '${type}', '${stamp(day)}', 'tom')`;

/**
 * Projet « gamma », un commit par jour à 10:00 UTC (le 1er octobre 2026 est un jeudi) :
 *
 *   j1  g-1, g-2 (tâches) et g-3 (bug) créés
 *   j2  g-1 en cours ; g-2 dépend de g-1 (Backlog : Attente de dépendance, 1 j avant son démarrage)
 *   j3  g-2 en cours, alors que g-1 n'est pas fermé : du travail en Blocage
 *   j4  g-1 fermé (Lead Time 3 j, Cycle Time 2 j) : g-2 n'est plus bloqué
 *   j5  g-2 fermé (Lead Time 4 j ; Cycle Time 2 j dont 1 j de Blocage ; Attente de dépendance 1 j)
 *   j6  g-3 en cours ; g-4 et g-5 (tâches) créés
 *   j7  g-3 fermé
 *   j8  g-3 rouvert ; g-4 fermé (Lead Time 2 j, jamais démarré) ; g-5 fermé, doublon de g-4 (Abandon) ; g-6 (feature) créé, Prêt
 *   j9  g-3 en cours
 *   j10 g-3 fermé (Lead Time 9 j, Cycle Time 2 j : deux passages d'un jour)
 */
const GAMMA: [day: number, statements: string[]][] = [
  [1, [create('g-1', 'task', 1), create('g-2', 'task', 1), create('g-3', 'bug', 1)]],
  [2, [move('g-1', 'in_progress', 2), link('g-2', 'g-1', 'blocks', 2)]],
  [3, [move('g-2', 'in_progress', 3)]],
  [4, [move('g-1', 'closed', 4)]],
  [5, [move('g-2', 'closed', 5)]],
  [6, [move('g-3', 'in_progress', 6), create('g-4', 'task', 6), create('g-5', 'task', 6)]],
  [7, [move('g-3', 'closed', 7)]],
  [8, [move('g-3', 'open', 8), move('g-4', 'closed', 8), move('g-5', 'closed', 8), link('g-5', 'g-4', 'duplicates', 8), create('g-6', 'feature', 8)]],
  [9, [move('g-3', 'in_progress', 9)]],
  [10, [move('g-3', 'closed', 10)]],
];

describe.skipIf(!hasBinary('dolt'))('santé du flux sur une vraie base Dolt', () => {
  let get: (query: string) => Promise<{ status: number; body: MetricsResponse }>;
  /** Les services de Paris et d'UTC, dont l'horloge se règle : le Projet « delta » (changement d'heure) y est lu à l'instant voulu. */
  let getAt: (timeZone: 'Europe/Paris' | 'UTC', now: string, query: string) => Promise<{ status: number; body: MetricsResponse }>;

  beforeAll(() => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'bdesk-health-')));
    const beads = join(root, 'gamma', '.beads');
    mkdirSync(beads, { recursive: true });
    writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: 'tdb' }));
    const base = createDatabase(isolatedDoltEnv(), join(beads, 'embeddeddolt', 'tdb'));
    base.sql(`${SCHEMA} insert into config values ('issue_prefix', 'g');`);
    for (const [day, statements] of GAMMA) {
      base.sql(statements.join(';\n'));
      base.commit(day, `jour ${day}`);
    }

    // Projet « delta » : un seul ticket, créé (donc Prêt) le mardi 20 octobre à 12:00 à Paris (10:00Z, heure d'été), avant le passage à l'heure d'hiver du 25.
    const deltaBeads = join(root, 'delta', '.beads');
    mkdirSync(deltaBeads, { recursive: true });
    writeFileSync(join(deltaBeads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: 'tdb' }));
    const delta = createDatabase(isolatedDoltEnv(), join(deltaBeads, 'embeddeddolt', 'tdb'));
    delta.sql(`${SCHEMA} insert into config values ('issue_prefix', 'd');`);
    delta.sql(create('d-1', 'task', 20));
    delta.commit(20, 'jour 20');

    const config = { roots: [root], projects: [], hiddenProjects: [] };
    const projects = createProjectService(config, { dolt: createDoltClient() });
    const metrics = createMetricsService(projects, { now: () => NOW, timeZone: 'UTC' });
    const app = buildServer({ config, projects, metrics });
    get = async (query) => {
      const res = await app.inject({ method: 'GET', url: `/api/metrics${query}` });
      return { status: res.statusCode, body: res.json() };
    };

    let clock = NOW;
    const zones = {
      'Europe/Paris': buildServer({ config, projects, metrics: createMetricsService(projects, { now: () => clock, timeZone: 'Europe/Paris' }) }),
      UTC: buildServer({ config, projects, metrics: createMetricsService(projects, { now: () => clock, timeZone: 'UTC' }) }),
    };
    getAt = async (timeZone, now, query) => {
      clock = new Date(now);
      const res = await zones[timeZone].inject({ method: 'GET', url: `/api/metrics${query}` });
      return { status: res.statusCode, body: res.json() };
    };
  }, 120_000);

  it('Efficacité du flux : 6 j de Cycle Time dont 1 j de Blocage, celui de g-2, démarré avant la fin de son bloqueur', async () => {
    const { status, body } = await get(PERIOD);

    expect(status).toBe(200);
    // g-1 2 j, g-2 2 j, g-3 2 j (deux passages) ; g-4 n'a jamais été démarré, g-5 est un Abandon.
    expect(body.health.efficiency).toMatchObject({ n: 3, cycleTime: 6 * DAY, blockedTime: 1 * DAY, blockedDeliveries: 1 });
    expect(body.health.efficiency.ratio).toBe(5 / 6);
  });

  it('Taux de Réouverture : six clôtures, dont celle de g-3 le j7, suivie d’une Réouverture le j8', async () => {
    const { body } = await get(PERIOD);

    // g-1 (j4), g-2 (j5), g-3 (j7 et j10), g-4 et g-5 (j8).
    expect(body.health.reopening).toMatchObject({ closures: 6, reopened: 1, rate: 1 / 6 });
  });

  it('Taux d’abandon : g-5, doublon de g-4, parmi cinq tickets fermés', async () => {
    const { body } = await get(PERIOD);

    // Fermés : g-1, g-2, g-3, g-4 (Livraisons) et g-5 (Abandon par `bd duplicate`).
    expect(body.health.abandonment).toMatchObject({ closed: 5, abandoned: 1, duplicates: 1, superseded: 0, rate: 0.2 });
    expect(body.tiles.throughput.total).toBe(4);
  });

  it('Décomposition du Lead Time : 18 j cumulés, dont 1 j d’Attente de dépendance (celle de g-2), 10 j d’Attente en Prêt et 1 j de Blocage', async () => {
    const { body } = await get(PERIOD);

    // Lead Times : g-1 3 j, g-2 4 j, g-3 9 j, g-4 2 j. Attente de dépendance : g-2, de j2 à j3 (1 j). Travail hors Blocage : 2 + 1 + 2 = 5 j.
    // Prêt : g-1 de j1 à j2 (1 j), g-2 de j1 à j2 (1 j), g-3 de j1 à j6 puis de j8 à j9 (6 j), g-4 de j6 à j8 (2 j) : 10 j.
    // Autre attente : g-3 fermé de j7 à j8, avant sa Réouverture (1 j).
    expect(body.health.leadTimeBreakdown).toMatchObject({
      deliveries: 4,
      total: 18 * DAY,
      dependencyWait: 1 * DAY,
      readyWait: 10 * DAY,
      work: 5 * DAY,
      blocked: 1 * DAY,
      otherWait: 1 * DAY,
      waited: 1,
      waits: { median: 1 * DAY, p85: 1 * DAY, n: 1 },
    });
    expect(body.tiles.leadTime).toMatchObject({ n: 4 }); // les mêmes Livraisons que la tuile
  });

  it('âge des Prêts : g-6, créé le j8, est le seul Prêt, depuis 4 j 2 h, et ne stagne pas', async () => {
    const { body } = await get(PERIOD);

    expect(body.health.readyAges).toMatchObject({ stagnantAfter: 14 * DAY, stagnant: 0 });
    expect(body.health.readyAges.tickets).toEqual([
      { id: 'g-6', title: 'Titre g-6', type: 'feature', priority: 2, project: 'gamma', since: '2026-10-08T10:00:00.000Z', age: 4 * DAY + 2 * 3_600_000, stagnant: false },
    ]);
  });

  describe('âge des Prêts au changement d’heure : 14 jours calendaires à Paris, pas 14 jours de 24 h', () => {
    const SINCE = '2026-10-20T10:00:00.000Z';

    it('un Prêt de 14 jours calendaires pile, de mardi 12:00 à mardi 12:00 à cheval sur le passage à l’heure d’hiver du 25 octobre, ne stagne pas', async () => {
      // 12:00 CEST (10:00Z) le 20 octobre ; 12:00 CET (11:00Z) le 3 novembre : 14 j 1 h sur l'horloge réelle.
      const { status, body } = await getAt('Europe/Paris', '2026-11-03T11:00:00Z', '?project=delta&range=7d');

      expect(status).toBe(200);
      expect(body.timeZone).toBe('Europe/Paris');
      expect(body.health.readyAges.stagnantAfter).toBe(14 * DAY);
      expect(body.health.readyAges.tickets).toEqual([{ id: 'd-1', title: 'Titre d-1', type: 'task', priority: 2, project: 'delta', since: SINCE, age: 14 * DAY, stagnant: false }]);
      expect(body.health.readyAges.stagnant).toBe(0);
    });

    it('stagne dès la minute suivante : 14 jours calendaires et une minute', async () => {
      const { body } = await getAt('Europe/Paris', '2026-11-03T11:01:00Z', '?project=delta&range=7d');

      expect(body.health.readyAges.tickets).toEqual([expect.objectContaining({ id: 'd-1', since: SINCE, age: 14 * DAY + 60_000, stagnant: true })]);
      expect(body.health.readyAges.stagnant).toBe(1);
    });

    it('compte les heures de l’horloge en UTC, où l’heure ne change jamais : le même instant fait 14 j 1 h, et le Prêt stagne', async () => {
      const { body } = await getAt('UTC', '2026-11-03T11:00:00Z', '?project=delta&range=7d');

      expect(body.health.readyAges.tickets).toEqual([expect.objectContaining({ id: 'd-1', age: 14 * DAY + 3_600_000, stagnant: true })]);
    });
  });

  it('Carte d’activité : 11 Transitions à 10:00 UTC, rangées par jour de la semaine (le 1er octobre est un jeudi)', async () => {
    const { body } = await get(PERIOD);

    const busy = body.health.activity.cells.flatMap((day, weekday) => day.flatMap((count, hour) => (count > 0 ? [[weekday, hour, count]] : [])));
    // Lundi 5 (g-2 fermé), mardi 6 (g-3 en cours), mercredi 7 (g-3 fermé), jeudi 8 (g-3 rouvert, g-4 et g-5 fermés),
    // vendredi 2 et 9 (g-1 et g-3 en cours), samedi 3 et 10 (g-2 en cours, g-3 fermé), dimanche 4 (g-1 fermé).
    expect(busy).toEqual([
      [0, 10, 1],
      [1, 10, 1],
      [2, 10, 1],
      [3, 10, 3],
      [4, 10, 2],
      [5, 10, 2],
      [6, 10, 1],
    ]);
    expect(body.health.activity.total).toBe(11);
  });

  it('mesure la même période que les autres métriques, et rend une santé neutre pour un Projet que rien n’a touché', async () => {
    const { body } = await get('?from=2026-09-01&to=2026-09-10&project=gamma');

    expect(body.period).toMatchObject({ from: '2026-09-01', to: '2026-09-10' });
    expect(body.health.efficiency).toMatchObject({ n: 0, ratio: null });
    expect(body.health.reopening.rate).toBeNull();
    expect(body.health.abandonment.rate).toBeNull();
    expect(body.health.leadTimeBreakdown.deliveries).toBe(0);
    expect(body.health.activity.total).toBe(0);
    // Le Prêt est mesuré à la fin de la période : g-6 n'existait pas en septembre.
    expect(body.health.readyAges.tickets).toEqual([]);
  });
});
