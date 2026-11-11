import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDatabase, type Scratch } from './dolt-fixture';

/**
 * Les bases d'essai du SQL stocké (bdesk-38k.69, 38k.74) : le schéma que lit l'app, les deux vues que bd crée lui-même, deux tickets, et un fichier témoin inoffensif dans le dossier
 * de la base, que les vues et colonnes hostiles des tests essaient de lire ou de recopier.
 */
export const CANARY = 'CANARY-SQL-STOCKE';

export const SCHEMA = `
  create table issues (
    id varchar(255) primary key, title varchar(500) not null, description text not null, design text not null,
    acceptance_criteria text not null, notes text not null, status varchar(32) not null default 'open',
    priority int not null default 2, issue_type varchar(32) not null default 'task', assignee varchar(255),
    created_at datetime not null default current_timestamp, updated_at datetime not null default current_timestamp, closed_at datetime, close_reason text not null);
  create table dependencies (
    id char(36) primary key, issue_id varchar(255) not null, depends_on_issue_id varchar(255) not null,
    type varchar(32) not null default 'blocks', created_at datetime not null default current_timestamp, created_by varchar(255) not null);
  create table labels (issue_id varchar(255) not null, label varchar(255) not null, primary key (issue_id, label));
  create table comments (id char(36) primary key, issue_id varchar(255) not null, author varchar(255) not null,
    text text not null, created_at datetime not null default current_timestamp);
  create table config (\`key\` varchar(255) primary key, value text not null);`;

/** Ce que bd crée de lui-même dans ses bases (relevé sur des copies de bases réelles) : deux vues, qui ne sont jamais lues par l'app. */
export const BEADS_VIEWS = `
  create view ready_issues as select id, title from issues where status = 'open';
  create view blocked_issues as select i.id, i.title from issues i join dependencies d on d.issue_id = i.id where i.status <> 'closed'`;

export const ROWS = `
  insert into config values ('issue_prefix', 'a');
  insert into issues (id, title, description, design, acceptance_criteria, notes, close_reason) values
    ('a-1', 'Premier', '', '', '', '', ''), ('a-2', 'Second', '', '', '', '', '');
  insert into dependencies (id, issue_id, depends_on_issue_id, created_by) values (uuid(), 'a-2', 'a-1', 'tom');
  insert into labels values ('a-1', 'backend');
  insert into comments (id, issue_id, author, text) values (uuid(), 'a-1', 'tom', 'Un commentaire')`;

/** Une vue sur la fonction de table qui exécute le SQL de ses arguments : la lire écrit `file`. */
export const outfile = (file: string) => `dolt_query_diff('select ''x'' as v into outfile ''${file}''', 'select 1 as v')`;

/**
 * Une base comme celles de bd, dans `dir` (créée ici), avec son fichier témoin `canary.txt` : le schéma, ses deux vues, des tickets, un commit. Le jour 1 : les commits qu'un test ajoute
 * prennent les jours suivants.
 */
export function beadsLikeDatabase(env: NodeJS.ProcessEnv, dir: string): Scratch {
  const scratch = createDatabase(env, dir);
  writeFileSync(join(dir, 'canary.txt'), `${CANARY}\n`);
  scratch.sql(`${SCHEMA}; ${ROWS}; ${BEADS_VIEWS}`);
  scratch.commit(1, 'base');
  return scratch;
}
