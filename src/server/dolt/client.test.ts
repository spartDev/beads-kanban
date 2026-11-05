import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDoltClient, DoltNotFoundError, DoltQueryError, parseDoltDate, parseDoltInteger, sqlIdent, sqlString } from './client';
import { fakeDolt, fakeDoltRoot } from '../testing/fake-dolt';
import { scratchDir } from '../testing/scratch';
import { ReadOnlyViolation } from './read-only';

const LOCKED = 'database "beads" is locked by another dolt process; either clone the database to run a second server';

const options = (binary: string) => ({ binary, retryDelayMs: 1, rootPath: fakeDoltRoot() });

/**
 * Un lecteur de `config_global.json` dans un AUTRE processus, comme le `dolt` d'un autre serveur ou d'un autre worker de
 * test qui relit ce fichier à son lancement. Il annonce « ready », attend sur son entrée la durée de lecture (ms), relit
 * alors le fichier en boucle pendant cette durée, puis rend ses comptes. La durée se compte à partir du signal et non d'une
 * heure de fin fixée d'avance : un lecteur que l'ordonnanceur réveille en retard lit quand même toute la durée. Une lecture
 * qui n'est pas du JSON est ce que dolt refuse (« unexpected end of JSON input ») : fichier vide ou partiel. Un fichier
 * absent est compté à part.
 */
const READER = `
const { readFileSync } = require('node:fs');
const file = process.argv[1];
let reads = 0, absent = 0, unreadable = 0, sample = null;
process.stdout.write('ready\\n');
process.stdin.once('data', (chunk) => {
  const deadline = Date.now() + Number(chunk);
  while (Date.now() < deadline) {
    for (let i = 0; i < 100; i++) {
      reads++;
      let text = '';
      try { text = readFileSync(file, 'utf8'); JSON.parse(text); }
      catch (error) { if (error.code === 'ENOENT') absent++; else { unreadable++; sample ??= text; } }
    }
  }
  process.stdout.write(JSON.stringify({ reads, absent, unreadable, sample }) + '\\n', () => process.exit(0));
});
`;

interface ReaderReport {
  reads: number;
  absent: number;
  unreadable: number;
  /** Le premier contenu illisible vu (vide ou partiel). */
  sample: string | null;
}

/**
 * Lance `count` lecteurs de `file` et, quand tous sont prêts, leur donne le signal de départ puis exécute
 * `whileReading(deadline)` : le processus du test y est le seul écrivain. Il s'exécute en synchrone, donc sans jamais céder
 * la main, jusqu'à l'heure `deadline` (ms depuis 1970), `durationMs` après le signal. Chaque lecteur lit `durationMs` à
 * partir du moment où il reçoit le signal. Rend leurs comptes.
 */
async function readConcurrently(file: string, count: number, durationMs: number, whileReading: (deadline: number) => void): Promise<ReaderReport[]> {
  const readers = Array.from({ length: count }, () => {
    const child = spawn(process.execPath, ['-e', READER, file], { stdio: ['pipe', 'pipe', 'inherit'] });
    return { child, lines: createInterface({ input: child.stdout })[Symbol.asyncIterator]() };
  });
  const nextLine = async ({ lines }: (typeof readers)[number]) => {
    const { value, done } = await lines.next();
    if (done) throw new Error('le lecteur s’est arrêté avant d’avoir rendu ses comptes');
    return value as string;
  };
  try {
    await Promise.all(readers.map(nextLine)); // « ready »
    await Promise.all(readers.map(({ child }) => new Promise<void>((resolve, reject) => child.stdin.write(`${durationMs}\n`, (e) => (e ? reject(e) : resolve())))));
    whileReading(Date.now() + durationMs);
    return await Promise.all(readers.map(async (reader) => JSON.parse(await nextLine(reader)) as ReaderReport));
  } finally {
    for (const { child } of readers) child.kill();
  }
}

