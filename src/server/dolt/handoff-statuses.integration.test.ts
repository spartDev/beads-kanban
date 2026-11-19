import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { IssueChronologyResponse, MetricsResponse } from '../../shared/api';
import { yieldToEventLoop } from '../../testing/event-loop';
import { createMetricsService } from '../metrics/service';
import { createProjectService } from '../projects/service';
import { buildServer } from '../server';
import { createDatabase, day, hasBinary, isolatedDoltEnv } from '../testing/dolt-fixture';
import { scratchDir } from '../testing/scratch';
import { createCheckedDoltClient } from './stored-sql';

/**
 * Les Statuts de relais sont des statuts de travail (bdesk-pz0.3, ADR 0007), de la base Dolt aux métriques, sur de vraies bases (sans bd), par l'API de
 * l'app. Chaque commit est daté du jour `n` d'octobre 2026 à 10 h UTC ; les métriques se mesurent le 12 à midi, en UTC, du 1er au 12.
 *
 *   relais  déclare les trois Statuts de relais et `qa_testing:wip` (table `config`, comme bd l'écrit)
 *     r-1  en cours (j2), en relecture (j3), en cours (j4, un Retour), en intégration (j5, bloqué par r-3 jusqu'au j6), à valider (j6), fermé (j7)
 *     r-2  en cours (j2), en relecture (j3), ouvert (j4, une Prise rendue), en relecture (j8) : encore en relecture le 12
 *     r-3  en cours (j2), à valider (j3), ouvert (j4, un Report), puis ouvert jusqu'au bout
 *     r-4  qa_testing (j5), fermé (j7)
 *   nu      ne déclare rien
 *     n-1  en relecture (j2), fermé (j3)
 *     n-2  qa_testing (j2), fermé (j3)
 */

const DAY = 86_400_000;
const NOW = new Date('2026-10-12T12:00:00Z');
const PERIOD = '?from=2026-10-01&to=2026-10-12';
/** L'instant du commit du jour `n`, comme l'API le rend. */
const iso = (n: number) => new Date(day(n)).toISOString();
const stamp = (n: number) => `2026-10-${String(n).padStart(2, '0')} 10:00:00`;

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

const create = (id: string, n: number) =>
  `insert into issues (id, title, description, design, acceptance_criteria, notes, issue_type, created_at, updated_at, close_reason)
   values ('${id}', 'Titre ${id}', '', '', '', '', 'task', '${stamp(n)}', '${stamp(n)}', '')`;
const move = (id: string, status: string, n: number) =>
  `update issues set status = '${status}', updated_at = '${stamp(n)}'${status === 'closed' ? `, closed_at = '${stamp(n)}', close_reason = 'fait'` : ''} where id = '${id}'`;
const blocks = (id: string, target: string, n: number) =>
  `insert into dependencies (id, issue_id, depends_on_issue_id, type, created_at, created_by) values (uuid(), '${id}', '${target}', 'blocks', '${stamp(n)}', 'tom')`;

/** Le Projet `name` (embedded) dans `root` : sa base, un commit par jour du script (le premier crée le schéma). */
async function buildProject(env: NodeJS.ProcessEnv, root: string, name: string, prefix: string, script: [number, string[]][]): Promise<void> {
  const beads = join(root, name, '.beads');
  mkdirSync(beads, { recursive: true });
  writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: 'tdb' }));
  const base = createDatabase(env, join(beads, 'embeddeddolt', 'tdb'));
  base.sql(`${SCHEMA} insert into config values ('issue_prefix', '${prefix}');`);
  for (const [n, statements] of script) {
    await yieldToEventLoop();
    base.sql(statements.join(';\n'));
    base.commit(n, `jour ${n}`);
  }
}

