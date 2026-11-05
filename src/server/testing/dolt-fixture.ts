import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Environnement isolé pour piloter dolt en écriture dans un dossier temporaire, sans toucher à ~/.dolt. */
export function isolatedDoltEnv(): NodeJS.ProcessEnv {
  const root = mkdtempSync(join(tmpdir(), 'bdesk-dolt-root-'));
  mkdirSync(join(root, '.dolt'), { recursive: true });
  writeFileSync(
    join(root, '.dolt', 'config_global.json'),
    JSON.stringify({ 'user.name': 'testeur', 'user.email': 'testeur@example.com', 'metrics.disabled': 'true' }),
  );
  return { ...process.env, DOLT_ROOT_PATH: root };
}

/** Les binaires déjà signalés absents : l'avertissement n'est dit qu'une fois par fichier de tests (chacun a son propre module). */
const reportedMissing = new Set<string>();

/**
 * Le binaire répond-il à `<binaire> version` ? Les tests d'intégration qui l'exigent (`describe.skipIf(!hasBinary('dolt'))`) sont
 * SAUTÉS quand il manque, jamais en échec : un saut silencieux passerait pour un succès, donc l'avertissement le dit (bdesk-38k.33).
 */
export const hasBinary = (binary: string): boolean => {
  const found = spawnSync(binary, ['version'], { stdio: 'ignore' }).status === 0;
  if (!found && !reportedMissing.has(binary)) {
    reportedMissing.add(binary);
    console.warn(
      `ATTENTION : « ${binary} » est introuvable dans le PATH, les tests de ce fichier qui l'exigent sont SAUTÉS (ni réussis, ni échoués). ` +
        `Installez-le pour les exécuter (voir CLAUDE.md, « Build & Test »).`,
    );
  }
  return found;
};

