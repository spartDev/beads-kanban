import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeFlow, type TicketHistory } from '../../domain/flow';
import { analyzeProject } from '../../domain/metrics';
import { yieldToEventLoop } from '../../testing/event-loop';
import { createDatabase, day, hasBinary, isolatedDoltEnv } from '../testing/dolt-fixture';
import { scratchDir } from '../testing/scratch';
import { readTicketHistories } from './history';
import { createCheckedDoltClient } from './stored-sql';

/**
 * L'Intention écrite (bdesk-3e9.4) sur de vraies bases Dolt, lues par le client de l'app (garde de lecture seule et vérification du SQL stocké compris) : la présence des
 * critères d'acceptation au premier démarrage, que la lecture de l'historique relève en booléen à chaque changement de statut, sans jamais en lire le texte.
 */

const stamp = (n: number) => `2026-10-${String(n).padStart(2, '0')} 10:00:00`;
const sqlText = (text: string) => `'${text.replaceAll("'", "''")}'`;

/** Le schéma des tickets de bd, critères d'acceptation compris (`withCriteria`) ou d'une version d'avant eux. */
const schema = (withCriteria: boolean) => `
  create table issues (
    id varchar(255) primary key, title varchar(500) not null, description text not null, design text not null,
    ${withCriteria ? 'acceptance_criteria text not null, ' : ''}notes text not null, status varchar(32) not null default 'open',
    priority int not null default 2, issue_type varchar(32) not null default 'task', assignee varchar(255),
    created_at datetime not null, updated_at datetime not null, closed_at datetime, close_reason text not null);
  create table dependencies (
    id char(36) primary key, issue_id varchar(255) not null, depends_on_issue_id varchar(255) not null,
    type varchar(32) not null default 'blocks', created_at datetime not null, created_by varchar(255) not null);
  create table labels (issue_id varchar(255) not null, label varchar(255) not null, primary key (issue_id, label));
  create table comments (id char(36) primary key, issue_id varchar(255) not null, author varchar(255) not null,
    text text not null, created_at datetime not null);
  create table config (\`key\` varchar(255) primary key, value text not null);
  insert into config values ('issue_prefix', 'w');`;

/** Un ticket créé le jour `n` ; `criteria` : ses critères d'acceptation (absent : un schéma qui n'en a pas). */
const create = (id: string, n: number, criteria?: string) =>
  `insert into issues (id, title, description, design, ${criteria === undefined ? '' : 'acceptance_criteria, '}notes, issue_type, created_at, updated_at, close_reason)
   values ('${id}', 'Titre ${id}', 'Une description', '', ${criteria === undefined ? '' : `${sqlText(criteria)}, `}'', 'task', '${stamp(n)}', '${stamp(n)}', '')`;
const move = (id: string, status: string, n: number) =>
  `update issues set status = '${status}', updated_at = '${stamp(n)}', closed_at = ${status === 'closed' ? `'${stamp(n)}'` : 'null'} where id = '${id}'`;
const criteria = (id: string, text: string, n: number) => `update issues set acceptance_criteria = ${sqlText(text)}, updated_at = '${stamp(n)}' where id = '${id}'`;
const notes = (id: string, text: string, n: number) => `update issues set notes = ${sqlText(text)}, updated_at = '${stamp(n)}' where id = '${id}'`;

const WRITTEN = '1. Le graphique ne bouge plus.\n2. Le tableau garde son ordre.';

/** Joue `script` (un commit par jour, à 10 h UTC) dans une base neuve, en rendant la main entre deux commits (voir `yieldToEventLoop`) ; rend son dossier. */
async function build(env: NodeJS.ProcessEnv, prefix: string, setup: string, script: [n: number, statements: string[]][]): Promise<string> {
  const dir = join(realpathSync(scratchDir(prefix)), 'db');
  const base = createDatabase(env, dir);
  base.sql(setup);
  for (const [n, statements] of script) {
    await yieldToEventLoop();
    base.sql(statements.join(';\n'));
    base.commit(n, `jour ${n}`);
  }
  return dir;
}