/** Un binaire qui garde le SQL de chaque processus `dolt sql` (un fichier par processus) puis passe la main au vrai `dolt`. */
function loggingBinary() {
  const bin = scratchDir('bdesk-handoff-statuses-bin-');
  const binary = join(bin, 'dolt');
  const real = execFileSync('which', ['dolt'], { encoding: 'utf8' }).trim();
  writeFileSync(
    binary,
    `#!/bin/sh\nif [ "$1" = sql ]; then log=$(mktemp '${bin}/sql-XXXXXX'); cat > "$log"; exec '${real}' "$@" < "$log"; fi\nexec '${real}' "$@"\n`,
  );
  chmodSync(binary, 0o755);
  const logs = () => readdirSync(bin).filter((file) => file.startsWith('sql-'));
  return { binary, logs, sql: (file: string) => readFileSync(join(bin, file), 'utf8') };
}

describe.skipIf(!hasBinary('dolt'))('Statuts de relais : des Projets jetables dont les tickets passent par eux (bdesk-pz0.3)', { timeout: 120_000 }, () => {
  let root: string;
  let metrics: (query: string) => Promise<MetricsResponse>;
  let chronology: (project: string, id: string) => Promise<IssueChronologyResponse['chronology']>;
  const config = () => ({ roots: [root], projects: [], hiddenProjects: [] });

  beforeAll(async () => {
    root = realpathSync(scratchDir('bdesk-handoff-statuses-'));
    const env = isolatedDoltEnv();
    await buildProject(env, root, 'relais', 'r', [
      [1, [...['r-1', 'r-2', 'r-3', 'r-4'].map((id) => create(id, 1)), "insert into config values ('status.custom', 'in_review:wip,in_integration:wip,awaiting_human:wip,qa_testing:wip')"]],
      [2, [move('r-1', 'in_progress', 2), move('r-2', 'in_progress', 2), move('r-3', 'in_progress', 2)]],
      [3, [move('r-1', 'in_review', 3), move('r-2', 'in_review', 3), move('r-3', 'awaiting_human', 3)]],
      [4, [move('r-1', 'in_progress', 4), move('r-2', 'open', 4), move('r-3', 'open', 4)]],
      [5, [move('r-1', 'in_integration', 5), blocks('r-1', 'r-3', 5), move('r-4', 'qa_testing', 5)]],
      [6, [move('r-1', 'awaiting_human', 6), "delete from dependencies where issue_id = 'r-1'"]],
      [7, [move('r-1', 'closed', 7), move('r-4', 'closed', 7)]],
      [8, [move('r-2', 'in_review', 8)]],
    ]);
    await buildProject(env, root, 'nu', 'n', [
      [1, [create('n-1', 1), create('n-2', 1)]],
      [2, [move('n-1', 'in_review', 2), move('n-2', 'qa_testing', 2)]],
      [3, [move('n-1', 'closed', 3), move('n-2', 'closed', 3)]],
    ]);

    const projects = createProjectService(config());
    const app = buildServer({ config: config(), projects, metrics: createMetricsService(projects, { now: () => NOW, timeZone: 'UTC' }) });
    metrics = async (query) => {
      const res = await app.inject({ method: 'GET', url: `/api/metrics${query}` });
      expect(res.statusCode).toBe(200);
      return res.json();
    };
    chronology = async (project, id) => {
      const res = await app.inject({ method: 'GET', url: `/api/projects/${project}/issues/${id}/chronology` });
      expect(res.statusCode).toBe(200);
      return res.json().chronology;
    };
  }, 120_000);

  it('compte le temps des Statuts de relais et du statut déclaré wip dans le Cycle Time, et le Blocage pendant le relais dans l’Efficacité du flux', async () => {
    const body = await metrics(`${PERIOD}&project=relais`);

    // r-1 : du j2 au j7, tout en travail (5 j) ; r-4 : du j5 au j7 en qa_testing, déclaré wip (2 j).
    expect(body.tiles.cycleTime).toMatchObject({ median: 3.5 * DAY, n: 2 });
    expect(body.health.efficiency).toMatchObject({ n: 2, cycleTime: 7 * DAY, blockedTime: 1 * DAY, blockedDeliveries: 1, ratio: 6 / 7 });
  });

  it('compte dans le WIP le ticket encore en relecture, avec son statut', async () => {
    const body = await metrics(`${PERIOD}&project=relais`);

    expect(body.tiles.wip.current).toBe(1);
    expect(body.inProgress.map(({ id, status, blocked }) => ({ id, status, blocked }))).toEqual([{ id: 'r-2', status: 'in_review', blocked: false }]);
  });

  it('donne au CFD les colonnes des trois Statuts de relais déclarés, Bloqué pour un ticket en relais et en Blocage', async () => {
    const { cfd } = await metrics(`${PERIOD}&project=relais`);
    const on = (date: string) => cfd.find((point) => point.date === date);
    const empty = { backlog: 0, ready: 0, inProgress: 0, inReview: 0, inIntegration: 0, awaitingHuman: 0, blocked: 0, done: 0 };

    expect(on('2026-10-03')).toEqual({ ...empty, date: '2026-10-03', ready: 1, inReview: 2, awaitingHuman: 1 });
    expect(on('2026-10-05')).toEqual({ ...empty, date: '2026-10-05', ready: 2, inProgress: 1, blocked: 1 });
    expect(on('2026-10-06')).toEqual({ ...empty, date: '2026-10-06', ready: 2, inProgress: 1, awaitingHuman: 1 });
    expect(cfd.at(-1)).toEqual({ ...empty, date: '2026-10-12', ready: 1, inReview: 1, done: 2 });
  });

  it('compte la Prise rendue depuis En relecture, mais ni le Report depuis À valider ni le Retour en cours', async () => {
    const body = await metrics(`${PERIOD}&project=relais`);

    expect(body.health.rework.tickets.map(({ id, returns, reopenings }) => ({ id, returns, reopenings }))).toEqual([{ id: 'r-2', returns: 1, reopenings: 0 }]);
  });

  it('retrace la Chronologie d’un ticket passé par les trois Statuts de relais, et compte le statut déclaré wip', async () => {
    const r1 = await chronology('relais', 'r-1');

    expect(r1.transitions.map(({ status }) => status)).toEqual(['open', 'in_progress', 'in_review', 'in_progress', 'in_integration', 'awaiting_human', 'closed']);
    expect(r1).toMatchObject({ cycleTime: 5 * DAY, blockedTime: 1 * DAY, leadTime: 6 * DAY });
    // Le Blocage, pendant l'intégration, est du travail bloqué, d'un seul tenant.
    expect(r1.blockages).toMatchObject([{ from: iso(5), to: iso(6), blockedBy: ['r-3'], phases: [{ kind: 'work', from: iso(5), to: iso(6) }] }]);
    expect((await chronology('relais', 'r-4')).cycleTime).toBe(2 * DAY);
  });

  it('reconnaît les Statuts de relais d’un Projet qui ne déclare rien, et laisse en pause son autre statut personnalisé', async () => {
    const body = await metrics(`${PERIOD}&project=nu`);

    expect(body.tiles.cycleTime).toMatchObject({ median: 1 * DAY, n: 1 }); // n-1 seul : n-2 n'a jamais été démarré
    expect(body.tiles.leadTime.n).toBe(2);
    expect(body.cfd.find((point) => point.date === '2026-10-02')).toEqual({
      date: '2026-10-02',
      backlog: 0,
      ready: 0,
      inProgress: 0,
      inReview: 1,
      blocked: 0,
      done: 0,
    });
    expect((await chronology('nu', 'n-2')).cycleTime).toBeNull();
  });

  it('lit la déclaration dans le même processus dolt que les tickets : l’historique ne coûte aucun processus de plus', async () => {
    const { binary, logs, sql } = loggingBinary();
    const service = createProjectService(config(), { dolt: createCheckedDoltClient({ binary }) });
    await service.histories('relais'); // la découverte, et le commit de base que retient la vérification du SQL stocké
    const before = new Set(logs());

    const history = await service.histories('relais');

    const read = logs()
      .filter((file) => !before.has(file))
      .map(sql);
    const declaring = read.filter((text) => text.includes("`key` = 'status.custom'"));
    expect(declaring).toHaveLength(1);
    expect(declaring[0]).toContain("select id, issue_type from issues as of 'HEAD'");
    expect(history.declaredStatuses).toEqual({ handoff: ['in_review', 'in_integration', 'awaiting_human'], others: [{ name: 'qa_testing', category: 'wip' }] });
  });
});
