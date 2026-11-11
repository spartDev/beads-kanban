import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dolt, hasBinary, isolatedDoltEnv, type Scratch } from '../testing/dolt-fixture';
import { type SqlServer, startSqlServer } from '../testing/dolt-server';
import { scratchDir } from '../testing/scratch';
import { beadsLikeDatabase, CANARY } from '../testing/stored-sql-fixture';
import { createDoltClient, type DoltDatabase } from './client';
import { readTicketHistories } from './history';
import { readIssueBase, readIssueParts } from './reader';
import { STORED_ROOT_COMMIT, StoredSqlError, withStoredSqlCheck } from './stored-sql';

/**
 * Index fonctionnel (bdesk-38k.74, relecture finale, round 3, B-FI) et grammaire fermée du `CREATE TABLE` (round 3, allowlist). Dolt 2.5.0 range `create index … on t ((expr))` comme
 * une colonne générée *cachée* : son expression s'évalue à chaque lecture de la table (`as of 'HEAD'`, `dolt_history_*` compris), mais ni `information_schema.columns` ni
 * `show full columns` ne la révèlent (toutes deux passaient, avant ce round). Seuls `information_schema.statistics.expression` (working set) et `dolt_schema_diff(...).to_create_statement`
 * confronté à une grammaire fermée (`create-table.ts`, working set, HEAD, et le commit d'ancre d'une époque) la voient.
 *
 *   oracle  `issues`, un index `((from_base64(concat(repeat('A', conv(hex(substr(load_file(canary)),1,3)),16,10)), '!'))))` : l'oracle qui révèle un octet d'un fichier par la position de
 *           l'erreur « illegal base64 data » (mesuré, bdesk-38k.74 round 2/3). Commité : le working set est propre, l'attaque voyage par le remote.
 *   sleep   `issues`, un index `((sleep(8)))` : chaque lecture durerait 8 s de plus si l'expression s'évaluait (huit secondes, pour que la charge de la machine ne rende pas les seuils des essais ambigus).
 *   dirty   `labels`, le même `sleep(2)`, jamais commité : seul `information_schema.statistics` (working set) le voit, pas `dolt_schema_diff` contre HEAD.
 *   era     `dependencies` porte un index fonctionnel `((sleep(2)))` dans son ancien schéma (avant la migration `depends_on_id` → `depends_on_issue_id`, comme bd) ; le schéma courant ne
 *           l'a plus. Seule l'ancre de l'époque (`storedSqlAt`, `dolt_schema_diff` contre ce commit-là) le voit : ni `show columns`, ni `show full tables`.
 *   ck      une contrainte `check (label <> 'POISON' or sleep(0) = 1)` sur `labels` : jamais évaluée à la lecture (Tier 1 ne la voit donc pas), refusée par la grammaire fermée (round 3)
 *           parce qu'un appel de fonction dans un `check` n'est admis par aucune règle de `checkExpr`.
 *   head    `issues` porte, dans HEAD, un index fonctionnel `((sleep(8)))` que le working set, modifié sans commit, a retiré (`drop index`) : `information_schema.statistics` et la première
 *           assertion ne lisent que le working set, ils ne le voient pas ; seul le `CREATE TABLE` de HEAD, que le diagnostic lit avant de retenir ce HEAD (round 4), le dit : la
 *           lecture est refusée avant de partir, sans les 8 s de l'index.
 *   m3      (relecture finale, round 4) un index secondaire qui porte exactement sur les colonnes de la clé primaire (`labels`, `key kl (label, issue_id)` : la clé est `(issue_id, label)`), que `dolt_schema_diff`
 *           omet de son texte alors que `show create table` et `information_schema.statistics` le listent ; et, dans la même base, un index fonctionnel mêlé à des colonnes (`comments`,
 *           `km (id, ((lower(author))))`), que le texte garde : la grammaire fermée le refuse. Une limite connue (ADR 0005), sans conséquence : l'omission ne cache que des colonnes simples.
 *   case    comme `head`, sur une table que HEAD nomme `Labels` : Dolt la lit comme `labels` (`select … from labels`), `dolt_schema_diff` la nomme `Labels` dans une colonne de
 *           collation binaire, et seule la comparaison en `lower(…)` la retrouve (round 4, R1 de la table `dolt_nonlocal_tables` étendue au `CREATE TABLE`).
 *   fk      `dependencies` porte la forme exacte que bd pose réellement (mesuré sur cinq copies de Projets réels) : une clé étrangère `on delete cascade on update cascade`, la
 *           contrainte `ck_dep_one_target`, un défaut `(json_object())` — admise, sans fausse alerte.
 */
