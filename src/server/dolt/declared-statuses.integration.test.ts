import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DeclaredStatuses, IssuesResponse } from '../../shared/api';
import { yieldToEventLoop } from '../../testing/event-loop';
import { createProjectService } from '../projects/service';
import { buildServer } from '../server';
import { createDatabase, hasBinary, isolatedDoltEnv, type Scratch } from '../testing/dolt-fixture';
import { scratchDir } from '../testing/scratch';
import { createCheckedDoltClient } from './stored-sql';

/**
 * Les statuts que déclare un Projet (bdesk-pz0.2, ADR 0007), sur de vraies bases Dolt (sans bd), lus par l'API de l'app : le client vérifié (garde de
 * lecture seule et vérification du SQL stocké compris), comme `pnpm start`. La déclaration est celle que bd 1.3.1 écrit dans la table `config`
 * (`bd config set status.custom "in_review:wip,in_integration:wip,awaiting_human:wip"`) ; elle se lit au dernier commit, avec les tickets.
 *
 *   relais    déclare les trois Statuts de relais au jour 1 ; r-1 passe en relecture au jour 2 ; une autre déclaration attend ensuite sans commit
 *   sans-cle  ne déclare rien : sa table `config` n'a que le préfixe
 */

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

/** Ce que bd écrit pour la chaîne d'agents (ADR 0007), vérifié avec bd 1.3.1. */
const HANDOFF_DECLARATION = 'in_review:wip,in_integration:wip,awaiting_human:wip';

const create = (id: string, n: number) =>
  `insert into issues (id, title, description, design, acceptance_criteria, notes, issue_type, created_at, updated_at, close_reason)
   values ('${id}', 'Titre ${id}', '', '', '', '', 'task', '${stamp(n)}', '${stamp(n)}', '')`;
const move = (id: string, status: string, n: number) => `update issues set status = '${status}', updated_at = '${stamp(n)}' where id = '${id}'`;

/** Le Projet `name` (embedded) dans `root`, sa base créée avec le schéma et le préfixe `prefix`, son premier commit au jour 1. */
function buildProject(env: NodeJS.ProcessEnv, root: string, name: string, prefix: string, day1: string[]): Scratch {
  const beads = join(root, name, '.beads');
  mkdirSync(beads, { recursive: true });
  writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: 'tdb' }));
  const base = createDatabase(env, join(beads, 'embeddeddolt', 'tdb'));
  base.sql(`${SCHEMA} insert into config values ('issue_prefix', '${prefix}'); ${day1.join(';\n')}`);
  base.commit(1, 'jour 1');
  return base;
}

/** Un binaire qui compte ses lancements puis passe la main au vrai `dolt` : chaque ligne du compteur est un processus. */
function countingBinary() {
  const bin = scratchDir('bdesk-declared-statuses-bin-');
  const counter = join(bin, 'calls');
  const binary = join(bin, 'dolt');
  const real = execFileSync('which', ['dolt'], { encoding: 'utf8' }).trim();
  writeFileSync(binary, `#!/bin/sh\necho x >> '${counter}'\nexec '${real}' "$@"\n`);
  chmodSync(binary, 0o755);
  return { binary, calls: () => (existsSync(counter) ? readFileSync(counter, 'utf8').split('\n').filter(Boolean).length : 0) };
}

describe.skipIf(!hasBinary('dolt'))('statuts déclarés : un Projet jetable qui déclare les trois Statuts de relais (bdesk-pz0.2)', { timeout: 120_000 }, () => {
  let root: string;
  let relais: Scratch;
  const config = () => ({ roots: [root], projects: [], hiddenProjects: [] });

  /** Le kanban du Projet, par l'API d'une application neuve (aucun cache de lecture). */
  async function boardOf(project: string): Promise<{ status: number; body: IssuesResponse }> {
    const app = buildServer({ config: config(), live: { intervalMs: 3_600_000 } });
    try {
      const res = await app.inject({ url: `/api/projects/${project}/issues` });
      return { status: res.statusCode, body: res.json() };
    } finally {
      await app.close();
    }
  }

  beforeAll(async () => {
    root = realpathSync(scratchDir('bdesk-declared-statuses-'));
    const env = isolatedDoltEnv();
    relais = buildProject(env, root, 'relais', 'r', [create('r-1', 1), create('r-2', 1), `insert into config values ('status.custom', '${HANDOFF_DECLARATION}')`]);
    await yieldToEventLoop();
    relais.sql(move('r-1', 'in_review', 2));
    relais.commit(2, 'jour 2 : r-1 en relecture');
    await yieldToEventLoop();
    buildProject(env, root, 'sans-cle', 's', [create('s-1', 1)]);
  }, 120_000);

  it('rend les trois Statuts de relais avec les tickets du kanban, et aucun autre statut', async () => {
    const { status, body } = await boardOf('relais');

    expect(status).toBe(200);
    expect(body.declaredStatuses).toEqual({ handoff: ['in_review', 'in_integration', 'awaiting_human'], others: [] } satisfies DeclaredStatuses);
    // Le ticket qui porte un Statut de relais est lu dans le même état que la déclaration ; ce que le kanban en fait est l'affaire de bdesk-pz0.3.
    expect(body.issues.map(({ id, status }) => [id, status])).toEqual([
      ['r-1', 'in_review'],
      ['r-2', 'open'],
    ]);
  });

  it('ne déclare rien pour un Projet dont la table config n’a pas la clé, sans erreur', async () => {
    const { status, body } = await boardOf('sans-cle');

    expect(status).toBe(200);
    expect(body.declaredStatuses).toEqual({ handoff: [], others: [] });
    expect(body.issues.map(({ id }) => id)).toEqual(['s-1']);
  });

  it('ne coûte aucun processus dolt de plus : le kanban se lit toujours en un seul', async () => {
    const { binary, calls } = countingBinary();
    const service = createProjectService(config(), { dolt: createCheckedDoltClient({ binary }) });
    await service.board('relais'); // la découverte, et le commit de base que retient la vérification du SQL stocké
    const before = calls();

    const board = await service.board('relais');

    expect(calls() - before).toBe(1);
    expect(board.declaredStatuses.handoff).toEqual(['in_review', 'in_integration', 'awaiting_human']);
  });

  // En dernier : ce test laisse la base avec une déclaration commitée qui n'est plus celle du jour 1.
  it('lit la déclaration du dernier commit : une déclaration qui attend son commit ne compte pas, et compte dès qu’il est fait', async () => {
    relais.sql("update config set value = 'in_review:wip, qa_testing:WIP,on_hold:frozen,qa_testing:done' where `key` = 'status.custom'");

    const uncommitted = await boardOf('relais');

    expect(uncommitted.status).toBe(200);
    expect(uncommitted.body.declaredStatuses).toEqual({ handoff: ['in_review', 'in_integration', 'awaiting_human'], others: [] });

    relais.commit(3, 'jour 3 : une autre déclaration');
    const committed = await boardOf('relais');

    expect(committed.body.declaredStatuses).toEqual({
      handoff: ['in_review'],
      others: [
        { name: 'qa_testing', category: 'wip' },
        { name: 'on_hold', category: 'frozen' },
      ],
    });
  });
});