const byId = (histories: TicketHistory[]) => new Map(histories.map((history) => [history.id, history]));
const statusesOf = (history: TicketHistory | undefined) => history?.statusSnapshots.map(({ status, at }) => [status, at]);
const on = (n: number) => new Date(day(n));

/**
 *   j1  w-1 à w-8 créés : w-1, w-4, w-5 et w-7 avec des critères ; w-6 avec des critères faits de blancs ; w-2, w-3 et w-8 sans
 *   j2  les critères de w-4 et de w-5 sont vidés
 *   j3  w-5 retrouve des critères ; les notes de w-2 changent (aucun statut ne change)
 *   j4  w-1, w-2, w-4, w-5, w-6 et w-8 démarrent ; w-3 démarre, ses critères écrits dans le même commit
 *   j5  w-2 et w-4 reçoivent des critères, en cours de travail ; w-8 revient à ouvert
 *   j6  w-8 reçoit des critères
 *   j7  w-8 redémarre ; w-1 et w-2 sont fermés
 *
 * w-7 n'est jamais démarré.
 */
describe.skipIf(!hasBinary('dolt'))('Intention écrite : critères d’acceptation lus dans l’historique d’une vraie base Dolt', { timeout: 120_000 }, () => {
  let histories: Map<string, TicketHistory>;

  beforeAll(async () => {
    const dir = await build(isolatedDoltEnv(), 'bdesk-written-intent-', schema(true), [
      [1, [create('w-1', 1, WRITTEN), create('w-2', 1, ''), create('w-3', 1, ''), create('w-4', 1, WRITTEN), create('w-5', 1, WRITTEN), create('w-6', 1, ' \n\t  \n'), create('w-7', 1, WRITTEN), create('w-8', 1, '')]],
      [2, [criteria('w-4', '', 2), criteria('w-5', '', 2)]],
      [3, [criteria('w-5', WRITTEN, 3), notes('w-2', 'Une note', 3)]],
      [4, [...['w-1', 'w-2', 'w-4', 'w-5', 'w-6', 'w-8'].map((id) => move(id, 'in_progress', 4)), `${move('w-3', 'in_progress', 4)}; ${criteria('w-3', WRITTEN, 4)}`]],
      [5, [criteria('w-2', WRITTEN, 5), criteria('w-4', WRITTEN, 5), move('w-8', 'open', 5)]],
      [6, [criteria('w-8', WRITTEN, 6)]],
      [7, [move('w-8', 'in_progress', 7), move('w-1', 'closed', 7), move('w-2', 'closed', 7)]],
    ]);
    histories = byId(await readTicketHistories(createCheckedDoltClient().open(dir)));
  }, 120_000);

  const intentOf = (id: string) => analyzeFlow([...histories.values()]).get(id)?.writtenIntent;

  it('oui : des critères écrits avant le démarrage', () => {
    expect(intentOf('w-1')).toBe(true);
  });

  it('non : des critères écrits après le démarrage, en cours de travail', () => {
    expect(intentOf('w-2')).toBe(false);
  });

  it('oui : des critères écrits dans le commit même du démarrage', () => {
    expect(intentOf('w-3')).toBe(true);
  });

  it('non : des critères vidés avant le démarrage, puis remplis en cours de travail', () => {
    expect(intentOf('w-4')).toBe(false);
  });

  it('oui : des critères vidés, puis remplis de nouveau avant le démarrage', () => {
    expect(intentOf('w-5')).toBe(true);
  });

  it('non : des critères faits de blancs, que le Panneau de ticket ne montre pas non plus', () => {
    expect(intentOf('w-6')).toBe(false);
  });

  it('sans objet (null, pas non) : un ticket jamais démarré, même avec des critères', () => {
    expect(intentOf('w-7')).toBeNull();
  });

  it('non : seul le premier démarrage compte, pas un redémarrage après des critères écrits entre-temps', () => {
    expect(intentOf('w-8')).toBe(false);
  });

  it('ne crée aucune Transition : les critères et les notes qui changent sans le statut ne laissent pas d’instantané', () => {
    expect(statusesOf(histories.get('w-2'))).toEqual([
      ['open', on(1)],
      ['in_progress', on(4)],
      ['closed', on(7)],
    ]);
    expect(statusesOf(histories.get('w-5'))?.map(([status]) => status)).toEqual(['open', 'in_progress']);
    expect(statusesOf(histories.get('w-8'))?.map(([status]) => status)).toEqual(['open', 'in_progress', 'open', 'in_progress']);
    expect(statusesOf(histories.get('w-7'))?.map(([status]) => status)).toEqual(['open']);
  });

  it('donne à chaque instantané la présence des critères à son commit, jamais leur texte', () => {
    expect(histories.get('w-8')?.statusSnapshots.map((snapshot) => snapshot.hasAcceptanceCriteria)).toEqual([false, false, false, true]);
    expect(histories.get('w-4')?.statusSnapshots.map((snapshot) => snapshot.hasAcceptanceCriteria)).toEqual([true, false]);
    expect(JSON.stringify([...histories.values()])).not.toContain('graphique');
  });

  it('la porte sur chaque ticket mesuré, démarré ou non', () => {
    const { tickets } = analyzeProject([...histories.values()].map((history) => ({ ...history, title: history.id, priority: 2 })));

    expect(Object.fromEntries(tickets.map(({ id, writtenIntent }) => [id, writtenIntent]))).toEqual({
      'w-1': true,
      'w-2': false,
      'w-3': true,
      'w-4': false,
      'w-5': true,
      'w-6': false,
      'w-7': null,
      'w-8': false,
    });
  });
});

