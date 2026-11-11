import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProjectService } from '../projects/service';
import { createDatabase, hasBinary, isolatedDoltEnv, type Scratch } from '../testing/dolt-fixture';
import { type SqlServer, startSqlServer } from '../testing/dolt-server';
import { scratchDir } from '../testing/scratch';
import { beadsLikeDatabase, outfile } from '../testing/stored-sql-fixture';
import { createDoltClient, type DoltDatabase, queryAll } from './client';
import { DoltQueryError } from './errors';
import { readTicketHistories } from './history';
import { readIssueBase, readIssueParts, readIssuePrefix } from './reader';
import { StoredSqlError, withStoredSqlCheck } from './stored-sql';

/**
 * La vérification ne lit que la base qu'elle vérifie (bdesk-38k.74, relecture finale, round 4 : « `culpritDatabase` lit une base voisine sans la vérification »).
 *
 * Derrière un `dolt sql-server` que bd lance sans `secure_file_priv`, plusieurs bases partagent le même serveur. Jusqu'à ce round, quand Dolt refusait une instruction de la vérification, `guarded`
 * cherchait une base voisine responsable (R5 du round 3) et lançait contre chacune d'elles, par le client brut, donc sans la vérification, `` select count(*) from `<voisine>`.dolt_nonlocal_tables ``.
 * Or une base voisine peut définir une **vue** qui porte ce nom (Dolt l'accepte : elle masque la table système), et lire une vue en exécute le corps : ici `dolt_query_diff('select … into outfile …')`,
 * qui écrit un fichier hors de toute base. La recherche est supprimée (R5 retirée, sans chercher à la sécuriser) : la raison est le message fixe, rien de plus.
 *
 *   srv-culprit  un serveur, trois bases, celles du relecteur :
 *     tdb   un Projet sain ;
 *     evil  dont `dolt_nonlocal_tables` mène `dolt_schemas` vers une table ordinaire : Dolt ne sait plus résoudre une vue (« expected a SchemaTable »), donc refuse une instruction de la vérification
 *           de `tdb`, ce qui déclenchait la recherche (c'était le déclencheur de R5) ;
 *     aaa   (avant `evil` dans l'ordre alphabétique des bases, donc sondée la première) dont une vue `dolt_nonlocal_tables` écrit `PWNED-BY-STORED-SQL` dans `outside/pwned.txt`.
 *   srv-names    un serveur sain, deux bases : `tdb`, et `zzz` dont chaque vue porte le nom d'un objet que la vérification ou l'app lit (`dolt_nonlocal_tables`, `dolt_schemas`, `dolt_status`,
 *                `dolt_log`, `issues`, `tables`, `columns`, `statistics`…) et écrit son propre fichier dans `outside/`. Aucune ne s'exécute : la résolution d'un nom, dans la session de `tdb`,
 *                n'atteint jamais `zzz` (seule une référence qualifiée par `` `zzz`. `` le ferait, et la vérification n'en écrit plus aucune).
 */
const PWNED = 'PWNED-BY-STORED-SQL';

/** Chaque nom que la vérification (stored-sql.ts, history.ts) ou le lecteur (reader.ts) résout, un à un : les objets d'`information_schema` compris. Dolt les accepte tous pour une vue (mesuré). */
const NAMES = [
  'dolt_nonlocal_tables',
  'dolt_schemas',
  'dolt_status',
  'dolt_log',
  'dolt_commit_ancestors',
  'dolt_history_issues',
  'dolt_history_dependencies',
  'dolt_ignore',
  'issues',
  'dependencies',
  'labels',
  'comments',
  'config',
  'tables',
  'columns',
  'statistics',
  'schemata',
  'views',
] as const;

