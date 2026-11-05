import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Config } from '../config';
import { createDoltClient, type DoltClient } from '../dolt/client';
import { createDatabase, hasBinary, isolatedDoltEnv, type Scratch } from '../testing/dolt-fixture';
import { type SqlServer, startSqlServer } from '../testing/dolt-server';
import { type Discovery, discoverProjects } from './discovery';

/**
 * Le scan incrémental des Projets (bdesk-38k.43) sur de vraies bases Dolt : ce que `incremental.test.ts` suppose des fichiers d'une base, ici
 * vérifié avec le `dolt` installé. Ce sont les hypothèses qui font le scan incrémental, et qu'une autre version de Dolt pourrait casser :
 *
 *  - lire une base (ce que fait l'app toute la journée : le HEAD, une fiche, le préfixe) ne change pas son empreinte ;
 *  - le lecteur qui rattrape l'index du journal (`journal.idx`, en retard sur le journal) en change la taille sans que la base ait changé : cette
 *    taille n'est pas dans l'empreinte ;
 *  - écrire dans une base embedded (bd), avec ou sans commit, la change ;
 *  - écrire par un `dolt sql-server` (mode server) la change aussi, alors que le manifest, lui, ne bouge pas : une empreinte qui ne serait que
 *    celle du manifest (la date comme le contenu) laisserait un préfixe renommé périmé.
 *
 * Sans `dolt` dans le PATH ces tests sont sautés, avec un avertissement (voir CLAUDE.md).
 */

const env = isolatedDoltEnv();

/** Une racine de Projets à part pour chaque test : un scan ne voit que ses propres bases. */
function sandbox(): { root: string; config: Config } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bdesk-incremental-dolt-')));
  return { root, config: { roots: [root], projects: [], hiddenProjects: [] } };
}

/** Le Projet `name` : `.beads/metadata.json` et une vraie base Dolt, dont le préfixe est `aaa`, commitée. */
function workspace(root: string, name: string, mode: 'embedded' | 'server'): { scratch: Scratch; database: string } {
  const beads = join(root, name, '.beads');
  mkdirSync(beads, { recursive: true });
  writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: mode, dolt_database: 'db' }));
  const database = join(beads, mode === 'embedded' ? 'embeddeddolt' : 'dolt', 'db');
  const scratch = createDatabase(env, database);
  scratch.sql("create table config (`key` varchar(255) primary key, value text not null); insert into config values ('issue_prefix', 'aaa')");
  scratch.commit(1, 'init');
  return { scratch, database };
}

/** Le vrai client dolt, qui compte les lectures de préfixe qu'il envoie. */
function countingDolt() {
  const real = createDoltClient();
  const counter = { prefixReads: 0 };
  const client: DoltClient = {
    open: (dir) => {
      const db = real.open(dir);
      return {
        dir,
        query: (sql, options) => {
          if (sql.includes("'issue_prefix'")) counter.prefixReads++;
          return db.query(sql, options);
        },
      };
    },
  };
  return { client, counter };
}

const prefixOf = (discovery: Discovery, name: string) => discovery.projects.find((p) => p.name === name)?.prefix;