/**
 *   o-1 et o-2 créés au jour 1, dans un schéma sans critères ; o-1 démarre au jour 2
 *   j3  la colonne des critères arrive (une montée de version de bd)
 *   j4  o-2 reçoit des critères       j5  o-2 démarre
 */
describe.skipIf(!hasBinary('dolt'))('Intention écrite : une base dont le schéma n’a pas, ou pas toujours eu, la colonne des critères', { timeout: 120_000 }, () => {
  let env: NodeJS.ProcessEnv;
  beforeAll(() => {
    env = isolatedDoltEnv();
  });
  const script = (): [number, string[]][] => [
    [1, [create('o-1', 1), create('o-2', 1)]],
    [2, [move('o-1', 'in_progress', 2)]],
  ];

  it('lit l’historique d’un schéma sans la colonne, avec les mêmes statuts : l’Intention écrite y est inconnue, ni oui ni non', async () => {
    const dir = await build(env, 'bdesk-written-intent-old-', schema(false), script());

    const histories = await readTicketHistories(createCheckedDoltClient().open(dir));

    expect(histories.map((history) => [history.id, statusesOf(history)])).toEqual([
      ['o-1', [['open', on(1)], ['in_progress', on(2)]]],
      ['o-2', [['open', on(1)]]],
    ]);
    expect(histories.flatMap((history) => history.statusSnapshots).every((snapshot) => !('hasAcceptanceCriteria' in snapshot))).toBe(true);
    expect(analyzeFlow(histories).get('o-1')?.writtenIntent).toBeNull();
  }, 60_000);

  it('dit inconnue un démarrage d’avant la colonne, et lit ceux d’après', async () => {
    const dir = await build(env, 'bdesk-written-intent-added-', schema(false), [
      ...script(),
      [3, ["alter table issues add column acceptance_criteria text not null default ''"]],
      [4, [criteria('o-2', WRITTEN, 4)]],
      [5, [move('o-2', 'in_progress', 5)]],
    ]);

    const histories = byId(await readTicketHistories(createCheckedDoltClient().open(dir)));

    expect(histories.get('o-1')?.statusSnapshots.map((snapshot) => snapshot.hasAcceptanceCriteria)).toEqual([undefined, undefined]);
    expect(histories.get('o-2')?.statusSnapshots.map((snapshot) => snapshot.hasAcceptanceCriteria)).toEqual([undefined, true]);
    const flows = analyzeFlow([...histories.values()]);
    expect(flows.get('o-1')?.writtenIntent).toBeNull();
    expect(flows.get('o-2')?.writtenIntent).toBe(true);
  }, 60_000);
});