/** Exécute une commande `dolt` dans `cwd` ; réservé aux bases temporaires créées par les tests. */
export function dolt(env: NodeJS.ProcessEnv, cwd: string, ...args: string[]): string {
  return execFileSync('dolt', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Un instant de l'historique de la base d'essai, en UTC. */
export const day = (n: number): string => `2026-10-${String(n).padStart(2, '0')}T10:00:00Z`;

export interface Scratch {
  /** Exécute des instructions SQL (écriture comprise) dans la base. */
  sql(statements: string): string;
  /** Les lignes d'une requête de lecture, lues directement par `dolt sql` (hors du lecteur testé). */
  rows(query: string): Record<string, unknown>[];
  /** Valide l'état courant sous un commit daté du jour `n` d'octobre 2026, 10 h UTC. */
  commit(n: number, message: string): void;
  /** Un `dolt` quelconque dans la base (branches, fusions…). */
  dolt(...args: string[]): string;
}

/**
 * Crée une base Dolt vide dans `dir`. Le commit initial de `dolt init` est daté d'aujourd'hui, donc *après*
 * les commits datés de `commit` dans le graphe : l'horloge recule d'office dans ces historiques.
 */
export function createDatabase(env: NodeJS.ProcessEnv, dir: string): Scratch {
  mkdirSync(dir, { recursive: true });
  dolt(env, dir, 'init', '--name', 'testeur', '--email', 'testeur@example.com');
  return {
    sql: (statements) => dolt(env, dir, 'sql', '-q', statements),
    rows: (query) => (JSON.parse(dolt(env, dir, 'sql', '-r', 'json', '-q', query)) as { rows: Record<string, unknown>[] }).rows,
    commit(n, message) {
      dolt(env, dir, 'add', '-A');
      dolt(env, dir, 'commit', '--allow-empty', '-m', message, '--date', day(n));
    },
    dolt: (...args) => dolt(env, dir, ...args),
  };
}

/**
 * Crée une base Dolt dans `dir` qui rejoue l'histoire d'une base beads dont le schéma des dépendances a migré :
 * `depends_on_id` jusqu'au 4 octobre, `depends_on_issue_id` (et clé primaire `id`) ensuite, comme bd l'a fait
 * à une montée de version. Les commits sont datés (un par jour à 10 h UTC) pour pouvoir vérifier les durées.
 *
 *   1 oct  t-1, t-2 (tâches) et t-3 (epic) créés ; préfixe `t`
 *   2 oct  t-1 en cours ; t-2 dépend de t-1 (blocks) ; t-2 enfant de t-3 (parent-child)
 *   3 oct  t-1 fermé ; t-3 dépend de t-2 (blocks) ; commentaire et étiquette sur t-1
 *   4 oct  t-3 ne dépend plus de t-2
 *   5 oct  migration du schéma des dépendances
 *   6 oct  t-2 en cours ; t-3 dépend de t-1 (blocks)
 *   7 oct  t-2 fermé ; t-2 ne dépend plus de t-1
 *   8 oct  t-4 créé ; t-3 dépend de t-4 (blocks)
 */
export function buildLegacyDatabase(env: NodeJS.ProcessEnv, dir: string): void {
  mkdirSync(dir, { recursive: true });
  // Le commit initial de `dolt init` est daté d'aujourd'hui, avant les commits datés ci-dessous dans le graphe.
  dolt(env, dir, 'init', '--name', 'testeur', '--email', 'testeur@example.com');
  const sql = (statement: string) => dolt(env, dir, 'sql', '-q', statement);
  const commit = (n: number, message: string) => {
    dolt(env, dir, 'add', '-A');
    dolt(env, dir, 'commit', '-m', message, '--date', day(n));
  };

  sql(`
    create table issues (
      id varchar(255) primary key, title varchar(500) not null, description text not null, design text not null,
      acceptance_criteria text not null, notes text not null, status varchar(32) not null default 'open',
      priority int not null default 2, issue_type varchar(32) not null default 'task', assignee varchar(255),
      created_at datetime not null, updated_at datetime not null, closed_at datetime, close_reason text not null);
    create table dependencies (
      issue_id varchar(255) not null, depends_on_id varchar(255) not null, type varchar(32) not null default 'blocks',
      created_at datetime not null, created_by varchar(255) not null, primary key (issue_id, depends_on_id));
    create table labels (issue_id varchar(255) not null, label varchar(255) not null, primary key (issue_id, label));
    create table comments (
      id char(36) primary key, issue_id varchar(255) not null, author varchar(255) not null,
      text text not null, created_at datetime not null);
    create table config (\`key\` varchar(255) primary key, value text not null);`);
  const issue = (id: string, type: string, title: string) =>
    `insert into issues (id, title, description, design, acceptance_criteria, notes, issue_type, created_at, updated_at, close_reason)
     values ('${id}', '${title}', '', '', '', '', '${type}', '2026-10-01 10:00:00', '2026-10-01 10:00:00', '')`;
  sql(`insert into config values ('issue_prefix', 't'); ${issue('t-1', 'task', 'Premier')}; ${issue('t-2', 'task', 'Second')}; ${issue('t-3', 'epic', 'Epic')}`);
  commit(1, 'create');

  sql(`update issues set status = 'in_progress', assignee = 'tom', updated_at = '2026-10-02 10:00:00' where id = 't-1';
       insert into dependencies values ('t-2', 't-1', 'blocks', '2026-10-02 10:00:00', 'tom'),
                                       ('t-2', 't-3', 'parent-child', '2026-10-02 10:00:00', 'tom')`);
  commit(2, 'start t-1');

  sql(`update issues set status = 'closed', closed_at = '2026-10-03 10:00:00', close_reason = 'fait', updated_at = '2026-10-03 10:00:00' where id = 't-1';
       insert into dependencies values ('t-3', 't-2', 'blocks', '2026-10-03 10:00:00', 'tom');
       insert into labels values ('t-1', 'backend');
       insert into comments values ('00000000-0000-0000-0000-000000000001', 't-1', 'tom', 'Terminé, merci', '2026-10-03 09:59:00')`);
  commit(3, 'close t-1');

  sql(`delete from dependencies where issue_id = 't-3' and depends_on_id = 't-2'`);
  commit(4, 'drop t-3 -> t-2');

  // Migration : la cible change de colonne, la clé primaire devient un identifiant.
  sql(`alter table dependencies add column depends_on_issue_id varchar(255);
       update dependencies set depends_on_issue_id = depends_on_id;
       alter table dependencies drop primary key;
       alter table dependencies drop column depends_on_id;
       alter table dependencies add column id char(36);
       update dependencies set id = uuid();
       alter table dependencies add primary key (id)`);
  commit(5, 'schema: split dependencies target');

  sql(`update issues set status = 'in_progress', updated_at = '2026-10-06 10:00:00' where id = 't-2';
       insert into dependencies (id, issue_id, depends_on_issue_id, type, created_at, created_by)
       values (uuid(), 't-3', 't-1', 'blocks', '2026-10-06 10:00:00', 'tom')`);
  commit(6, 'start t-2');

  sql(`update issues set status = 'closed', closed_at = '2026-10-07 10:00:00', updated_at = '2026-10-07 10:00:00' where id = 't-2';
       delete from dependencies where issue_id = 't-2' and depends_on_issue_id = 't-1'`);
  commit(7, 'close t-2');

  sql(`${issue('t-4', 'bug', 'Bloquant')}; update issues set created_at = '2026-10-08 10:00:00', updated_at = '2026-10-08 10:00:00' where id = 't-4';
       insert into dependencies (id, issue_id, depends_on_issue_id, type, created_at, created_by)
       values (uuid(), 't-3', 't-4', 'blocks', '2026-10-08 10:00:00', 'tom')`);
  commit(8, 'create t-4');
}