const REFUSED = ['oracle', 'sleep', 'dirty', 'ck', 'head', 'case', 'm3'] as const;
const READABLE = ['fk'] as const;
type Scenario = (typeof REFUSED)[number] | (typeof READABLE)[number];
const SCENARIOS: readonly Scenario[] = [...REFUSED, ...READABLE];

/** `((sleep(2)))` : l'index fonctionnel qui ferait durer une lecture 2 s de plus si Dolt évaluait son expression (dirty, era : aucun essai de durée). */
const SLEEP_INDEX = '((sleep(2)))';
/** `((sleep(8)))` : le scénario `sleep`, dont les essais mesurent une durée : 8 s d'un côté, moins de 6 s de l'autre, même quand la machine est chargée. */
const LONG_SLEEP_INDEX = '((sleep(8)))';
/** L'oracle qui révèle, par la position de l'erreur « illegal base64 data », le premier octet du fichier `secret` (bdesk-38k.74, round 2/3 : mesuré avec Dolt 2.5.0). */
const oracleIndex = (secret: string): string => `((from_base64(concat(repeat('A', conv(hex(substr(load_file('${secret.replace(/'/g, "''")}'),1,3)),16,10)), '!'))))`;

describe.skipIf(!hasBinary('dolt')).each([['embedded'], ['server']] as const)(
  'index fonctionnel et grammaire fermée du CREATE TABLE, mode %s (bdesk-38k.74, round 3, B-FI)',
  { timeout: 240_000 },
  (mode) => {
    let env: NodeJS.ProcessEnv;
    let root: string;
    let outside: string;
    let folder: string;
    let server: SqlServer | undefined;

    const dbOf = (name: string) => join(folder, name);
    /** Le fichier que l'oracle lit : celui de la base embedded (que borne `secure_file_priv`), un fichier hors de la base derrière un serveur. */
    const secretOf = (name: string) => (mode === 'embedded' ? join(dbOf(name), 'canary.txt') : join(outside, 'secret.txt'));
    const rows = (name: string, sql: string): string => dolt(env, dbOf(name), 'sql', '-r', 'csv', '-q', sql).trim();
    const direct = (name: string, sql: string): string => dolt(env, dbOf(name), 'sql', '-r', 'json', '-q', sql);

    /** Pose un index fonctionnel sur `table`, en évitant qu'il s'évalue à la création (le fichier n'existe pas encore : `load_file` y rend NULL, jamais une erreur). */
    const withFunctionalIndex = (db: Scratch, secret: string, table: string, expr: string, commit: boolean) => {
      rmSync(secret, { force: true });
      db.sql(`create index fi on ${table} ${expr}`);
      writeFileSync(secret, `${CANARY}\n`);
      if (commit) db.commit(2, 'index fonctionnel');
    };

    const setup: Record<Scenario, (db: Scratch, secret: string) => void> = {
      oracle: (db, secret) => withFunctionalIndex(db, secret, 'issues', oracleIndex(secret), true),
      sleep: (db, secret) => withFunctionalIndex(db, secret, 'issues', LONG_SLEEP_INDEX, true),
      dirty: (db, secret) => withFunctionalIndex(db, secret, 'labels', SLEEP_INDEX, false),
      ck: (db) => {
        db.sql("alter table labels add constraint hostile check (label <> 'POISON' or sleep(0) = 1)");
        db.commit(2, 'un check qui appelle une fonction');
      },
      head: (db, secret) => {
        withFunctionalIndex(db, secret, 'issues', LONG_SLEEP_INDEX, true);
        db.sql('alter table issues drop index fi'); // le working set modifié (jamais commité) retire l'index ; HEAD le porte encore
      },
      m3: (db) => {
        db.sql('alter table labels add key kl (label, issue_id); create index km on comments (id, ((lower(author))))');
        db.commit(2, 'un index sur les colonnes de la clé primaire, un index fonctionnel mêlé à des colonnes');
      },
      case: (db, secret) => {
        db.sql('rename table labels to labels_tmp; rename table labels_tmp to Labels'); // un renommage ne change pas la casse en une seule étape : Dolt la refuse
        db.commit(2, 'la table s’appelle Labels');
        withFunctionalIndex(db, secret, 'Labels', LONG_SLEEP_INDEX, true);
        db.sql('alter table Labels drop index fi');
      },
      fk: (db) => {
        db.sql(
          "alter table dependencies add column depends_on_wisp_id varchar(255); alter table dependencies add column depends_on_external varchar(255); " +
            'alter table dependencies add column metadata json default (json_object()); ' +
            'alter table dependencies add constraint ck_dep_one_target check (((((not(depends_on_issue_id is null)) + (not(depends_on_wisp_id is null))) + (not(depends_on_external is null))) = 1)); ' +
            'alter table dependencies add constraint fk_dep_issue foreign key (issue_id) references issues (id) on delete cascade on update cascade',
        );
        db.commit(2, 'la forme exacte que bd pose (FK, check, défaut json_object())');
      },
    };

    /** L'ancre d'une époque dont le schéma des dépendances porte un index fonctionnel hostile, avant la migration (comme bd, `depends_on_id` → `depends_on_issue_id`). */
    const setupEra = (db: Scratch, secret: string) => {
      db.sql(`drop table dependencies;
        create table dependencies (issue_id varchar(255) not null, depends_on_id varchar(255) not null, type varchar(32) not null default 'blocks',
          created_at datetime not null default current_timestamp, created_by varchar(255) not null, primary key (issue_id, depends_on_id));
        insert into dependencies (issue_id, depends_on_id, created_by) values ('a-2', 'a-1', 'tom')`);
      db.commit(2, 'ancien schéma');
      withFunctionalIndex(db, secret, 'dependencies', SLEEP_INDEX, true); // l'ancre : le dernier commit avant la migration
      db.sql(`alter table dependencies drop index fi;
        alter table dependencies add column depends_on_issue_id varchar(255);
        update dependencies set depends_on_issue_id = depends_on_id;
        alter table dependencies drop primary key;
        alter table dependencies drop column depends_on_id;
        alter table dependencies add column id char(36);
        update dependencies set id = uuid();
        alter table dependencies add primary key (id)`);
      db.commit(4, 'migration');
    };

    beforeAll(async () => {
      env = isolatedDoltEnv();
      root = realpathSync(scratchDir('bdesk-stored-sql-fi-'));
      outside = join(root, 'outside');
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, 'secret.txt'), `${CANARY}\n`);
      folder = mode === 'embedded' ? join(root, 'dbs') : join(root, 'srv', '.beads', 'dolt');
      mkdirSync(folder, { recursive: true });
      for (const name of SCENARIOS) {
        setup[name](beadsLikeDatabase(env, dbOf(name)), secretOf(name));
        await new Promise((resolve) => setImmediate(resolve)); // rendre la main entre deux bases (voir stored-sql.integration.test.ts)
      }
      setupEra(beadsLikeDatabase(env, dbOf('era')), secretOf('era'));
      if (mode === 'server') server = await startSqlServer(env, folder, { databaseDir: dbOf('oracle') });
    }, 600_000);

    afterAll(async () => {
      await server?.stop();
    }, 60_000);

    const checked = (name: string): DoltDatabase => withStoredSqlCheck(createDoltClient({ retries: 0 })).open(dbOf(name));
    /** Les lectures de l'app qui passent par la vérification (clefs nommées : `noUncheckedIndexedAccess` refuserait un `Record<string, …>`). */
    const LABELS = ['tableau', 'fiche', 'historique'] as const;
    const reads = (db: DoltDatabase): Record<(typeof LABELS)[number], () => Promise<unknown>> => ({
      tableau: () => readIssueBase(db),
      fiche: () => readIssueParts(db, 'a-1'),
      historique: () => readTicketHistories(db),
    });
    const outcome = (read: () => Promise<unknown>): Promise<{ value?: unknown; error?: unknown }> =>
      read().then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );

    describe('les faits : ce que Dolt fait sans la vérification', () => {
      it('oracle : l’erreur « illegal base64 » cite une position qui dépend du premier octet du fichier (l’oracle existe)', () => {
        let threw = '';
        try {
          direct('oracle', "select id from issues as of 'HEAD'");
        } catch (err) {
          threw = (err as { message?: string })?.message ?? String(err);
        }
        expect(threw).toMatch(/illegal base64 data at input byte \d+/);
      });

      it('sleep : chaque lecture de `issues` dure 8 s de plus (l’expression s’évalue bien à chaque lecture)', () => {
        const start = Date.now();
        rows('sleep', "select id from issues as of 'HEAD'");
        expect(Date.now() - start).toBeGreaterThan(7000);
      });

      it('aucune des deux assertions existantes ne voit l’index fonctionnel : `information_schema.columns` et `show full columns` restent propres', () => {
        for (const name of ['oracle', 'sleep'] as const) {
          expect(
            rows(name, "select count(*) as n from information_schema.columns where table_schema = database() and table_name = 'issues' and generation_expression <> ''"),
            name,
          ).toBe('n\n0');
          expect(rows(name, "show full columns from issues as of 'HEAD'"), name).not.toMatch(/(VIRTUAL|STORED) GENERATED/i);
        }
      });

      it('`information_schema.statistics.expression` le voit, dans le working set, sans l’évaluer (c’est la base de Tier 1)', () => {
        const start = Date.now();
        const out = rows('sleep', "select table_name, index_name from information_schema.statistics where table_schema = database() and expression <> ''");
        expect(Date.now() - start).toBeLessThan(6000); // sans évaluer l'expression : huit secondes, sinon
        expect(out).toContain('fi');
      });

      it('dirty : non commité, seul `information_schema.statistics` le voit ; `dolt_status` n’est pas vide', () => {
        expect(rows('dirty', 'select count(*) as n from dolt_status')).not.toBe('n\n0');
        expect(rows('dirty', "select count(*) as n from information_schema.statistics where table_schema = database() and table_name = 'labels' and expression <> ''")).toBe('n\n1');
      });

      it('head : le working set modifié n’a plus l’index, que `information_schema.statistics` ne voit donc plus ; mais HEAD le porte, et une lecture `as of \'HEAD\'` l’évalue (8 s de plus)', () => {
        expect(rows('head', 'select count(*) as n from dolt_status')).not.toBe('n\n0');
        expect(rows('head', "select count(*) as n from information_schema.statistics where table_schema = database() and table_name = 'issues' and expression <> ''")).toBe('n\n0');
        const start = Date.now();
        rows('head', "select id from issues as of 'HEAD'");
        expect(Date.now() - start).toBeGreaterThan(7000);
      });

      it('case : la table s’appelle `Labels` ; `from labels` la lit, `dolt_schema_diff` la nomme `Labels` : la comparaison exacte la manque, `lower(…)` la retrouve', () => {
        const root = rows('case', STORED_ROOT_COMMIT).split('\n')[1] ?? '';
        const diff = (where: string) => rows('case', `select to_table_name from dolt_schema_diff('${root}', 'HEAD') where ${where}`);

        expect(rows('case', 'select count(*) as n from labels')).toBe('n\n1');
        expect(diff("to_table_name in ('labels')")).toBe('to_table_name'); // l'en-tête seul : aucune ligne
        expect(diff("lower(to_table_name) in ('labels')")).toBe('to_table_name\nLabels');
      });

      it('m3 : `dolt_schema_diff` omet un index secondaire qui porte exactement sur les colonnes de la clé primaire, que `information_schema.statistics` liste ; un index fonctionnel mêlé à ces colonnes, lui, y figure', () => {
        const root = rows('m3', STORED_ROOT_COMMIT).split('\n')[1] ?? '';
        const text = rows('m3', `select to_create_statement from dolt_schema_diff('${root}', 'HEAD') where to_table_name in ('labels', 'comments')`);

        expect(text).not.toContain('`kl`');
        expect(text).toContain('KEY `km` (`id`,(lower(author)))');
        expect(rows('m3', "select count(*) as n from information_schema.statistics where table_schema = database() and index_name = 'kl'")).toBe('n\n2');
      });

      it('era : l’ancre d’avant la migration porte l’index fonctionnel ; le schéma courant ne l’a plus', () => {
        expect(rows('era', 'show create table dependencies')).not.toMatch(/KEY `fi`/);
      });

      it('ck : la contrainte échoue à l’écriture d’une ligne `POISON`, jamais à la lecture', () => {
        expect(() => dolt(env, dbOf('ck'), 'sql', '-q', "insert into labels (issue_id, label) values ('a-2', 'POISON')")).toThrow();
        expect(rows('ck', "select count(*) as n from labels")).not.toBe('n\n0');
      });
    });

    describe('l’app refuse la base, quelle que soit la lecture', () => {
      it.each(REFUSED)('%s : toutes les lectures sont refusées, sans citer le contenu d’aucun fichier ni le texte de Dolt', async (name) => {
        for (const label of LABELS) {
          const { value, error } = await outcome(reads(checked(name))[label]);

          expect(value, `${name} / ${label}`).toBeUndefined();
          expect(error, `${name} / ${label}`).toBeInstanceOf(StoredSqlError);
          const message = (error as Error).message;
          expect(message).not.toContain(CANARY);
          expect(message).not.toMatch(/illegal base64|sleep|load_file|from_base64/i);
        }
      });

      it('oracle : la raison nomme l’index, pas ce qu’il ferait lire', async () => {
        const error = await outcome(() => reads(checked('oracle')).fiche()).then(({ error: err }) => err as Error);

        expect(error).toBeInstanceOf(StoredSqlError);
        expect(error.message).toContain('index fonctionnel « fi » de « issues »');
      });

      it('sleep : chaque lecture est refusée sans attendre les 8 s de l’expression', async () => {
        const start = Date.now();
        const { error } = await outcome(() => reads(checked('sleep')).fiche());
        expect(Date.now() - start).toBeLessThan(6000);
        expect(error).toBeInstanceOf(StoredSqlError);
      });

      it('dirty : refusée aussi, bien que seul le working set (jamais HEAD) la porte', async () => {
        const { error } = await outcome(() => reads(checked('dirty')).tableau());
        expect(error).toBeInstanceOf(StoredSqlError);
        expect((error as Error).message).toContain('index fonctionnel « fi » de « labels »');
      });

      it.each([
        ['head', 'issues'],
        ['case', 'Labels'],
      ] as const)('%s : l’index n’est que dans HEAD, le working set modifié l’a retiré : la lecture est refusée avant de partir (sans les 8 s), en nommant « %s » « (dans HEAD) »', async (name, table) => {
        const start = Date.now();
        const { value, error } = await outcome(() => reads(checked(name)).fiche());

        expect(Date.now() - start).toBeLessThan(6000); // l'index n'est jamais évalué : ni par la lecture, ni par le diagnostic
        expect(value).toBeUndefined();
        expect(error).toBeInstanceOf(StoredSqlError);
        expect((error as StoredSqlError).objects).toEqual([`« ${table} » (dans HEAD) : colonne générée, index fonctionnel, ou autre construction non admise`]);
        expect((error as Error).message).not.toMatch(/sleep/i);
      });

      it('era : la lecture de l’historique, qui relit l’ancre, est refusée en nommant l’époque, pas le contenu de l’index', async () => {
        const { value, error } = await outcome(() => reads(checked('era')).historique());

        expect(value).toBeUndefined();
        expect(error).toBeInstanceOf(StoredSqlError);
        expect((error as Error).message).toMatch(/époque du commit [0-9a-v]{8}/);
        expect((error as Error).message).not.toMatch(/sleep/i);
      });

      it('era : le tableau et la fiche, qui ne lisent pas l’historique, passent (l’index fonctionnel n’est que dans l’ancre)', async () => {
        const db = checked('era');
        const { error: e1 } = await outcome(() => readIssueBase(db));
        const { error: e2 } = await outcome(() => readIssueParts(db, 'a-1'));
        expect(e1).toBeUndefined();
        expect(e2).toBeUndefined();
      });

      it('ck : la raison ne nomme ni `sleep` ni la contrainte, seulement la table (la grammaire fermée ne distingue pas la construction)', async () => {
        const { error } = await outcome(() => reads(checked('ck')).fiche());
        expect(error).toBeInstanceOf(StoredSqlError);
        expect((error as Error).message).toContain('« labels »');
        expect((error as Error).message).not.toMatch(/sleep|poison/i);
      });
    });

    describe('l’app lit sans fausse alerte', () => {
      it.each(READABLE)('%s : toutes les lectures réussissent et rendent ce que le client sans vérification rend', async (name) => {
        const plain = createDoltClient({ retries: 0 }).open(dbOf(name));
        for (const label of LABELS) {
          const [a, b] = await Promise.all([outcome(reads(checked(name))[label]), outcome(reads(plain)[label])]);
          expect(a.error, `${name} / ${label}`).toBeUndefined();
          expect(JSON.stringify(a.value), `${name} / ${label}`).toBe(JSON.stringify(b.value));
        }
      });
    });
  },
);