describe.skipIf(process.platform === 'win32')('client dolt', () => {
  // Un faux dolt qui ne répond rien, partagé par les tests de ce bloc. Pas à la collecte : si aucun test du fichier ne tourne (`-t` qui ne retient rien, `vitest
  // list`), aucun crochet ne retirerait son dossier (voir `scratchDir`, qui le refuse).
  let empty: ReturnType<typeof fakeDolt>;
  beforeAll(() => {
    empty = fakeDolt(`echo '{"rows": []}'`);
  });
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

    it('refuse la requête terminée par un point-virgule avant de lancer dolt, sans la citer (le garde n\u2019en admet plus : bdesk-38k.63)', async () => {
      // Dolt cite l'instruction sans son `;` final : « select 1; » devient « select 1 ». Le lecteur n'écrit aucun point-virgule, et le garde n'en admet plus.
      const fake = fakeDolt(`printf 'error on line 1 for query x: WITH RECURSIVE iteration limit exceeded\\n' >&2\nexit 1`);

      const error = await failure(fake.binary, 'select a,\n  b\n  from table_secrete\n  where c = 1;');

      expect(error).toBeInstanceOf(ReadOnlyViolation);
      expect((error as Error).message).not.toContain('table_secrete');
      expect(fake.calls()).toBe(0);
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
    const scratch = () => scratchDir('bdesk-root-');
    const mode = (path: string) => statSync(path).mode & 0o777;
    /** root passe outre les droits des fichiers : les cas qui en dépendent n'ont rien à prouver pour lui. */
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    /** Le nom que `mkdtemp` donne au dossier de repli de dolt. */
    const FALLBACK = /^beads-desktop-dolt-repli-/;
    /** Le dossier temporaire de chaque test : ce qu'il crée (dossiers de configuration, dossier de repli de dolt compris) y est retiré à sa fin. */
    let tmp = '';

    beforeEach(() => {
      tmp = scratchDir('bdesk-tmp-');
      vi.stubEnv('TMPDIR', tmp);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        // un dossier laissé en lecture seule par un test en échec : le dossier temporaire du système s'en chargera
      }
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

    // Le dossier par défaut est partagé par tous les serveurs et tous les workers de test, et chaque dolt y relit
    // config_global.json à son lancement : un fichier vide ou partiel, même un instant, le fait échouer.
    describe('config_global.json, relu par les dolt des autres processus', () => {
      const CONFIG = JSON.stringify({ 'metrics.disabled': 'true' });
      /** Même sens pour dolt, mais d'autres octets : le client doit le tenir pour périmé. */
      const OTHER_BYTES = '{"metrics.disabled": "true"}';
      const configIn = (rootPath: string) => join(rootPath, '.dolt', 'config_global.json');
      const longAgo = new Date('2020-01-01T00:00:00Z');
      const made: string[] = [];
      /** Un dossier jetable, retiré en fin de test. */
      const fresh = () => {
        const dir = scratch();
        made.push(dir);
        return dir;
      };
      /** Remplace `file` d'un coup, comme il se doit : le harnais ne montre jamais de fichier partiel, seul le client testé le pourrait. */
      const putAtomically = (file: string, content: string) => {
        writeFileSync(`${file}.harnais`, content);
        renameSync(`${file}.harnais`, file);
      };

      afterEach(() => {
        for (const dir of made.splice(0)) {
          try {
            rmSync(dir, { recursive: true, force: true });
          } catch {
            // un dossier laissé en lecture seule par un test en échec : le dossier temporaire du système s'en chargera
          }
        }
      });

      it('ne laisse que config_global.json dans le dossier .dolt : aucun fichier temporaire', () => {
        const rootPath = join(fresh(), 'dolt-root');

        createDoltClient({ rootPath });

        expect(readdirSync(join(rootPath, '.dolt'))).toEqual(['config_global.json']);
        expect(readFileSync(configIn(rootPath), 'utf8')).toBe(CONFIG);
      });

      it.each([
        ['vide (tronqué par une version précédente)', ''],
        ['partiel', '{"metrics.dis'],
        ['d’une autre forme', '{}'],
        ['qui réactive les métriques', '{"metrics.disabled":"false"}'],
        ['de même sens mais d’autres octets', OTHER_BYTES],
      ])('remplace un fichier %s par la configuration voulue, sans fichier temporaire', (_label, stale) => {
        const rootPath = join(fresh(), 'dolt-root');
        mkdirSync(join(rootPath, '.dolt'), { recursive: true });
        writeFileSync(configIn(rootPath), stale);

        createDoltClient({ rootPath });

        expect(readFileSync(configIn(rootPath), 'utf8')).toBe(CONFIG);
        expect(readdirSync(join(rootPath, '.dolt'))).toEqual(['config_global.json']);
      });

      it('ne touche pas au fichier quand il est déjà à jour : ni réécrit, ni remplacé', () => {
        const rootPath = join(fresh(), 'dolt-root');
        createDoltClient({ rootPath });
        const file = configIn(rootPath);
        utimesSync(file, longAgo, longAgo); // une réécriture, même identique, daterait le fichier d'aujourd'hui
        const before = statSync(file);

        createDoltClient({ rootPath });

        const after = statSync(file);
        expect(after.mtimeMs).toBe(longAgo.getTime());
        expect(after.ino).toBe(before.ino);
        expect(readFileSync(file, 'utf8')).toBe(CONFIG);
      });

      // Deux processus qui remplacent le fichier en même temps ne doivent pas se marcher dessus : le fichier voisin où chacun
      // écrit a un nom que l'autre ne peut pas deviner. Ici les noms prévisibles (suffixe fixe, numéro du processus) sont
      // déjà pris par d'autres écrivains ; un client qui en réutiliserait un les écraserait, ou renoncerait.
      it('écrit dans un fichier voisin au nom imprévisible : les noms prévisibles, déjà pris, ne sont ni écrasés ni retirés', async () => {
        const rootPath = join(fresh(), 'dolt-root');
        mkdirSync(join(rootPath, '.dolt'), { recursive: true });
        const file = configIn(rootPath);
        writeFileSync(file, '{}'); // périmé : le client doit le remplacer
        const suffixes = ['.tmp', '.new', `.${process.pid}`, `.${process.pid}.tmp`, `.${process.pid}.new`];
        for (const suffix of suffixes) writeFileSync(`${file}${suffix}`, `pris${suffix}`);
        const fake = echoRoot();

        expect(await createDoltClient({ binary: fake.binary, rootPath }).open(fake.dir).query('select 1')).toEqual([{ root: rootPath }]);

        expect(readFileSync(file, 'utf8')).toBe(CONFIG);
        for (const suffix of suffixes) expect(readFileSync(`${file}${suffix}`, 'utf8')).toBe(`pris${suffix}`);
        expect(readdirSync(join(rootPath, '.dolt')).sort()).toEqual(['config_global.json', ...suffixes.map((suffix) => `config_global.json${suffix}`)].sort());
      });

      /** L'état où le harnais remet le fichier avant chaque création de client (et si les lecteurs ont le droit de le trouver absent). */
      const states: [string, (file: string) => void, boolean][] = [
        ['déjà à jour', () => undefined, false],
        ['périmé à chaque tour', (file) => putAtomically(file, OTHER_BYTES), false],
        ['absent à chaque tour', (file) => rmSync(file, { force: true }), true],
      ];
      // Le cas réel : plusieurs processus créent leur client pendant que les dolt des autres lisent le fichier. Un client
      // qui tronquait le fichier avant de le réécrire le montrait vide un instant, et le dolt qui le lisait alors échouait
      // (14 lectures de dolt sur 60 dans la reproduction). Ici les lecteurs sont de vrais processus qui relisent le fichier
      // en boucle, et le processus du test crée des clients en boucle sans leur céder la main.
      it.each(states)(
        'les dolt qui relisent le fichier pendant que des clients se créent ne le voient jamais vide ou partiel : fichier %s',
        async (_state, prepare, mayBeAbsent) => {
          const rootPath = join(fresh(), 'dolt-root');
          createDoltClient({ rootPath });
          const file = configIn(rootPath);
          let rounds = 0;

          const reports = await readConcurrently(file, 2, 400, (deadline) => {
            for (; Date.now() < deadline - 20; rounds++) {
              prepare(file);
              createDoltClient({ rootPath });
            }
          });

          expect(rounds).toBeGreaterThan(0);
          for (const report of reports) {
            expect(report.reads, 'le lecteur a lu pendant que les clients se créaient').toBeGreaterThan(10);
            expect(report.unreadable, `lectures sans JSON valide (premier contenu vu : ${JSON.stringify(report.sample)})`).toBe(0);
            if (!mayBeAbsent) expect(report.absent).toBe(0);
          }
          expect(readFileSync(file, 'utf8')).toBe(CONFIG);
          expect(readdirSync(join(rootPath, '.dolt'))).toEqual(['config_global.json']);
        },
        30_000,
      );

      it.skipIf(isRoot)('n’a besoin d’aucune écriture quand le fichier est à jour : un dossier de configuration en lecture seule convient', async () => {
        const rootPath = join(fresh(), 'dolt-root');
        createDoltClient({ rootPath });
        chmodSync(configIn(rootPath), 0o400);
        chmodSync(join(rootPath, '.dolt'), 0o500);
        const fake = echoRoot();

        try {
          expect(await createDoltClient({ binary: fake.binary, rootPath }).open(fake.dir).query('select 1')).toEqual([{ root: rootPath }]);
        } finally {
          chmodSync(join(rootPath, '.dolt'), 0o700);
        }
      });

      it.skipIf(isRoot)('n’échoue pas quand le dossier .dolt n’est pas inscriptible et que le fichier est périmé : rien ne traîne', async () => {
        const rootPath = join(fresh(), 'dolt-root');
        mkdirSync(join(rootPath, '.dolt'), { recursive: true });
        writeFileSync(configIn(rootPath), '{}');
        chmodSync(join(rootPath, '.dolt'), 0o500);
        const fake = echoRoot();

        try {
          await expect(createDoltClient({ binary: fake.binary, rootPath }).open(fake.dir).query('select 1')).resolves.toHaveLength(1);
          expect(readdirSync(join(rootPath, '.dolt'))).toEqual(['config_global.json']);
        } finally {
          chmodSync(join(rootPath, '.dolt'), 0o700);
        }
      });

      it('n’échoue pas quand le fichier ne peut pas être remplacé, ne laisse aucun fichier temporaire et donne à dolt un autre dossier de configuration (le repli)', async () => {
        const rootPath = join(fresh(), 'dolt-root');
        mkdirSync(configIn(rootPath), { recursive: true }); // un dossier non vide à la place du fichier : rename ne peut pas le remplacer
        writeFileSync(join(configIn(rootPath), 'occupant'), 'x');
        const fake = echoRoot();

        const [row] = await createDoltClient({ binary: fake.binary, rootPath }).open(fake.dir).query('select 1');

        expect(row?.root).not.toBe(rootPath);
        expect(readdirSync(join(rootPath, '.dolt'))).toEqual(['config_global.json']);
        expect(readdirSync(configIn(rootPath))).toEqual(['occupant']);
      });

      it('n’échoue pas quand le dossier de configuration ne peut pas être créé', async () => {
        const blocker = join(fresh(), 'un-fichier');
        writeFileSync(blocker, 'x');
        const fake = echoRoot();

        const [row] = await createDoltClient({ binary: fake.binary, rootPath: join(blocker, 'dolt-root') }).open(fake.dir).query('select 1');

        expect(row?.root).not.toBe(join(blocker, 'dolt-root'));
        expect(readFileSync(blocker, 'utf8')).toBe('x');
      });

      // Même précaution que pour les dossiers (voir plus haut), au niveau du fichier : on remplace le lien, on ne l'écrase pas.
      it.each([
        ['un autre contenu', 'précieux'],
        ['le contenu voulu', CONFIG],
      ])('ne suit pas un lien symbolique posé à la place du fichier (cible : %s) : la cible n’est pas réécrite, le lien est remplacé', (_label, victimContent) => {
        const rootPath = join(fresh(), 'dolt-root');
        mkdirSync(join(rootPath, '.dolt'), { recursive: true });
        const victim = join(fresh(), 'cible');
        writeFileSync(victim, victimContent);
        utimesSync(victim, longAgo, longAgo);
        symlinkSync(victim, configIn(rootPath));

        createDoltClient({ rootPath });

        expect(lstatSync(configIn(rootPath)).isSymbolicLink()).toBe(false);
        expect(readFileSync(configIn(rootPath), 'utf8')).toBe(CONFIG);
        expect(readFileSync(victim, 'utf8')).toBe(victimContent);
        expect(statSync(victim).mtimeMs).toBe(longAgo.getTime());
        expect(readdirSync(join(rootPath, '.dolt'))).toEqual(['config_global.json']);
      });
    });

    // Quand le dossier voulu est inutilisable, dolt ne doit jamais se rabattre sur le ~/.dolt de l'utilisateur : sans
    // DOLT_ROOT_PATH il y crée config_global.json et eventsData/, et l'envoi de ses métriques d'usage n'est plus désactivé.
    // Il reçoit alors un dossier de repli, à nous et jetable, préparé de même ; si même celui-là est impossible, aucun dolt
    // n'est lancé. Le faux $HOME de ces tests doit rester vide.
    describe('dossier de repli, quand le dossier de configuration voulu est inutilisable', () => {
      let home = '';

      beforeEach(() => {
        home = scratch();
        vi.stubEnv('HOME', home);
        vi.stubEnv('DOLT_ROOT_PATH', undefined); // celui du développeur, s'il en a un, ne doit pas fausser les cas
      });

      /** Un exemplaire neuf du module : le dossier de repli est propre à un processus, un exemplaire neuf n'a pas encore le sien. */
      const freshClient = () => {
        vi.resetModules();
        return import('./client');
      };
      /** Un faux dolt qui répond avec le DOLT_ROOT_PATH reçu et, comme le vrai, écrit dans $HOME/.dolt quand il n'en a pas. */
      const homeBoundDolt = () =>
        fakeDolt(
          `if [ -z "$DOLT_ROOT_PATH" ]; then mkdir -p "$HOME/.dolt/eventsData" && echo '{}' > "$HOME/.dolt/config_global.json"; fi\n` +
            `echo "{\\"rows\\": [{\\"root\\": \\"$DOLT_ROOT_PATH\\"}]}"`,
        );
      const fallbacksInTmp = () => readdirSync(tmp).filter((name) => FALLBACK.test(name));
      /** Un chemin de configuration que rien ne peut créer : un fichier ordinaire en barre l'accès. */
      const blockedRoot = () => {
        const blocker = join(scratch(), 'un-fichier');
        writeFileSync(blocker, 'x');
        return join(blocker, 'dolt-root');
      };
      /** `root` est bien le dossier de repli : sous le dossier temporaire, réservé à son propriétaire, métriques de dolt désactivées. */
      const expectFallbackRoot = (root: string) => {
        expect(dirname(root)).toBe(tmp);
        expect(basename(root)).toMatch(FALLBACK);
        expect(mode(root)).toBe(0o700);
        expect(mode(join(root, '.dolt'))).toBe(0o700);
        expect(JSON.parse(readFileSync(join(root, '.dolt', 'config_global.json'), 'utf8'))).toEqual({ 'metrics.disabled': 'true' });
      };
      /** Exécute `task` sous l'`umask` donné, puis le remet. */
      const withUmask = <T>(mask: number, task: () => T): T => {
        const previous = process.umask(mask);
        try {
          return task();
        } finally {
          process.umask(previous);
        }
      };

      /** Les façons dont le dossier voulu devient inutilisable : chacune rend le `rootPath` à donner au client. */
      const unusable: [string, (base: string, victim: string) => string][] = [
        ['un fichier ordinaire en barre l’accès', () => blockedRoot()],
        [
          'c’est un lien symbolique',
          (base, victim) => {
            symlinkSync(victim, join(base, 'dolt-root'));
            return join(base, 'dolt-root');
          },
        ],
        [
          'son sous-dossier .dolt est un lien symbolique',
          (base, victim) => {
            mkdirSync(join(base, 'dolt-root'), { mode: 0o700 });
            symlinkSync(victim, join(base, 'dolt-root', '.dolt'));
            return join(base, 'dolt-root');
          },
        ],
        [
          'config_global.json ne peut pas être remplacé (un dossier non vide est à sa place)',
          (base) => {
            mkdirSync(join(base, 'dolt-root', '.dolt', 'config_global.json'), { recursive: true });
            writeFileSync(join(base, 'dolt-root', '.dolt', 'config_global.json', 'occupant'), 'x');
            return join(base, 'dolt-root');
          },
        ],
      ];
      it.each(unusable)('dolt reçoit un dossier de repli privé, métriques désactivées, et rien n’est écrit dans le dossier personnel : %s', async (_why, make) => {
        const { createDoltClient } = await freshClient();
        const victim = scratch();
        const rootPath = make(scratch(), victim);
        const fake = homeBoundDolt();

        const [row] = await createDoltClient({ binary: fake.binary, rootPath }).open(fake.dir).query('select 1');

        expect(readdirSync(home)).toEqual([]); // ni .dolt, ni config_global.json, ni eventsData/ dans $HOME
        expect(readdirSync(victim)).toEqual([]);
        expectFallbackRoot(String(row?.root));
      });

      it('écarte de même le dossier par défaut quand quelqu’un y a posé un lien symbolique : le dossier temporaire est à tout le monde', async () => {
        const { createDoltClient } = await freshClient();
        const victim = scratch();
        symlinkSync(victim, join(tmp, `beads-desktop-dolt-${process.getuid?.() ?? 'user'}`));
        const fake = homeBoundDolt();

        const [row] = await createDoltClient({ binary: fake.binary }).open(fake.dir).query('select 1');

        expect(readdirSync(home)).toEqual([]);
        expect(readdirSync(victim)).toEqual([]);
        expectFallbackRoot(String(row?.root));
      });

      it('en crée un seul par processus, que tous les clients se partagent', async () => {
        const { createDoltClient } = await freshClient();
        const fake = homeBoundDolt();
        const roots = new Set<unknown>();

        for (let i = 0; i < 3; i++) {
          const [row] = await createDoltClient({ binary: fake.binary, rootPath: blockedRoot() }).open(fake.dir).query('select 1');
          roots.add(row?.root);
        }

        expect(roots.size).toBe(1);
        expect(fallbacksInTmp()).toHaveLength(1);
        expectFallbackRoot(String([...roots][0]));
      });

      it('en refait un si le sien a disparu (le dossier temporaire a été nettoyé)', async () => {
        const { createDoltClient } = await freshClient();
        const fake = homeBoundDolt();
        const [first] = await createDoltClient({ binary: fake.binary, rootPath: blockedRoot() }).open(fake.dir).query('select 1');
        rmSync(String(first?.root), { recursive: true });

        const [second] = await createDoltClient({ binary: fake.binary, rootPath: blockedRoot() }).open(fake.dir).query('select 1');

        expectFallbackRoot(String(second?.root));
        expect(fallbacksInTmp()).toHaveLength(1);
      });

      it('n’en partage pas un entre deux processus : son nom est aléatoire, donc ni commun ni prévisible', async () => {
        const fake = homeBoundDolt();
        const roots: string[] = [];

        for (let worker = 0; worker < 2; worker++) {
          const { createDoltClient } = await freshClient(); // un exemplaire neuf du module tient lieu d'un autre processus
          const [row] = await createDoltClient({ binary: fake.binary, rootPath: blockedRoot() }).open(fake.dir).query('select 1');
          roots.push(String(row?.root));
        }

        expect(roots[1]).not.toBe(roots[0]);
        expect(fallbacksInTmp()).toHaveLength(2);
        for (const root of roots) expectFallbackRoot(root);
      });

      it('n’en crée aucun quand le dossier voulu est utilisable', async () => {
        const { createDoltClient } = await freshClient();
        const rootPath = join(scratch(), 'dolt-root');
        const fake = homeBoundDolt();

        const [row] = await createDoltClient({ binary: fake.binary, rootPath }).open(fake.dir).query('select 1');

        expect(row?.root).toBe(rootPath);
        expect(fallbacksInTmp()).toEqual([]);
        expect(readdirSync(home)).toEqual([]);
      });

      it('laisse à dolt le DOLT_ROOT_PATH de l’environnement, sans repli, quand le dossier voulu est inutilisable', async () => {
        const { createDoltClient } = await freshClient();
        const mine = join(scratch(), 'a-moi');
        vi.stubEnv('DOLT_ROOT_PATH', mine);
        const fake = homeBoundDolt();

        const [row] = await createDoltClient({ binary: fake.binary, rootPath: blockedRoot() }).open(fake.dir).query('select 1');

        expect(row?.root).toBe(mine);
        expect(fallbacksInTmp()).toEqual([]);
        expect(readdirSync(home)).toEqual([]);
      });

      it('traite un DOLT_ROOT_PATH vide de l’environnement comme absent : le repli, et non le dossier personnel', async () => {
        const { createDoltClient } = await freshClient();
        vi.stubEnv('DOLT_ROOT_PATH', '');
        const fake = homeBoundDolt();

        const [row] = await createDoltClient({ binary: fake.binary, rootPath: blockedRoot() }).open(fake.dir).query('select 1');

        expect(readdirSync(home)).toEqual([]);
        expectFallbackRoot(String(row?.root));
      });

      it('ne lance pas dolt quand même le dossier de repli est impossible : chaque lecture échoue par une DoltQueryError claire', async () => {
        const { createDoltClient, DoltQueryError } = await freshClient();
        const rootPath = blockedRoot();
        const fake = homeBoundDolt();
        vi.stubEnv('TMPDIR', join(scratch(), 'disparu')); // le dossier temporaire n'existe plus : mkdtemp échoue lui aussi

        const db = createDoltClient({ binary: fake.binary, rootPath }).open(fake.dir); // ne lève pas : c'est la lecture qui échoue
        const errors = [await db.query('select 1').catch((e: unknown) => e), await db.query('select 2').catch((e: unknown) => e)];

        for (const error of errors) {
          expect(error).toBeInstanceOf(DoltQueryError);
          expect((error as Error).message).toContain('dossier de configuration');
          expect((error as Error).message).toContain('~/.dolt');
          expect((error as Error).cause).toBeInstanceOf(Error); // l'erreur d'origine reste à qui débogue
        }
        expect(fake.calls()).toBe(0);
        expect(readdirSync(home)).toEqual([]);
      });

      // mkdtemp crée le dossier en 0700 moins l'umask : avec 0200 il n'est que lisible, on n'y écrit rien et sa préparation échoue.
      // Le dossier créé pour rien ne doit pas rester. (`process.umask(masque)` exige le pool `forks` de vitest, son défaut.)
      it.skipIf(isRoot)('ne laisse aucun dossier derrière lui quand le dossier de repli, créé, ne peut pas être préparé', async () => {
        const { createDoltClient, DoltQueryError } = await freshClient();
        const rootPath = blockedRoot();
        const fake = homeBoundDolt();

        const db = withUmask(0o200, () => createDoltClient({ binary: fake.binary, rootPath }).open(fake.dir));

        await expect(db.query('select 1')).rejects.toBeInstanceOf(DoltQueryError);
        expect(fallbacksInTmp()).toEqual([]);
        expect(fake.calls()).toBe(0);
        expect(readdirSync(home)).toEqual([]);
      });
    });
  });

  it('limite le nombre de processus dolt simultanés', async () => {
    const log = join(scratchDir('bdesk-fake-dolt-'), 'events');
    const fake = fakeDolt(`echo start >> '${log}'; sleep 0.15; echo end >> '${log}'; echo '{"rows": []}'`);
    const db = createDoltClient({ ...options(fake.binary), maxConcurrent: 2 }).open(fake.dir);

    // Des requêtes toutes différentes : deux requêtes identiques encore en file ne feraient qu'un processus (voir « lectures identiques »).
    await Promise.all(Array.from({ length: 6 }, (_, i) => db.query(`select ${i}`)));

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

    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => db.query(`select ${i}`)));

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

  // Aucun commentaire n'est admis (bdesk-38k.56, B4) : une marque de commentaire dans une chaîne n'en est pas un.
  it.each(['select * from issues', "select '-- pas un commentaire'", 'with t as (select 1) select * from t'])(
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

describe('entiers de Dolt (bdesk-38k.44)', () => {
  // Dolt rend un entier en nombre quand il lit les fichiers lui-même, en chaîne de chiffres quand un `dolt sql-server` tourne pour la base.
  it.each([0, 1, 4, -3, 12_345, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER])('lit le nombre %j', (value) => {
    expect(parseDoltInteger(value, 'priority')).toBe(value);
  });

  it.each([
    ['0', 0],
    ['1', 1],
    ['4', 4],
    ['-3', -3],
    ['12345', 12_345],
    ['9007199254740991', Number.MAX_SAFE_INTEGER],
    ['-9007199254740991', Number.MIN_SAFE_INTEGER],
  ])('lit la chaîne %j, comme la rend un dolt sql-server', (value, expected) => {
    expect(parseDoltInteger(value, 'priority')).toBe(expected);
  });

  it.each([undefined, null])('rend undefined pour NULL, que la sortie JSON ne donne pas (%j) : le défaut de la colonne est à l’appelant', (value) => {
    expect(parseDoltInteger(value, 'priority')).toBeUndefined();
  });

  // Une valeur qui n'est pas un entier vient d'une base qui n'a pas le format attendu : on ne la prend ni pour 0, ni pour NaN, ni pour une valeur par défaut.
  const INVALID: unknown[] = [
    '',
    ' ',
    '2 ',
    ' 2',
    '+2',
    '02',
    '-0',
    '1.5',
    '2.0',
    '1e3',
    '0x10',
    'deux',
    'haute',
    'null',
    'NaN',
    'Infinity',
    '٣', // un chiffre qui n'est pas ASCII
    '9007199254740992', // hors de la plage où un nombre représente exactement chaque entier
    '9007199254740993',
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2 ** 53,
    true,
    false,
    {},
    [],
    [2],
  ];
  it.each(INVALID.map((value) => [value]))('refuse %j, sans le lire comme un entier', (value) => {
    expect(() => parseDoltInteger(value, 'priority')).toThrow('Entier Dolt invalide');
  });

  it('nomme la colonne et la valeur refusée, sans en citer plus de quarante caractères', () => {
    expect(() => parseDoltInteger('haute', 'priority')).toThrow('Entier Dolt invalide (priority) : « haute »');
    expect(() => parseDoltInteger(1.5, 'restart')).toThrow('Entier Dolt invalide (restart) : 1.5');
    expect(() => parseDoltInteger({ a: [1] }, 'restart')).toThrow('Entier Dolt invalide (restart) : {"a":[1]}');
    expect(() => parseDoltInteger('x'.repeat(500), 'priority')).toThrow(`Entier Dolt invalide (priority) : « ${'x'.repeat(40)}… »`);
    expect(() => parseDoltInteger('x'.repeat(500), 'priority')).not.toThrow('x'.repeat(41));
  });

  it('signale une valeur invalide par une DoltQueryError (503 avec la raison), pas par une erreur interne (500)', () => {
    expect(() => parseDoltInteger('haute', 'priority')).toThrow(DoltQueryError);
    expect(() => parseDoltInteger({}, 'priority')).toThrow(DoltQueryError);
  });
});