describe.skipIf(!hasBinary('dolt'))('le scan incrémental sur de vraies bases Dolt (bdesk-38k.43)', () => {
  it('mode embedded : lire la base ne change pas son empreinte ; l’écrire, avec ou sans commit, la change', async () => {
    const { root, config } = sandbox();
    const { scratch, database } = workspace(root, 'emb', 'embedded');
    const { client, counter } = countingDolt();

    const first = await discoverProjects(config, { dolt: client });
    expect(prefixOf(first, 'emb')).toBe('aaa');
    expect(counter.prefixReads).toBe(1);

    // ce que l'app lit toute la journée : le HEAD (sonde du direct), le préfixe lui-même, une requête quelconque. Chaque lecture de dolt
    // réécrit la date de manifest, de journal.idx et du journal : aucune n'en change le contenu.
    const app = createDoltClient().open(database);
    for (let i = 0; i < 3; i++) await app.query("select hashof('HEAD') as head", { lane: 'light' });
    await app.query("select `value` from config where `key` = 'issue_prefix'", { lane: 'discovery' });
    await app.query('select count(*) as n from config');
    const second = await discoverProjects(config, { dolt: client, previous: first });
    expect(counter.prefixReads).toBe(1); // pas relu : ni nos lectures ni le scan ne l'ont changé

    scratch.sql("update config set `value` = 'bbb' where `key` = 'issue_prefix'"); // bd rename-prefix, dans le working set, sans commit
    const third = await discoverProjects(config, { dolt: client, previous: second });
    expect(counter.prefixReads).toBe(2);
    expect(prefixOf(third, 'emb')).toBe('bbb');

    scratch.commit(2, 'renommage'); // le commit change la base à son tour : relue, pour le même préfixe
    const fourth = await discoverProjects(config, { dolt: client, previous: third });
    expect(counter.prefixReads).toBe(3);
    expect(prefixOf(fourth, 'emb')).toBe('bbb');

    const fifth = await discoverProjects(config, { dolt: client, previous: fourth });
    expect(counter.prefixReads).toBe(3); // et plus rien n'a changé
    expect(prefixOf(fifth, 'emb')).toBe('bbb');
  }, 120_000);

  it('mode embedded : le lecteur qui rattrape un index de journal en retard (journal.idx) ne fait pas relire la base', async () => {
    const { root, config } = sandbox();
    const { database } = workspace(root, 'idx', 'embedded');
    const index = join(database, '.dolt', 'noms', 'journal.idx');
    const before = statSync(index).size;
    truncateSync(index, Math.floor(before / 2)); // l'index retarde sur le journal : un processus interrompu, un serveur qui ne l'écrit pas à chaque commit
    const { client, counter } = countingDolt();

    const first = await discoverProjects(config, { dolt: client }); // l'empreinte est prise, puis dolt ouvre la base et reconstruit l'index
    expect(counter.prefixReads).toBe(1);
    expect(statSync(index).size).not.toBe(Math.floor(before / 2)); // la lecture l'a bien réécrit

    const second = await discoverProjects(config, { dolt: client, previous: first });
    expect(counter.prefixReads).toBe(1); // et ce n'est pas une écriture : la base n'est pas relue
    expect(prefixOf(second, 'idx')).toBe('aaa');
  }, 120_000);

  describe('mode server : une base tenue par un dolt sql-server', () => {
    let server: SqlServer | undefined;

    // Le serveur d'essai de ce test, jamais un processus de l'app : `startSqlServer` (bdesk-38k.44) le lance sous un superviseur qui ne lui survit pas.
    afterAll(() => server?.stop(), 60_000);

    it('une écriture par le serveur change l’empreinte, alors que le manifest ne bouge pas : la base est relue', async () => {
      const { root, config } = sandbox();
      const { database } = workspace(root, 'srv', 'server');
      const dataDir = join(database, '..'); // `.beads/dolt` : le dossier qui contient la base `db` et que le serveur sert
      const running = await startSqlServer(env, dataDir, { databaseDir: database }); // ne rend la main que quand le serveur répond, et que `dolt sql` y passe
      server = running;
      const viaServer = (sql: string) =>
        execFileSync('dolt', ['--host', '127.0.0.1', '--port', String(running.port), '--no-tls', '--user', 'root', '--password', '', '--use-db', 'db', 'sql', '-q', sql], {
          cwd: dataDir,
          env: { ...env, DOLT_CLI_PASSWORD: '' },
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 60_000,
        });

      const { client, counter } = countingDolt();
      const first = await discoverProjects(config, { dolt: client });
      expect(prefixOf(first, 'srv')).toBe('aaa');
      const reads = counter.prefixReads;
      const same = await discoverProjects(config, { dolt: client, previous: first });
      expect(counter.prefixReads).toBe(reads); // rien n'a changé : pas relu

      viaServer("update config set `value` = 'ccc' where `key` = 'issue_prefix'");
      const renamed = await discoverProjects(config, { dolt: client, previous: same });

      expect(counter.prefixReads).toBe(reads + 1);
      expect(prefixOf(renamed, 'srv')).toBe('ccc');
    }, 240_000);
  });
});
