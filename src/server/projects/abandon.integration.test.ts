import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeFlow } from '../../domain/flow';
import { createDoltClient } from '../dolt/client';
import { readTicketHistories } from '../dolt/history';
import { readDependencies, readIssueSummaries } from '../dolt/reader';
import { createDatabase, hasBinary, isolatedDoltEnv } from '../testing/dolt-fixture';
import { scratchDir } from '../testing/scratch';
import { buildIssues } from './issues';

/**
 * L'Abandon lu dans une vraie base Dolt (sans bd) : les liens `duplicates` et `supersedes` que `bd duplicate` et `bd supersede`
 * posent sur le ticket abandonné, lus par `readDependencies`, font un Abandon dans `buildIssues`. Les unités de `issues.test.ts`
 * le prouvent sur des lignes écrites à la main ; ici elles viennent de la table `dependencies` elle-même, dont les lignes ne sont
 * pas rangées dans l'ordre de pose des liens (leur clé est un identifiant), et l'historique des commits de la même base dit aux
 * métriques la même chose. Y compris quand les liens d'un ticket apparaissent au même commit (un lot de bd, un import) :
 * l'historique ne dit plus alors dans quel ordre ils ont été posés, et le `created_at` de leur ligne le dit aux deux.
 */
describe.skipIf(!hasBinary('dolt'))('l’Abandon lu dans une base Dolt', () => {
  let dir: string;

  beforeAll(() => {
    dir = join(realpathSync(scratchDir('bdesk-abandon-')), 'db');
    const db = createDatabase(isolatedDoltEnv(), dir);
    db.sql(`
      create table issues (
        id varchar(255) primary key, title varchar(500) not null, description text not null, design text not null,
        acceptance_criteria text not null, notes text not null, status varchar(32) not null default 'open',
        priority int not null default 2, issue_type varchar(32) not null default 'task', assignee varchar(255),
        created_at datetime not null, updated_at datetime not null, closed_at datetime, close_reason text not null);
      create table dependencies (
        id char(36) primary key, issue_id varchar(255) not null, depends_on_issue_id varchar(255) not null,
        type varchar(32) not null default 'blocks', created_at datetime not null, created_by varchar(255) not null);`);
    const issue = (id: string, type: string, status: string, reason = '') =>
      `insert into issues (id, title, description, design, acceptance_criteria, notes, status, issue_type, created_at, updated_at, closed_at, close_reason)
       values ('${id}', 'Ticket ${id}', '', '', '', '', '${status}', '${type}', '2026-10-01 10:00:00', '2026-10-02 10:00:00',
               ${status === 'closed' ? "'2026-10-02 10:00:00'" : 'null'}, '${reason}')`;
    const link = (from: string, to: string, type: string, id = 'uuid()', created = '2026-10-02 10:00:00') =>
      `insert into dependencies values (${id === 'uuid()' ? id : `'${id}'`}, '${from}', '${to}', '${type}', '${created}', 'tom')`;
    db.sql(
      [
        issue('t-epic', 'epic', 'open'),
        issue('t-livre', 'task', 'closed', 'fait'),
        // Fermés avec le motif que bd écrit, mais c'est le lien qui fait l'Abandon.
        issue('t-doublon', 'task', 'closed', 'Duplicate of t-livre'),
        issue('t-remplace', 'task', 'closed', 'Superseded by t-livre'),
        // Motif identique, aucun lien : une Livraison (seuls les liens comptent).
        issue('t-sans-lien', 'task', 'closed', 'Duplicate of t-livre'),
        issue('t-rouvert', 'task', 'open'),
        issue('t-epic-fermee', 'epic', 'closed'),
        issue('t-remplace-puis-doublon', 'task', 'closed'),
        issue('t-doublon-puis-remplace', 'task', 'closed'),
        issue('t-meme-commit-remplace-puis-doublon', 'task', 'closed'),
        issue('t-meme-commit-doublon-puis-remplace', 'task', 'closed'),
        link('t-livre', 't-epic', 'parent-child'),
        link('t-doublon', 't-livre', 'duplicates'),
        link('t-doublon', 't-epic', 'parent-child'),
        link('t-remplace', 't-livre', 'supersedes'),
        link('t-rouvert', 't-livre', 'duplicates'),
        link('t-epic-fermee', 't-livre', 'duplicates'),
        // Deux liens, le premier posé le 2 octobre, le second le 3 : l'identifiant du premier range sa ligne après celle du second.
        link('t-remplace-puis-doublon', 't-livre', 'supersedes', 'ffffffff-ffff-ffff-ffff-fffffffffff1'),
        link('t-doublon-puis-remplace', 't-livre', 'duplicates', 'ffffffff-ffff-ffff-ffff-fffffffffff2'),
        // Deux liens apparus au même commit, posés avant lui (le 1er octobre, à 12 h puis à 15 h) : la plus petite cible (t-epic) est
        // celle du lien posé en second. Dans l'historique, rien ne les distingue que le created_at de leur ligne.
        link('t-meme-commit-remplace-puis-doublon', 't-livre', 'supersedes', 'uuid()', '2026-10-01 12:00:00'),
        link('t-meme-commit-remplace-puis-doublon', 't-epic', 'duplicates', 'uuid()', '2026-10-01 15:00:00'),
        link('t-meme-commit-doublon-puis-remplace', 't-livre', 'duplicates', 'uuid()', '2026-10-01 12:00:00'),
        link('t-meme-commit-doublon-puis-remplace', 't-epic', 'supersedes', 'uuid()', '2026-10-01 15:00:00'),
      ].join(';\n'),
    );
    db.commit(2, 'abandons');
    db.sql(
      [
        link('t-remplace-puis-doublon', 't-epic', 'duplicates', '00000000-0000-0000-0000-000000000001', '2026-10-03 10:00:00'),
        link('t-doublon-puis-remplace', 't-epic', 'supersedes', '00000000-0000-0000-0000-000000000002', '2026-10-03 10:00:00'),
      ].join(';\n'),
    );
    db.commit(3, 'seconds liens');
  }, 60_000);

  async function currentIssues() {
    const database = createDoltClient().open(dir);
    return buildIssues(await readIssueSummaries(database), await readDependencies(database));
  }

  it('lit un doublon et un ticket remplacé depuis les lignes de la table des dépendances, avec leur cible', async () => {
    const issues = new Map((await currentIssues()).map((issue) => [issue.id, issue]));

    expect(issues.get('t-doublon')?.abandon).toEqual({ cause: 'duplicate', of: 't-livre' });
    expect(issues.get('t-remplace')?.abandon).toEqual({ cause: 'superseded', of: 't-livre' });
  });

  it('ne fait un Abandon ni d’une Livraison, ni d’un ticket sans lien même fermé « Duplicate of … », ni d’un ticket rouvert, ni d’une Epic', async () => {
    const issues = new Map((await currentIssues()).map((issue) => [issue.id, issue]));

    for (const id of ['t-livre', 't-sans-lien', 't-rouvert', 't-epic', 't-epic-fermee']) {
      expect(issues.get(id), id).not.toHaveProperty('abandon');
    }
  });

  it('garde le lien parent-enfant d’un Abandon : il reste un Enfant de son Epic', async () => {
    const issues = new Map((await currentIssues()).map((issue) => [issue.id, issue]));

    expect(issues.get('t-doublon')).toMatchObject({ parentId: 't-epic', status: 'closed' });
  });

  it('retient le premier lien posé, d’après le created_at de sa ligne, bien que la table rende d’abord celle du second', async () => {
    const dependencies = await readDependencies(createDoltClient().open(dir));
    const rowsOf = (id: string) => dependencies.filter((d) => d.from === id).map((d) => d.type);
    // La précondition de l'essai : la table range les lignes par identifiant, le lien posé en second vient avant le premier.
    expect(rowsOf('t-remplace-puis-doublon')).toEqual(['duplicates', 'supersedes']);
    expect(rowsOf('t-doublon-puis-remplace')).toEqual(['supersedes', 'duplicates']);

    const issues = new Map((await currentIssues()).map((issue) => [issue.id, issue]));

    expect(issues.get('t-remplace-puis-doublon')?.abandon).toEqual({ cause: 'superseded', of: 't-livre' });
    expect(issues.get('t-doublon-puis-remplace')?.abandon).toEqual({ cause: 'duplicate', of: 't-livre' });
  }, 60_000);

  it('dit la même chose que les métriques, qui lisent l’historique des commits de la même base : la même cause', async () => {
    const flows = analyzeFlow(await readTicketHistories(createDoltClient().open(dir)));
    const issues = (await currentIssues()).filter((issue) => issue.status === 'closed' && issue.type !== 'epic');

    expect(issues.map((issue) => issue.id).sort()).toEqual([
      't-doublon',
      't-doublon-puis-remplace',
      't-livre',
      't-meme-commit-doublon-puis-remplace',
      't-meme-commit-remplace-puis-doublon',
      't-remplace',
      't-remplace-puis-doublon',
      't-sans-lien',
    ]);
    for (const issue of issues) {
      const outcome = flows.get(issue.id)?.outcome;
      if (outcome?.kind === 'abandoned') expect(issue.abandon?.cause, issue.id).toBe(outcome.cause);
      else expect(issue.abandon, issue.id).toBeUndefined();
    }
    expect(flows.get('t-remplace-puis-doublon')?.outcome).toMatchObject({ kind: 'abandoned', cause: 'superseded' });
    expect(flows.get('t-doublon-puis-remplace')?.outcome).toMatchObject({ kind: 'abandoned', cause: 'duplicate' });
  }, 60_000);

  it('départage par le created_at de leur ligne deux liens apparus au même commit, au kanban comme dans les métriques', async () => {
    const flows = analyzeFlow(await readTicketHistories(createDoltClient().open(dir)));
    const issues = new Map((await currentIssues()).map((issue) => [issue.id, issue]));

    // Le lien posé en premier fait la cause, bien que sa cible (t-livre) soit la plus grande : la même cause, vers la même cible.
    expect(issues.get('t-meme-commit-remplace-puis-doublon')?.abandon).toEqual({ cause: 'superseded', of: 't-livre' });
    expect(flows.get('t-meme-commit-remplace-puis-doublon')?.outcome).toMatchObject({ kind: 'abandoned', cause: 'superseded', of: 't-livre' });
    expect(issues.get('t-meme-commit-doublon-puis-remplace')?.abandon).toEqual({ cause: 'duplicate', of: 't-livre' });
    expect(flows.get('t-meme-commit-doublon-puis-remplace')?.outcome).toMatchObject({ kind: 'abandoned', cause: 'duplicate', of: 't-livre' });
  }, 60_000);
});
