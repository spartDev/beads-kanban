import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDoltClient, DoltNotFoundError, DoltQueryError, parseDoltDate, sqlIdent, sqlString } from './client';
import { ReadOnlyViolation } from './read-only';

const LOCKED = 'database "beads" is locked by another dolt process; either clone the database to run a second server';

/** Un faux binaire `dolt` : script shell qui rejoue `body`, avec un compteur d'appels dans `calls`. */
function fakeDolt(body: string): { binary: string; dir: string; calls: () => number } {
  const dir = mkdtempSync(join(tmpdir(), 'bdesk-fake-dolt-'));
  const counter = join(dir, 'calls');
  const binary = join(dir, 'dolt');
  writeFileSync(binary, `#!/bin/sh\necho x >> '${counter}'\nn=$(wc -l < '${counter}' | tr -d ' ')\n${body}\n`);
  chmodSync(binary, 0o755);
  const calls = () => (existsSync(counter) ? readFileSync(counter, 'utf8').split('\n').filter(Boolean).length : 0);
  return { binary, dir, calls };
}

const options = (binary: string) => ({ binary, retryDelayMs: 1, rootPath: join(tmpdir(), 'bdesk-fake-dolt-root') });

describe.skipIf(process.platform === 'win32')('client dolt', () => {
  const empty = fakeDolt(`echo '{"rows": []}'`);
  const emptyDb = () => createDoltClient(options(empty.binary)).open(empty.dir);

  it('renvoie les lignes de la sortie JSON, sans les colonnes NULL', async () => {
    const fake = fakeDolt(`echo '{"rows": [{"id": "a-1", "priority": 2}, {"id": "a-2"}]}'`);
    const db = createDoltClient(options(fake.binary)).open(fake.dir);

    expect(await db.query('select id, priority from issues')).toEqual([{ id: 'a-1', priority: 2 }, { id: 'a-2' }]);
  });

  it('passe la requête à `dolt sql` depuis le dossier de la base', async () => {
    const fake = fakeDolt(`echo "{\\"rows\\": [{\\"cwd\\": \\"$(pwd -P)\\", \\"args\\": \\"$*\\"}]}"`);
    const db = createDoltClient(options(fake.binary)).open(fake.dir);

    const [row] = await db.query('select 1');

    // Chaque appel commence par une transaction en lecture seule : Dolt refuse alors toute écriture de données.
    expect(row?.args).toBe('sql -r json -q start transaction read only; select 1');
    expect(row?.cwd).toMatch(/bdesk-fake-dolt-/);
  });

  describe('sortie de dolt', () => {
    // Sortie réelle de `dolt sql -r json` précédé de `start transaction read only` : un document vide, puis le résultat.
    it('ignore le document vide de la transaction et lit le résultat, valeurs pleines d’accolades et de guillemets comprises', async () => {
      const fake = fakeDolt(`cat <<'EOF'
{}

{"rows": [{"a": 1}, {"title": "x } \\" { y"}]}
EOF`);
      const db = createDoltClient(options(fake.binary)).open(fake.dir);

      expect(await db.query('select a, title from t')).toEqual([{ a: 1 }, { title: 'x } " { y' }]);
    });

    it('renvoie une liste vide quand la requête ne trouve aucune ligne', async () => {
      const fake = fakeDolt(`printf '{}\\n\\n{}\\n\\n'`);
      const db = createDoltClient(options(fake.binary)).open(fake.dir);

      expect(await db.query('select a from t where a = 99')).toEqual([]);
    });

    it('signale une sortie qui n’est pas du JSON', async () => {
      const fake = fakeDolt(`echo 'pas du json'`);
      const db = createDoltClient(options(fake.binary)).open(fake.dir);

      const error = await db.query('select 1').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DoltQueryError);
      expect((error as Error).message).toContain('Sortie de dolt illisible');
    });

    it('signale une sortie JSON tronquée', async () => {
      const fake = fakeDolt(`printf '{}\\n\\n{"rows": [{"a": 1}'`);
      const db = createDoltClient(options(fake.binary)).open(fake.dir);

      await expect(db.query('select 1')).rejects.toThrow('Sortie de dolt illisible');
    });
  });

  it('retente quand la base est verrouillée par un autre processus, puis aboutit', async () => {
    const fake = fakeDolt(`if [ "$n" -le 2 ]; then echo '${LOCKED}' >&2; exit 1; fi\necho '{"rows": [{"ok": 1}]}'`);
    const db = createDoltClient(options(fake.binary)).open(fake.dir);

    expect(await db.query('select 1')).toEqual([{ ok: 1 }]);
    expect(fake.calls()).toBe(3);
  });

  it('renonce après le nombre de tentatives prévu et signale le verrou', async () => {
    const fake = fakeDolt(`echo '${LOCKED}' >&2; exit 1`);
    const db = createDoltClient({ ...options(fake.binary), retries: 2 }).open(fake.dir);

    const error = await db.query('select 1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DoltQueryError);
    expect((error as DoltQueryError).locked).toBe(true);
    expect((error as Error).message).toContain('locked by another dolt process');
    expect(fake.calls()).toBe(3);
  });

  it('ne retente pas une erreur qui n’est pas un verrou', async () => {
    const fake = fakeDolt(`echo 'table not found: config' >&2; exit 1`);
    const db = createDoltClient(options(fake.binary)).open(fake.dir);

    await expect(db.query('select * from config')).rejects.toThrow('table not found: config');
    expect(fake.calls()).toBe(1);
  });

  // Une erreur du client sort toujours typée, et son message (qui part dans la réponse HTTP) ne reprend pas la requête.
  describe('échecs d’exécution', () => {
    const SQL = "select id from issues where id = 'a-1'";
    const failure = (binary: string, sql = SQL) => createDoltClient(options(binary)).open(tmpdir()).query(sql).catch((e: unknown) => e);
    /** Ce qui trahit la requête dans un message : un de ses mots, sa table, ou la transaction qui la précède. */
    const QUERY_TRACE = /select|issues|read only/i;

    it('signale un octet nul dans la requête par une DoltQueryError, sans lancer dolt : execFile lèverait une TypeError citant la requête', async () => {
      const before = empty.calls();

      const error = await failure(empty.binary, "select 'a\u0000b' from issues");

      expect(error).toBeInstanceOf(DoltQueryError);
      expect((error as Error).message).toContain('octet nul');
      expect((error as Error).message).not.toMatch(QUERY_TRACE);
      expect((error as Error).cause).toBeInstanceOf(TypeError); // l'erreur d'origine reste à qui débogue
      expect(empty.calls()).toBe(before);
    });

    it('type de même un refus de lancer le processus qui ne tient pas à la requête (ici, un octet nul dans le chemin du binaire)', async () => {
      const error = await failure('/usr/bin/do\u0000lt');

      expect(error).toBeInstanceOf(DoltQueryError);
      expect((error as Error).message).not.toMatch(QUERY_TRACE);
    });

    it('type une requête trop longue pour la ligne de commande (E2BIG), sans lancer dolt', async () => {
      const before = empty.calls();

      const error = await failure(empty.binary, `select '${'x'.repeat(2 * 1024 * 1024)}'`);

      expect(error).toBeInstanceOf(DoltQueryError);
      expect((error as Error).message).not.toContain('xxxx');
      expect(empty.calls()).toBe(before);
    });

    it('ne reprend pas la requête quand dolt s’arrête sans rien dire : seul le code de sortie est donné', async () => {
      const error = await failure(fakeDolt('exit 3').binary);

      expect(error).toBeInstanceOf(DoltQueryError);
      expect((error as Error).message).toContain('code de sortie 3');
      expect((error as Error).message).not.toMatch(QUERY_TRACE);
    });

    it('ne reprend pas la requête quand dolt est interrompu par un signal : seul le signal est donné', async () => {
      const error = await failure(fakeDolt('kill -9 $$').binary);

      expect(error).toBeInstanceOf(DoltQueryError);
      expect((error as Error).message).toContain('SIGKILL');
      expect((error as Error).message).not.toMatch(QUERY_TRACE);
    });

    it('ne reprend pas ce que dolt a écrit sur stdout (le {} de la transaction, des lignes de résultat) : ce n’est pas un message', async () => {
      const error = await failure(fakeDolt(`echo '{}'; echo '{"rows": [{"titre": "confidentiel"}]}'; kill -9 $$`).binary);

      expect(error).toBeInstanceOf(DoltQueryError);
      expect((error as Error).message).toContain('SIGKILL');
      expect((error as Error).message).not.toMatch(/confidentiel|\{\}/);
    });

    it('garde la cause d’un échec, et non la requête que dolt répète avant elle', async () => {
      // Dolt écrit « error on line 1 for query <requête> : <cause> » : sur une requête de plusieurs lignes, la
      // cause vient après les lignes que l'on garde. Ce faux dolt répète la requête reçue, comme le vrai.
      const fake = fakeDolt(
        `printf 'error on line 1 for query %s: WITH RECURSIVE iteration limit exceeded\\n' "\${5#start transaction read only; }" >&2\nexit 1`,
      );

      const error = await failure(fake.binary, 'select a,\n  b\n  from table_secrete\n  where c = 1');

      expect(error).toBeInstanceOf(DoltQueryError);
      expect((error as Error).message).toContain('WITH RECURSIVE iteration limit exceeded');
      expect((error as Error).message).not.toContain('table_secrete');
    });

    it('retire aussi la requête terminée par un point-virgule, que Dolt cite sans lui', async () => {
      // Comme le vrai, ce faux dolt retire le `;` final de l'instruction qu'il cite : « select 1; » devient « select 1 ».
      const fake = fakeDolt(
        `q="\${5#start transaction read only; }"\nq="\${q%;}"\nprintf 'error on line 1 for query %s: WITH RECURSIVE iteration limit exceeded\\n' "$q" >&2\nexit 1`,
      );

      const error = await failure(fake.binary, 'select a,\n  b\n  from table_secrete\n  where c = 1;');

      expect(error).toBeInstanceOf(DoltQueryError);
      expect((error as Error).message).toContain('WITH RECURSIVE iteration limit exceeded');
      expect((error as Error).message).not.toContain('table_secrete');
    });
  });

  it('signale clairement l’absence du binaire dolt', async () => {
    const db = createDoltClient(options('/nonexistent/dolt')).open(tmpdir());

    const error = await db.query('select 1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DoltNotFoundError);
    expect((error as Error).message).toContain('/nonexistent/dolt');
    expect((error as Error).message).toContain('PATH');
  });

  it('distingue un dossier de base introuvable d’un binaire absent', async () => {
    const fake = fakeDolt(`echo '{"rows": []}'`);
    const db = createDoltClient(options(fake.binary)).open(join(fake.dir, 'absent'));

    const error = await db.query('select 1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DoltQueryError);
    expect((error as Error).message).toContain('introuvable');
  });

  it('abandonne une requête qui dépasse le délai', async () => {
    const fake = fakeDolt('sleep 5');
    const db = createDoltClient({ ...options(fake.binary), timeoutMs: 100 }).open(fake.dir);

    await expect(db.query('select 1')).rejects.toThrow('Délai dépassé');
  });

  it('signale un résultat trop volumineux pour ce qu’il est, et non comme un délai dépassé', async () => {
    const fake = fakeDolt(`head -c 5000 /dev/zero | tr '\\0' 'x'; sleep 5`); // continue d'écrire : dolt est tué
    const db = createDoltClient({ ...options(fake.binary), maxOutputBytes: 1000 }).open(fake.dir);

    const error = await db.query('select 1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DoltQueryError);
    expect((error as Error).message).toContain('trop volumineuse');
    expect((error as Error).message).not.toContain('Délai dépassé');
    expect(fake.calls()).toBe(1); // pas de nouvelle tentative
  });

  describe('dossier de configuration de dolt (DOLT_ROOT_PATH)', () => {
    /** Un faux dolt qui répond avec le DOLT_ROOT_PATH qu'il a reçu. */
    const echoRoot = () => fakeDolt(`echo "{\\"rows\\": [{\\"root\\": \\"$DOLT_ROOT_PATH\\"}]}"`);
    const scratch = () => mkdtempSync(join(tmpdir(), 'bdesk-root-'));
    const mode = (path: string) => statSync(path).mode & 0o777;

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('crée un dossier privé, réservé à son propriétaire, où les métriques de dolt sont désactivées', async () => {
      const rootPath = join(scratch(), 'dolt-root');
      const fake = echoRoot();
      const db = createDoltClient({ binary: fake.binary, rootPath }).open(fake.dir);

      expect(await db.query('select 1')).toEqual([{ root: rootPath }]);

      expect(mode(rootPath)).toBe(0o700);
      expect(mode(join(rootPath, '.dolt'))).toBe(0o700);
      expect(JSON.parse(readFileSync(join(rootPath, '.dolt', 'config_global.json'), 'utf8'))).toEqual({ 'metrics.disabled': 'true' });
    });

    it('resserre les droits d’un dossier laissé par une version précédente', async () => {
      const rootPath = join(scratch(), 'dolt-root');
      mkdirSync(join(rootPath, '.dolt'), { recursive: true });
      chmodSync(rootPath, 0o755);
      chmodSync(join(rootPath, '.dolt'), 0o755);
      const fake = echoRoot();

      expect(await createDoltClient({ binary: fake.binary, rootPath }).open(fake.dir).query('select 1')).toEqual([{ root: rootPath }]);

      expect(mode(rootPath)).toBe(0o700);
      expect(mode(join(rootPath, '.dolt'))).toBe(0o700);
    });

    it('refuse un dossier qui est un lien symbolique : rien n’est écrit dans sa cible', async () => {
      const victim = scratch();
      const rootPath = join(scratch(), 'dolt-root');
      symlinkSync(victim, rootPath);
      const fake = echoRoot();

      const [row] = await createDoltClient({ binary: fake.binary, rootPath }).open(fake.dir).query('select 1');

      expect(row?.root).not.toBe(rootPath);
      expect(readdirSync(victim)).toEqual([]);
    });

    it('refuse un sous-dossier .dolt qui est un lien symbolique : rien n’est écrit dans sa cible', async () => {
      const victim = scratch();
      const rootPath = join(scratch(), 'dolt-root');
      mkdirSync(rootPath, { mode: 0o700 });
      symlinkSync(victim, join(rootPath, '.dolt'));
      const fake = echoRoot();

      const [row] = await createDoltClient({ binary: fake.binary, rootPath }).open(fake.dir).query('select 1');

      expect(row?.root).not.toBe(rootPath);
      expect(readdirSync(victim)).toEqual([]);
    });

    it('respecte un DOLT_ROOT_PATH déjà défini dans l’environnement, sans y toucher', async () => {
      const mine = join(scratch(), 'a-moi');
      vi.stubEnv('DOLT_ROOT_PATH', mine);
      const fake = echoRoot();

      expect(await createDoltClient({ binary: fake.binary }).open(fake.dir).query('select 1')).toEqual([{ root: mine }]);

      expect(existsSync(mine)).toBe(false);
    });
  });

  it('limite le nombre de processus dolt simultanés', async () => {
    const log = join(mkdtempSync(join(tmpdir(), 'bdesk-fake-dolt-')), 'events');
    const fake = fakeDolt(`echo start >> '${log}'; sleep 0.15; echo end >> '${log}'; echo '{"rows": []}'`);
    const db = createDoltClient({ ...options(fake.binary), maxConcurrent: 2 }).open(fake.dir);

    await Promise.all(Array.from({ length: 6 }, () => db.query('select 1')));

    let running = 0;
    let peak = 0;
    for (const event of readFileSync(log, 'utf8').split('\n').filter(Boolean)) {
      running += event === 'start' ? 1 : -1;
      peak = Math.max(peak, running);
    }
    expect(fake.calls()).toBe(6);
    expect(peak).toBe(2);
  });

  it('borne la file d’attente : au-delà, la lecture échoue aussitôt sans lancer de processus', async () => {
    const fake = fakeDolt(`sleep 0.3; echo '{"rows": []}'`);
    const db = createDoltClient({ ...options(fake.binary), maxConcurrent: 1, maxQueued: 2 }).open(fake.dir);

    const results = await Promise.allSettled(Array.from({ length: 6 }, () => db.query('select 1')));

    // Une lecture en cours et deux en attente passent ; les trois autres sont refusées.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(refused).toHaveLength(3);
    for (const { reason } of refused) {
      expect(reason).toBeInstanceOf(DoltQueryError);
      expect((reason as Error).message).toContain('en attente');
    }
    expect(fake.calls()).toBe(3);
  });

  it.each([
    'with x as (select 1) delete from issues',
    "select 1 -- '\n; insert into issues values (2) -- '",
    "select 'x' into dumpfile '/tmp/x'",
    'insert into issues values (1)',
    '',
  ])('refuse une requête qui n’est pas en lecture seule, sans lancer dolt : %j', async (sql) => {
    const before = empty.calls();

    await expect(emptyDb().query(sql)).rejects.toThrow('lecture seule');
    expect(empty.calls()).toBe(before);
  });

  it('refuse une écriture par une ReadOnlyViolation, qui est une DoltQueryError et ne cite pas la requête, sans lancer dolt', async () => {
    const before = empty.calls();

    const error = await emptyDb().query("delete from issues where id = 'SECRET-ID'").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ReadOnlyViolation);
    expect(error).toBeInstanceOf(DoltQueryError);
    expect((error as Error).message).toContain('lecture seule');
    expect((error as Error).message).not.toMatch(/SECRET-ID|delete|issues/i);
    expect(empty.calls()).toBe(before);
  });

  it.each(['select * from issues', 'select 1 -- un commentaire', 'with t as (select 1) select * from t'])(
    'laisse passer une lecture : %s',
    async (sql) => {
      await expect(emptyDb().query(sql)).resolves.toEqual([]);
    },
  );
});

describe('aides SQL', () => {
  it('échappe les littéraux de chaîne', () => {
    expect(sqlString("it's")).toBe("'it''s'");
    expect(sqlString('a\\b')).toBe("'a\\\\b'");
    expect(sqlString("x\\' or 1=1 --")).toBe("'x\\\\'' or 1=1 --'");
  });

  it('entoure les identifiants de guillemets inversés', () => {
    expect(sqlIdent('db/abc')).toBe('`db/abc`');
    expect(sqlIdent('we`ird')).toBe('`we``ird`');
  });

  it('lit les dates Dolt comme de l’UTC, avec ou sans millisecondes', () => {
    expect(parseDoltDate('2026-04-17 14:49:47').toISOString()).toBe('2026-04-17T14:49:47.000Z');
    expect(parseDoltDate('2026-04-17 14:49:47.533').toISOString()).toBe('2026-04-17T14:49:47.533Z');
    expect(() => parseDoltDate('pas une date')).toThrow('Date Dolt invalide');
    expect(() => parseDoltDate(undefined)).toThrow('Date Dolt invalide');
  });

  it('signale une date invalide par une DoltQueryError (503 avec la raison), pas par une erreur interne (500)', () => {
    expect(() => parseDoltDate('pas une date')).toThrow(DoltQueryError);
    expect(() => parseDoltDate(null)).toThrow(DoltQueryError);
    expect(() => parseDoltDate(42)).toThrow(DoltQueryError);
  });
});