describe.skipIf(!hasBinary('dolt'))('une base voisine sur le même serveur (bdesk-38k.74, round 4)', { timeout: 240_000 }, () => {
  let env: NodeJS.ProcessEnv;
  let root: string;
  let outside: string;
  let culpritProjects: string;
  let culpritFolder: string;
  let namesFolder: string;
  let culpritServer: SqlServer | undefined;
  let namesServer: SqlServer | undefined;

  const pwned = () => join(outside, 'pwned.txt');
  /** Les fichiers écrits hors de toute base : aucun, tant que la vérification n'exécute rien d'une base voisine. */
  const written = () => readdirSync(outside).sort();
  const dbOf = (folder: string, name: string) => join(folder, name);
  const checked = (folder: string, name: string): DoltDatabase => withStoredSqlCheck(createDoltClient({ retries: 0 })).open(dbOf(folder, name));
  const plain = (folder: string, name: string): DoltDatabase => createDoltClient({ retries: 0 }).open(dbOf(folder, name));
  const outcome = (read: () => Promise<unknown>): Promise<{ value?: unknown; error?: unknown }> =>
    read().then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
  const reads = (db: DoltDatabase): Record<string, () => Promise<unknown>> => ({
    préfixe: () => readIssuePrefix(db),
    tableau: () => readIssueBase(db),
    fiche: () => readIssueParts(db, 'a-1'),
    historique: () => readTicketHistories(db),
  });

  /** Une base sans table de bd : seulement ce que son SQL pose (le serveur la sert comme les autres). */
  const bare = (folder: string, name: string): Scratch => createDatabase(env, dbOf(folder, name));

  beforeAll(async () => {
    env = isolatedDoltEnv();
    root = realpathSync(scratchDir('bdesk-stored-sql-neighbour-'));
    outside = join(root, 'outside'); // hors de toute base : le serveur, sans `secure_file_priv`, y écrit si une vue le lui demande
    mkdirSync(outside, { recursive: true });

    // 1. Les trois bases du relevé du relecteur, dans la disposition d'un Projet en mode server (`<projet>/.beads/dolt/<base>`), que le service des Projets sait lire.
    culpritProjects = join(root, 'projets-culprit');
    const beads = join(culpritProjects, 'tdb', '.beads');
    culpritFolder = join(beads, 'dolt');
    mkdirSync(culpritFolder, { recursive: true });
    writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'server', dolt_database: 'tdb' }));
    beadsLikeDatabase(env, dbOf(culpritFolder, 'tdb'));
    const evil = bare(culpritFolder, 'evil');
    evil.sql(
      "create table zz (id int primary key, name varchar(64), type varchar(64), fragment text, extra json, sql_mode varchar(256)); insert into zz (id) values (1); insert into dolt_nonlocal_tables values ('dolt_schemas', 'main', 'zz', 'immediate')",
    );
    evil.commit(2, 'dolt_schemas menée vers une table ordinaire');
    const aaa = bare(culpritFolder, 'aaa');
    aaa.sql(`create view dolt_nonlocal_tables as select * from dolt_query_diff('select ''${PWNED}'' as v into outfile ''${pwned()}''', 'select 1 as v')`);
    aaa.commit(2, 'une vue qui porte le nom de la table système');

    // 2. Un serveur sain dont une base voisine porte, en vue, chacun des noms que l'app lit.
    namesFolder = join(root, 'srv-names', '.beads', 'dolt');
    mkdirSync(namesFolder, { recursive: true });
    beadsLikeDatabase(env, dbOf(namesFolder, 'tdb'));
    const zzz = bare(namesFolder, 'zzz');
    zzz.sql(NAMES.map((name) => `create view \`${name}\` as select * from ${outfile(join(outside, `${name}.txt`))}`).join('; '));
    zzz.commit(2, 'une vue par nom que l’app lit');

    // Ce que le test mesure, c'est ce que la LECTURE de l'app écrit, à partir d'un dossier vide (créer une vue ne lit pas son corps : mesuré, aucun fichier ici).
    for (const file of readdirSync(outside)) rmSync(join(outside, file), { force: true });

    culpritServer = await startSqlServer(env, culpritFolder, { databaseDir: dbOf(culpritFolder, 'tdb') });
    namesServer = await startSqlServer(env, namesFolder, { databaseDir: dbOf(namesFolder, 'tdb') });
  }, 600_000);

  afterAll(async () => {
    await culpritServer?.stop();
    await namesServer?.stop();
  }, 60_000);

  describe('srv-culprit : une instruction de la vérification que Dolt refuse', () => {
    it('avant l’app, le fichier est absent', () => {
      expect(existsSync(pwned())).toBe(false);
      expect(written()).toEqual([]);
    });

    it('`tdb`, saine, est refusée par le message fixe de la vérification : aucune base voisine n’est nommée', async () => {
      for (const [label, read] of Object.entries(reads(checked(culpritFolder, 'tdb')))) {
        const { value, error } = await outcome(read);

        expect(value, label).toBeUndefined();
        expect(error, label).toBeInstanceOf(DoltQueryError);
        expect(error, label).not.toBeInstanceOf(StoredSqlError);
        const message = (error as Error).message;
        expect(message, label).toBe(
          "La vérification du SQL stocké n'a pas pu s'achever : Dolt a refusé l'une de ses propres requêtes, dont le message n'est pas repris (il pourrait citer ce que la base lui fait lire). La base n'est pas lue.",
        );
        expect(message, label).not.toContain(PWNED);
      }
    });

    it('aucun fichier n’est écrit hors de toute base : la vue de `aaa` n’a jamais été lue', () => {
      expect(existsSync(pwned())).toBe(false);
      expect(written()).toEqual([]);
    });

    it('de même par le service des Projets, tel que l’app le construit : le Projet est illisible, sa raison ne nomme personne, et rien n’est écrit', async () => {
      const projects = createProjectService({ roots: [culpritProjects], projects: [], hiddenProjects: [] }, { rescanIntervalMs: 0 });

      const { projects: list } = await projects.list();
      const project = list.find((p) => p.id === 'tdb');
      const error = await projects.histories('tdb').then(
        () => undefined,
        (err: unknown) => err,
      );

      expect(project?.status).toBe('unreadable');
      expect(project?.reason).toContain("La vérification du SQL stocké n'a pas pu s'achever");
      expect(project?.reason).not.toMatch(/evil|aaa|semble la cause/);
      expect(error).toBeDefined();
      expect(existsSync(pwned())).toBe(false);
      expect(written()).toEqual([]);
    });

    // Le fait que le test garde : sans la vérification, la lecture QUALIFIÉE de la vue d'une base voisine, que faisait la recherche, écrit le fichier. Il vient en dernier, et le nettoie.
    it('les faits : lire `aaa`.dolt_nonlocal_tables par le client brut exécute sa vue et écrit le fichier (ce que faisait `culpritDatabase`)', async () => {
      await queryAll(plain(culpritFolder, 'tdb'), ['select count(*) as c from `aaa`.dolt_nonlocal_tables']).catch(() => undefined);

      expect(existsSync(pwned())).toBe(true);
      rmSync(pwned(), { force: true });
    });
  });

  describe('srv-names : une base voisine dont chaque vue porte le nom d’un objet que l’app lit', () => {
    it('`tdb` se lit comme sans la vérification, et aucune des vues de `zzz` ne s’exécute', async () => {
      const withCheck = reads(checked(namesFolder, 'tdb'));
      const without = reads(plain(namesFolder, 'tdb'));

      for (const label of Object.keys(withCheck)) {
        const a = await outcome(withCheck[label] ?? (() => Promise.reject(new Error('manque'))));
        const b = await outcome(without[label] ?? (() => Promise.reject(new Error('manque'))));

        expect(a.error, `tdb / ${label}`).toBeUndefined();
        expect(b.error, `tdb / ${label} sans vérification`).toBeUndefined();
        expect(JSON.stringify(a.value), `tdb / ${label}`).toBe(JSON.stringify(b.value));
      }
      expect(written()).toEqual([]);
    });
  });
});
