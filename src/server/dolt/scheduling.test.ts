import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { isAbortError, ReadAborted } from '../abort';
import { Flight } from '../flight';
import { fakeDolt } from '../testing/fake-dolt';
import { createDoltClient, type DoltDatabase, DoltQueryError, queryAll, type Row, withOptions } from './client';
import { ReadOnlyViolation } from './read-only';

/**
 * Ordonnancement des lectures Dolt (bdesk-38k.20) : lectures groupées dans un seul processus, voie légère, abandon,
 * lectures identiques en file. Un faux binaire `dolt` (script shell) tient la place du vrai ; la sortie est celle du vrai :
 * le document `{}` de la transaction en lecture seule, puis un document par instruction.
 */

const LOCKED = 'database "beads" is locked by another dolt process; either clone the database to run a second server';
const options = (binary: string) => ({ binary, retryDelayMs: 1, rootPath: join(tmpdir(), 'bdesk-fake-dolt-root') });
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Les lignes du journal d'un faux dolt (une par événement). */
const lines = (file: string): string[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);

/** Attend qu'une condition soit vraie (les processus du faux dolt tournent en temps réel). */
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let waited = 0; !condition(); waited += 5) {
    if (waited > 10_000) throw new Error(`jamais vrai : ${what}`);
    await sleep(5);
  }
}

/** Le plus grand nombre de processus qui ont tourné en même temps, d'après un journal de lignes `start …` / `end …`. */
function peak(log: string): number {
  let running = 0;
  let max = 0;
  for (const line of lines(log)) {
    running += line.startsWith('start') ? 1 : -1;
    max = Math.max(max, running);
  }
  return max;
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Le début du corps d'un faux dolt qui ne finit que quand le test le décide : il note son numéro dans `pid`, attend (dix secondes
 * au plus, pour ne jamais traîner si un test échoue) que le test crée le fichier `go`, puis note `fini`.
 */
const WAIT_FOR_GO = `d="$(dirname "$0")"\necho $$ > "$d/pid"\ni=0\nwhile [ ! -e "$d/go" ] && [ $i -lt 200 ]; do sleep 0.05; i=$((i+1)); done\necho fini > "$d/fini"`;
/** Laisse finir le faux dolt qui attend `go`. */
const release = (dir: string) => writeFileSync(join(dir, 'go'), '');

/** Le numéro de processus noté par un faux dolt dans `file` ; absent tant que le fichier n'existe pas ou n'a pas encore été écrit (le shell le crée avant d'y écrire). */
function pidIn(file: string): number | undefined {
  const text = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
  return text === '' ? undefined : Number(text);
}

// Des processus réels : sur une machine très chargée, en lancer un prend des secondes (d'où le délai large).
describe.skipIf(process.platform === 'win32')('ordonnancement des lectures Dolt', { timeout: 30_000 }, () => {
  describe('lectures groupées : plusieurs requêtes, un seul processus', () => {
    const THREE = `printf '{}\\n\\n{"rows": [{"a": 1}]}\\n{}\\n\\n{"rows": [{"c": 3}]}\\n'`;

    it('lance un seul processus et rend les lignes de chaque requête, dans l’ordre', async () => {
      const fake = fakeDolt(THREE);
      const db = createDoltClient(options(fake.binary)).open(fake.dir);

      const results = await queryAll(db, ['select 1 as a', "select id from t where id = 'x'", 'select 3 as c']);

      expect(results).toEqual([[{ a: 1 }], [], [{ c: 3 }]]);
      expect(fake.calls()).toBe(1);
    });

    it('les passe à dolt dans une seule transaction en lecture seule, chaque requête fermée par un saut de ligne et un point-virgule', async () => {
      // Une requête qui finit par un commentaire de fin de ligne avalerait le « ; » et la requête suivante sans ce saut de ligne.
      const fake = fakeDolt(`a=$(printf '%s' "$*" | tr '\\n' '~')\nprintf '{}\\n\\n{"rows": [{"args": "%s"}]}\\n{}\\n\\n' "$a"`);
      const db = createDoltClient(options(fake.binary)).open(fake.dir);

      const [first] = await queryAll(db, ['select 1 -- fin de ligne', 'select 2']);

      expect(first?.[0]?.args).toBe('sql -r json -q start transaction read only; select 1 -- fin de ligne~;~select 2');
    });

    it('ne lance rien pour une liste vide', async () => {
      const fake = fakeDolt(THREE);
      const db = createDoltClient(options(fake.binary)).open(fake.dir);

      expect(await queryAll(db, [])).toEqual([]);
      expect(fake.calls()).toBe(0);
    });

    it('refuse le groupe entier, sans lancer dolt, si l’une des requêtes n’est pas une lecture (le garde-fou juge chacune)', async () => {
      const fake = fakeDolt(THREE);
      const db = createDoltClient(options(fake.binary)).open(fake.dir);

      const error = await queryAll(db, ['select 1', "delete from issues where id = 'SECRET-ID'", 'select 3']).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ReadOnlyViolation);
      expect(error).toBeInstanceOf(DoltQueryError);
      expect((error as Error).message).toContain('lecture seule');
      expect((error as Error).message).not.toMatch(/SECRET-ID|delete|issues/i);
      expect(fake.calls()).toBe(0);
    });

    it.each([
      ['une écriture glissée derrière un point-virgule', 'select 1; delete from issues'],
      ['une écriture cachée dans un commentaire de fin de ligne', "select 1 -- '\n; insert into issues values (2) -- '"],
      ['un commentaire de bloc jamais fermé, qui avalerait la requête suivante', 'select 1 /* jamais fermé'],
      ['une chaîne jamais fermée', "select 'jamais fermée"],
      ['un commentaire exécutable', 'select 1 /*! drop table issues */'],
      ['une requête vide', ''],
    ])('refuse le groupe, sans lancer dolt, quand l’une des requêtes est %s', async (_why, sql) => {
      const fake = fakeDolt(THREE);
      const db = createDoltClient(options(fake.binary)).open(fake.dir);

      await expect(queryAll(db, ['select 1', sql])).rejects.toBeInstanceOf(ReadOnlyViolation);
      await expect(queryAll(db, [sql, 'select 1'])).rejects.toBeInstanceOf(ReadOnlyViolation);
      expect(fake.calls()).toBe(0);
    });

    it('signale un nombre de résultats qui ne correspond pas aux requêtes plutôt que de décaler les lignes', async () => {
      const fake = fakeDolt(`printf '{}\\n\\n{"rows": [{"a": 1}]}\\n'`); // trois requêtes, un seul résultat
      const db = createDoltClient(options(fake.binary)).open(fake.dir);

      const error = await queryAll(db, ['select 1', 'select 2', 'select 3']).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DoltQueryError);
      expect((error as Error).message).toContain('Sortie de dolt illisible');
    });

    it('un échec en cours de route est une DoltQueryError qui ne cite aucune des requêtes', async () => {
      const fake = fakeDolt(
        `printf '{}\\n\\n{"rows": [{"a": 1}]}\\n'\nprintf 'error on line 1 for query select b from table_secrete: table not found: table_secrete\\n' >&2\nexit 1`,
      );
      const db = createDoltClient(options(fake.binary)).open(fake.dir);

      const error = await queryAll(db, ['select a from t', 'select b from table_secrete']).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DoltQueryError);
      expect((error as Error).message).toContain('table not found');
      expect((error as Error).message).not.toContain('select b from');
    });

    it('retente le groupe entier quand la base est verrouillée, puis aboutit', async () => {
      const fake = fakeDolt(`if [ "$n" -le 2 ]; then echo '${LOCKED}' >&2; exit 1; fi\n${THREE}`);
      const db = createDoltClient(options(fake.binary)).open(fake.dir);

      expect(await queryAll(db, ['select 1', 'select 2', 'select 3'])).toHaveLength(3);
      expect(fake.calls()).toBe(3);
    });

    it('se replie sur une lecture par requête quand la base ne sait pas grouper', async () => {
      const queries: string[] = [];
      const plain: DoltDatabase = {
        dir: '/projet',
        async query(sql, queryOptions) {
          queries.push(`${sql}|${queryOptions?.lane ?? 'normal'}`);
          return [{ sql }];
        },
      };

      expect(await queryAll(plain, ['select 1', 'select 2'], { lane: 'light' })).toEqual([[{ sql: 'select 1' }], [{ sql: 'select 2' }]]);
      expect(queries).toEqual(['select 1|light', 'select 2|light']);
    });
  });

  describe('voies : le HEAD ne fait pas la queue derrière les lectures lourdes, ni l’historique derrière les fiches', () => {
    /** Les requêtes qui contiennent « slow » durent ; les autres sont immédiates. Chaque processus note son début et sa fin. */
    const slowDolt = (seconds: string) => {
      const fake = fakeDolt(
        `log="$(dirname "$0")/events"\nq="\${5#start transaction read only; }"\necho "start $q" >> "$log"\ncase "$q" in *slow*) sleep ${seconds};; esac\necho "end $q" >> "$log"\necho '{"rows": []}'`,
      );
      return { ...fake, events: () => lines(join(fake.dir, 'events')) };
    };

    it('une lecture légère s’exécute pendant que toutes les places des lectures lourdes sont prises, avant même que la première finisse', async () => {
      const fake = slowDolt('5'); // assez long pour qu'une machine saturée lance le processus léger avant la fin de la lourde
      const db = createDoltClient({ ...options(fake.binary), maxConcurrent: 1 }).open(fake.dir);
      const stop = new AbortController();
      const heavy = ['a', 'b', 'c'].map((name) => db.query(`select 'slow' as ${name}`, { signal: stop.signal }).catch(() => undefined));
      await until(() => fake.events().length >= 1, 'la première lecture lourde a démarré');

      await db.query("select hashof('HEAD')", { lane: 'light' });

      expect(fake.events()).toEqual(["start select 'slow' as a", "start select hashof('HEAD')", "end select hashof('HEAD')"]);
      stop.abort(); // inutile d'attendre cinq secondes trois fois
      await Promise.all(heavy);
    });

    it('les lectures lourdes qui attendent ne passent pas devant la légère, mais ne sont pas retardées pour autant', async () => {
      const fake = slowDolt('1');
      const db = createDoltClient({ ...options(fake.binary), maxConcurrent: 1 }).open(fake.dir);

      await Promise.all([db.query("select 'slow' as a"), db.query("select 'slow' as b"), db.query('select 1', { lane: 'light' })]);

      expect(fake.events().filter((line) => line.startsWith('end'))).toEqual(['end select 1', "end select 'slow' as a", "end select 'slow' as b"]);
    });

    it('la voie légère est bornée par maxLight', async () => {
      const fake = slowDolt('0.5');
      const db = createDoltClient({ ...options(fake.binary), maxConcurrent: 6, maxLight: 2 }).open(fake.dir);

      await Promise.all(Array.from({ length: 6 }, (_, i) => db.query(`select 'slow' as l${i}`, { lane: 'light' })));

      expect(peak(join(fake.dir, 'events'))).toBe(2);
      expect(fake.calls()).toBe(6);
    });

    it('les deux voies tournent ensemble : au plus maxConcurrent lourdes et maxLight légères', async () => {
      const fake = slowDolt('0.6');
      const db = createDoltClient({ ...options(fake.binary), maxConcurrent: 2, maxLight: 1 }).open(fake.dir);

      await Promise.all([
        ...Array.from({ length: 4 }, (_, i) => db.query(`select 'slow' as h${i}`)),
        ...Array.from({ length: 3 }, (_, i) => db.query(`select 'slow' as l${i}`, { lane: 'light' })),
      ]);

      expect(peak(join(fake.dir, 'events'))).toBe(3);
    });

    it('chaque voie a sa propre file d’attente bornée : une voie pleine ne fait pas refuser l’autre', async () => {
      const fake = slowDolt('0.3');
      const db = createDoltClient({ ...options(fake.binary), maxConcurrent: 1, maxLight: 1, maxQueued: 1 }).open(fake.dir);

      const results = await Promise.allSettled([
        ...Array.from({ length: 3 }, (_, i) => db.query(`select 'slow' as l${i}`, { lane: 'light' })),
        ...Array.from({ length: 3 }, (_, i) => db.query(`select 'slow' as h${i}`)),
      ]);

      // Dans chaque voie : une lecture en cours, une en attente, la troisième refusée aussitôt.
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'rejected']);
      for (const refused of [results[2], results[5]]) {
        expect((refused as PromiseRejectedResult).reason).toBeInstanceOf(DoltQueryError);
        expect(((refused as PromiseRejectedResult).reason as Error).message).toContain('en attente');
      }
    });
  });

  describe('voie des analyses : l’historique ne fait pas la queue derrière les fiches', () => {
    const slowDolt = (seconds: string) => {
      const fake = fakeDolt(
        `log="$(dirname "$0")/events"\nq="\${5#start transaction read only; }"\necho "start $q" >> "$log"\ncase "$q" in *slow*) sleep ${seconds};; esac\necho "end $q" >> "$log"\necho '{"rows": []}'`,
      );
      return { ...fake, events: () => lines(join(fake.dir, 'events')) };
    };

    it('une lecture d’analyse s’exécute pendant que toutes les places des lectures normales sont prises', async () => {
      const fake = slowDolt('5');
      const db = createDoltClient({ ...options(fake.binary), maxConcurrent: 1 }).open(fake.dir);
      const stop = new AbortController();
      const tickets = ['a', 'b', 'c'].map((name) => db.query(`select 'slow' as ${name}`, { signal: stop.signal }).catch(() => undefined));
      await until(() => fake.events().length >= 1, 'la première lecture a démarré');

      await db.query('select 1 as histoire', { lane: 'analysis' });

      expect(fake.events()).toEqual(["start select 'slow' as a", 'start select 1 as histoire', 'end select 1 as histoire']);
      stop.abort();
      await Promise.all(tickets);
    });

    it('la voie des analyses est bornée par maxAnalysis, et ne prend pas les places des autres', async () => {
      const fake = slowDolt('0.6');
      const db = createDoltClient({ ...options(fake.binary), maxConcurrent: 2, maxAnalysis: 1 }).open(fake.dir);

      await Promise.all([
        ...Array.from({ length: 3 }, (_, i) => db.query(`select 'slow' as h${i}`, { lane: 'analysis' })),
        ...Array.from({ length: 4 }, (_, i) => db.query(`select 'slow' as t${i}`)),
      ]);

      expect(peak(join(fake.dir, 'events'))).toBe(3); // 2 normales + 1 analyse, jamais plus
    });

    it('une rafale de fiches ne retarde pas l’historique, et l’historique ne retarde pas les fiches au-delà de ses places', async () => {
      const fake = slowDolt('0.3');
      const db = createDoltClient({ ...options(fake.binary), maxConcurrent: 2, maxAnalysis: 1 }).open(fake.dir);
      const tickets = Array.from({ length: 20 }, (_, i) => db.query(`select 'slow' as t${i}`));
      await until(() => fake.events().length >= 2, 'les fiches ont démarré');

      await db.query("select 'slow' as histoire", { lane: 'analysis' });

      // L'historique a fini bien avant que la file des fiches ne soit vidée : sur 20 fiches de 2 places, la moitié au moins reste à lire.
      const ended = fake.events().filter((line) => line.startsWith('end'));
      expect(ended.indexOf("end select 'slow' as histoire")).toBeLessThan(10);
      await Promise.all(tickets);
    });
  });

  describe('une lecture que seul un délai de grâce retient passe après celles qu’on attend (bdesk-38k.37)', () => {
    /**
     * Les requêtes qui contiennent « wait » ne finissent que quand le test le décide (`release`), celles qui contiennent « later » ou « hold »
     * quand il crée `go-later` ou `go-hold` ; « slow » dure 0,1 s et « boom » échoue. Chaque processus note sa requête à son lancement
     * (`started`) et, s'il va au bout, à sa fin (`ended`) : un processus tué ne note rien.
     */
    const gated = () => {
      const fake = fakeDolt(
        [
          `d="$(dirname "$0")"`,
          `q="\${5#start transaction read only; }"`,
          `echo "$q" >> "$d/events"`,
          `case "$q" in`,
          `*later*) i=0; while [ ! -e "$d/go-later" ] && [ $i -lt 200 ]; do sleep 0.05; i=$((i+1)); done;;`,
          `*hold*) i=0; while [ ! -e "$d/go-hold" ] && [ $i -lt 200 ]; do sleep 0.05; i=$((i+1)); done;;`,
          `*slow*) sleep 0.1;;`,
          `*boom*) echo 'boom: erreur de dolt' >&2; exit 1;;`,
          `*wait*)`,
          WAIT_FOR_GO + ';;',
          `esac`,
          `echo "$q" >> "$d/ends"`,
          `echo '{"rows": []}'`,
        ].join('\n'),
      );
      return { ...fake, started: () => lines(join(fake.dir, 'events')), ended: () => lines(join(fake.dir, 'ends')) };
    };

    /** La seule place de la voie des analyses est prise par une lecture qui attend : tout ce qui suit fait la queue. */
    async function saturated() {
      const fake = gated();
      const db = createDoltClient({ ...options(fake.binary), maxAnalysis: 1 }).open(fake.dir);
      const occupant = db.query("select 'wait'", { lane: 'analysis' });
      await until(() => fake.started().length === 1, 'l’occupant tourne');
      return { fake, db, occupant };
    }

    /**
     * Une lecture que plus personne n'attend : le `Flight` qui la lance ne la garde que le temps de son délai de grâce (une minute, sauf
     * précision), comme celui de l'historique d'un Projet dont la Vue globale a été quittée.
     */
    function retained(db: DoltDatabase, sql: string, graceMs = 60_000) {
      const flight = new Flight((signal) => db.query(sql, { lane: 'analysis', signal }), { graceMs });
      flight.start();
      const asker = new AbortController();
      flight.join(asker.signal).catch(() => undefined);
      asker.abort();
      return flight;
    }

    it('est servie après une lecture qu’on attend, même arrivée plus tard', async () => {
      const { fake, db, occupant } = await saturated();
      const forNobody = retained(db, 'select 1 as retenue');
      const awaited = db.query('select 2 as attendue', { lane: 'analysis' });

      release(fake.dir);
      await Promise.all([occupant, awaited, forNobody.settled]);

      expect(fake.started()).toEqual(["select 'wait'", 'select 2 as attendue', 'select 1 as retenue']);
    });

    it('est pourtant lancée dès qu’une place est libre et que personne d’autre n’attend : la grâce garde son bénéfice', async () => {
      const { fake, db, occupant } = await saturated();
      const forNobody = retained(db, 'select 1 as retenue');

      release(fake.dir);
      await occupant;

      await expect(forNobody.done).resolves.toEqual([]);
      expect(fake.started()).toEqual(["select 'wait'", 'select 1 as retenue']);
    });

    it('reprise pendant le délai, elle est attendue de nouveau et reprend son rang d’arrivée', async () => {
      const { fake, db, occupant } = await saturated();
      const taken = retained(db, 'select 1 as reprise');
      const awaited = db.query('select 2 as attendue', { lane: 'analysis' });

      const back = taken.join(); // une requête redemande la lecture : elle est de nouveau attendue
      release(fake.dir);
      await Promise.all([occupant, awaited, back]);

      expect(fake.started()).toEqual(["select 'wait'", 'select 1 as reprise', 'select 2 as attendue']);
    });

    it('une lecture retenue dépassée par une lecture attendue, puis reprise, reprend son rang d’arrivée à la place libérée suivante : l’état n’est pas mémorisé', async () => {
      const { fake, db, occupant } = await saturated();
      const taken = retained(db, 'select 1 as reprise'); // arrivée la première
      const firstAwaited = db.query("select 'later' as attendue", { lane: 'analysis' }); // prend la place de l'occupant, et la garde jusqu'à `go-later`
      const secondAwaited = db.query('select 3 as suivante', { lane: 'analysis' });

      release(fake.dir); // l'occupant finit : la première lecture attendue passe devant la lecture retenue
      await until(() => fake.started().length === 2, 'la lecture attendue tourne');
      const back = taken.join(); // reprise pendant que la lecture attendue tient la place
      writeFileSync(join(fake.dir, 'go-later'), '');
      await Promise.all([occupant, firstAwaited, secondAwaited, back]);

      expect(fake.started()).toEqual(["select 'wait'", "select 'later' as attendue", 'select 1 as reprise', 'select 3 as suivante']);
    });

    it('entre elles, les lectures retenues gardent leur ordre d’arrivée', async () => {
      const { fake, db, occupant } = await saturated();
      const first = retained(db, 'select 1 as premiere');
      const second = retained(db, 'select 2 as seconde');

      release(fake.dir);
      await Promise.all([occupant, first.settled, second.settled]);

      expect(fake.started()).toEqual(["select 'wait'", 'select 1 as premiere', 'select 2 as seconde']);
    });

    it('une lecture retenue que quelqu’un d’autre attend aussi (même requête, un seul processus) est attendue', async () => {
      const { fake, db, occupant } = await saturated();
      const alone = retained(db, 'select 1 as seule');
      const shared = retained(db, 'select 2 as partagee');
      const alsoAwaited = db.query('select 2 as partagee', { lane: 'analysis' }); // la même lecture, encore en file : un seul processus

      release(fake.dir);
      await Promise.all([occupant, alone.settled, shared.settled, alsoAwaited]);

      expect(fake.started()).toEqual(["select 'wait'", 'select 2 as partagee', 'select 1 as seule']);
      expect(fake.calls()).toBe(3);
    });

    it('ne change rien aux lectures qu’on attend toutes : elles gardent leur ordre d’arrivée', async () => {
      const { fake, db, occupant } = await saturated();
      const others = ['select 1 as a', 'select 2 as b', 'select 3 as c'].map((sql, i) =>
        db.query(sql, i === 1 ? { lane: 'analysis', signal: new AbortController().signal } : { lane: 'analysis' }),
      );

      release(fake.dir);
      await Promise.all([occupant, ...others]);

      expect(fake.started()).toEqual(["select 'wait'", 'select 1 as a', 'select 2 as b', 'select 3 as c']);
    });

    // Les cas limites de la relecture de bdesk-38k.37.

    it('sous un flot de lectures attendues, une lecture retenue ne part jamais : sa grâce l’abandonne, et elle ne laisse ni place perdue ni entrée oubliée dans la file', async () => {
      const { fake, db, occupant } = await saturated();
      const forNobody = retained(db, 'select 1 as retenue', 200);
      // dix lectures attendues de 0,1 s, en file avant que l'occupant ne finisse : la voie en a pour plus d'une seconde, la grâce dure 0,2 s
      const awaited = Array.from({ length: 10 }, (_, i) => db.query(`select 'slow' as s${i}`, { lane: 'analysis' }));

      release(fake.dir);

      await expect(forNobody.done).rejects.toBeInstanceOf(ReadAborted); // abandonnée à la fin de sa grâce, sans avoir jamais été lancée
      await Promise.all([occupant, ...awaited]);
      expect(fake.started()).not.toContain('select 1 as retenue');
      // la place n'a pas fui et la file n'a pas gardé la lecture morte : la même requête, redemandée, est lancée et sert
      await expect(db.query('select 1 as retenue', { lane: 'analysis' })).resolves.toEqual([]);
      expect(fake.started().filter((sql) => sql === 'select 1 as retenue')).toHaveLength(1);
    });

    it('une lecture retenue déjà lancée dont la grâce expire pendant qu’elle tourne va au bout : son processus n’est pas tué et garde sa place jusqu’à sa fin', async () => {
      const fake = gated();
      const db = createDoltClient({ ...options(fake.binary), maxAnalysis: 1 }).open(fake.dir);
      const forNobody = retained(db, "select 'hold' as retenue", 150); // une place est libre : elle part aussitôt, bien qu'idle
      await until(() => fake.started().length === 1, 'la lecture retenue tourne');
      const awaited = db.query('select 2 as attendue', { lane: 'analysis' });

      await until(() => forNobody.abandoned, 'sa grâce a expiré');

      expect(fake.ended()).toEqual([]); // le processus tourne toujours
      expect(fake.started()).toEqual(["select 'hold' as retenue"]); // et sa place n'est pas rendue : la lecture attendue attend
      writeFileSync(join(fake.dir, 'go-hold'), '');
      await awaited;
      await forNobody.settled;
      expect(fake.ended()).toEqual(["select 'hold' as retenue", 'select 2 as attendue']); // allé au bout, puis la place est passée à la suivante
      expect(fake.started()).toEqual(["select 'hold' as retenue", 'select 2 as attendue']);
    });

    it('la reprise d’une lecture retenue déjà lancée ne change rien à la file : son résultat sert la reprise', async () => {
      const fake = gated();
      const db = createDoltClient({ ...options(fake.binary), maxAnalysis: 1 }).open(fake.dir);
      const forNobody = retained(db, "select 'hold' as retenue");
      await until(() => fake.started().length === 1, 'la lecture retenue tourne');
      const awaited = db.query('select 2 as attendue', { lane: 'analysis' });

      const back = forNobody.join();
      writeFileSync(join(fake.dir, 'go-hold'), '');

      await expect(back).resolves.toEqual([]);
      await awaited;
      expect(fake.started()).toEqual(["select 'hold' as retenue", 'select 2 as attendue']);
      expect(fake.calls()).toBe(2);
    });

    it('une lecture retenue qui échoue échoue par l’erreur de dolt, pas par un abandon : sa place est rendue et la voie continue', async () => {
      const { fake, db, occupant } = await saturated();
      const forNobody = retained(db, "select 'boom' as retenue");
      const awaited = db.query('select 2 as attendue', { lane: 'analysis' });

      release(fake.dir);
      await Promise.all([occupant, awaited]);

      await expect(forNobody.done).rejects.toBeInstanceOf(DoltQueryError);
      await expect(db.query('select 3 as apres', { lane: 'analysis' })).resolves.toEqual([]);
      expect(fake.started()).toEqual(["select 'wait'", 'select 2 as attendue', "select 'boom' as retenue", 'select 3 as apres']);
    });

    it('ne touche pas aux autres voies : une lecture légère passe pendant qu’une lecture retenue attend dans la voie des analyses', async () => {
      const fake = gated();
      const db = createDoltClient({ ...options(fake.binary), maxAnalysis: 1, maxLight: 1 }).open(fake.dir);
      const occupant = db.query("select 'wait'", { lane: 'analysis' });
      await until(() => fake.started().length === 1, 'l’occupant tourne');
      const forNobody = retained(db, 'select 1 as retenue');

      await expect(db.query('select 9 as legere', { lane: 'light' })).resolves.toEqual([]);

      expect(fake.started()).toEqual(["select 'wait'", 'select 9 as legere']);
      release(fake.dir);
      await Promise.all([occupant, forNobody.settled]);
    });
  });

  describe('abandon : retire de la file ; un processus lancé va au bout, il n’est jamais tué', () => {
    it('une lecture dont le signal est déjà abandonné ne lance pas dolt', async () => {
      const fake = fakeDolt(`echo '{"rows": []}'`);
      const db = createDoltClient(options(fake.binary)).open(fake.dir);
      const controller = new AbortController();
      controller.abort();

      await expect(db.query('select 1', { signal: controller.signal })).rejects.toBeInstanceOf(ReadAborted);
      await expect(queryAll(db, ['select 1', 'select 2'], { signal: controller.signal })).rejects.toBeInstanceOf(ReadAborted);
      expect(fake.calls()).toBe(0);
    });

    it('retire de la file une lecture abandonnée avant son tour : elle est libérée aussitôt et son processus ne part jamais', async () => {
      const fake = fakeDolt(`echo "$5" >> "$(dirname "$0")/ran"\nsleep 0.5\necho '{"rows": []}'`);
      const db = createDoltClient({ ...options(fake.binary), maxConcurrent: 1 }).open(fake.dir);
      const running = db.query('select 1');
      const controller = new AbortController();
      const queued = db.query('select 2', { signal: controller.signal });
      const behind = db.query('select 3');
      await until(() => fake.calls() >= 1, 'la première lecture a démarré');

      controller.abort();

      await expect(queued).rejects.toBeInstanceOf(ReadAborted); // avant que la première lecture n'ait fini
      await Promise.all([running, behind]);
      expect(lines(join(fake.dir, 'ran')).map((line) => line.replace('start transaction read only; ', ''))).toEqual(['select 1', 'select 3']);
      expect(fake.calls()).toBe(2);
    });

    it('laisse finir le processus d’une lecture abandonnée en cours : le demandeur est libéré aussitôt, et la place n’est rendue qu’à la fin du processus', async () => {
      // Un processus tué en pleine ouverture de la base laisse des fichiers (journal.idx tronqué, nbs_manifest_… que Dolt ne nettoie jamais) :
      // on ne tue donc pas une lecture lancée, on jette son résultat (ADR 0003).
      const fake = fakeDolt(`case "$5" in *wait*)\n${WAIT_FOR_GO};;\nesac\necho '{"rows": [{"ok": 1}]}'`);
      const db = createDoltClient({ ...options(fake.binary), maxConcurrent: 1 }).open(fake.dir);
      const controller = new AbortController();
      const abandoned = db.query("select 'wait'", { signal: controller.signal });
      const next = db.query('select 2'); // attend la place de la précédente
      await until(() => pidIn(join(fake.dir, 'pid')) !== undefined, 'le processus tourne');
      const pid = pidIn(join(fake.dir, 'pid')) ?? 0;

      controller.abort();

      await expect(abandoned).rejects.toBeInstanceOf(ReadAborted); // le demandeur n'attend pas le processus
      await sleep(300); // le temps qu'un éventuel kill arrive
      expect(alive(pid)).toBe(true); // le processus n'est pas tué…
      expect(fake.calls()).toBe(1); // …et la lecture suivante attend toujours sa place
      release(fake.dir);
      await expect(next).resolves.toEqual([{ ok: 1 }]); // la place est rendue quand il a fini
      expect(existsSync(join(fake.dir, 'fini'))).toBe(true); // il est allé au bout
      await until(() => !alive(pid), 'le processus a fini de lui-même');
    });

    it('un délai dépassé reste le seul arrêt d’un processus lancé : une lecture abandonnée qui traîne est tuée à son expiration', async () => {
      const fake = fakeDolt(`echo $$ > "$(dirname "$0")/pid"; exec sleep 30`);
      const db = createDoltClient({ ...options(fake.binary), timeoutMs: 3_000 }).open(fake.dir);
      const controller = new AbortController();
      const reading = db.query('select 1', { signal: controller.signal }).catch((e: unknown) => e);
      await until(() => pidIn(join(fake.dir, 'pid')) !== undefined, 'le processus tourne');
      const pid = pidIn(join(fake.dir, 'pid')) ?? 0;

      controller.abort();

      expect(await reading).toBeInstanceOf(ReadAborted);
      await sleep(200);
      expect(alive(pid)).toBe(true); // l'abandon ne le tue pas
      await until(() => !alive(pid), 'le délai tue le processus'); // le délai (3 s, très au-delà du lancement d'un processus même sur une machine saturée) le tue, pas les 30 s du sommeil
    });

    it('l’abandon n’est ni un délai dépassé ni une panne de la base : c’est une AbortError', async () => {
      const fake = fakeDolt(`${WAIT_FOR_GO}\necho '{"rows": []}'`);
      const db = createDoltClient(options(fake.binary)).open(fake.dir);
      const controller = new AbortController();
      const reading = db.query('select 1', { signal: controller.signal }).catch((e: unknown) => e);
      await until(() => fake.calls() >= 1, 'la lecture a démarré');

      controller.abort();
      const error = await reading;
      release(fake.dir);

      expect(error).toBeInstanceOf(ReadAborted);
      expect(error).not.toBeInstanceOf(DoltQueryError);
      expect(isAbortError(error)).toBe(true);
    });

    it('ne retente pas une lecture abandonnée, et interrompt l’attente entre deux tentatives', async () => {
      const fake = fakeDolt(`echo '${LOCKED}' >&2; exit 1`);
      const db = createDoltClient({ ...options(fake.binary), retryDelayMs: 60_000 }).open(fake.dir);
      const setTimer = vi.spyOn(globalThis, 'setTimeout');
      const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
      try {
        const controller = new AbortController();
        const reading = db.query('select 1', { signal: controller.signal }).catch((e: unknown) => e);
        await until(() => fake.calls() >= 1, 'la première tentative a échoué'); // puis le client attend 60 s avant la suivante
        await until(() => setTimer.mock.calls.some(([, delay]) => delay === 60_000), 'l’attente de 60 s a commencé');
        const index = setTimer.mock.calls.findIndex(([, delay]) => delay === 60_000);
        const retryTimer = setTimer.mock.results[index]?.value;

        controller.abort();

        expect(await reading).toBeInstanceOf(ReadAborted); // sans attendre les 60 s
        expect(fake.calls()).toBe(1);
        expect(clearTimer).toHaveBeenCalledWith(retryTimer); // et la minuterie de l'attente est retirée, pas laissée courir
      } finally {
        setTimer.mockRestore();
        clearTimer.mockRestore();
      }
    });

    it('un groupe de lectures abandonné est un seul processus, laissé finir', async () => {
      const fake = fakeDolt(`${WAIT_FOR_GO}\nprintf '{}\\n\\n{"rows": []}\\n{}\\n\\n{"rows": []}\\n{}\\n\\n{"rows": []}\\n'`);
      const db = createDoltClient(options(fake.binary)).open(fake.dir);
      const controller = new AbortController();
      const reading = queryAll(db, ['select 1', 'select 2', 'select 3'], { signal: controller.signal }).catch((e: unknown) => e);
      await until(() => pidIn(join(fake.dir, 'pid')) !== undefined, 'le processus tourne');
      const pid = pidIn(join(fake.dir, 'pid')) ?? 0;

      controller.abort();

      expect(await reading).toBeInstanceOf(ReadAborted);
      await sleep(300);
      expect(alive(pid)).toBe(true); // un seul processus pour les trois requêtes, et il n'est pas tué
      release(fake.dir);
      await until(() => !alive(pid), 'le processus a fini de lui-même');
      expect(existsSync(join(fake.dir, 'fini'))).toBe(true);
      expect(fake.calls()).toBe(1);
    });

    it('une lecture que personne n’abandonne va jusqu’au bout, signal ou non', async () => {
      const fake = fakeDolt(`echo '{"rows": [{"a": 1}]}'`);
      const db = createDoltClient(options(fake.binary)).open(fake.dir);
      const controller = new AbortController();

      expect(await db.query('select 1', { signal: controller.signal })).toEqual([{ a: 1 }]);
      controller.abort(); // trop tard : rien à interrompre, rien ne casse
      expect(await db.query('select 1')).toEqual([{ a: 1 }]);
    });
  });

  describe('lectures identiques : encore en file, elles ne font qu’un processus', () => {
    /** Chaque appel répond son propre numéro ; « slow » dure. Le journal note les débuts et les fins. */
    const numbered = (seconds: string) => {
      const fake = fakeDolt(
        `log="$(dirname "$0")/events"\nq="\${5#start transaction read only; }"\necho "start $q" >> "$log"\ncase "$q" in *slow*) sleep ${seconds};; esac\necho "end $q" >> "$log"\nprintf '{}\\n\\n{"rows": [{"n": %s}]}\\n' "$n"`,
      );
      return { ...fake, events: () => lines(join(fake.dir, 'events')) };
    };

    it('plusieurs lectures identiques qui attendent une place se partagent un seul processus et le même résultat', async () => {
      const fake = numbered('1');
      const db = createDoltClient({ ...options(fake.binary), maxConcurrent: 1 }).open(fake.dir);
      const blocker = db.query("select 'slow' as blocker");
      await until(() => fake.calls() >= 1, 'la place est prise');

      const same = await Promise.all(Array.from({ length: 10 }, () => db.query('select * from issues')));
      await blocker;

      expect(fake.calls()).toBe(2); // le bloqueur, puis une seule lecture pour les dix
      for (const rows of same) expect(rows).toEqual([{ n: 2 }]);
    });

    it('les groupes identiques aussi', async () => {
      const fake = numbered('1');
      const db = createDoltClient({ ...options(fake.binary), maxConcurrent: 1 }).open(fake.dir);
      const blocker = db.query("select 'slow' as blocker");
      await until(() => fake.calls() >= 1, 'la place est prise');

      await Promise.all(Array.from({ length: 5 }, () => queryAll(db, ['select 1', 'select 2']).catch(() => undefined)));
      await blocker;

      expect(fake.calls()).toBe(2);
    });

    it('une lecture identique à une lecture déjà partie n’y est pas jointe : elle lit à son tour, donc après sa propre arrivée', async () => {
      // Sinon un commit tombé entre-temps échapperait à la seconde : le kanban afficherait l'état d'avant, et plus rien ne le corrigerait.
      const fake = fakeDolt(`sleep 1\nprintf '{}\n\n{"rows": [{"pid": %s}]}\n' "$$"`); // chaque processus répond son propre numéro
      const db = createDoltClient({ ...options(fake.binary), maxConcurrent: 4 }).open(fake.dir);
      const first = db.query("select 'slow' as x");
      await until(() => fake.calls() >= 1, 'la première lecture est partie');

      const second = db.query("select 'slow' as x");

      const [a, b] = await Promise.all([first, second]);
      expect(fake.calls()).toBe(2);
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      expect(a[0]?.pid).not.toBe(b[0]?.pid); // deux processus, donc deux états de la base
    });

    it('des lectures différentes ne sont pas confondues : autre requête, autre base, autre voie', async () => {
      const fake = numbered('1');
      const client = createDoltClient({ ...options(fake.binary), maxConcurrent: 1 });
      const here = client.open(fake.dir);
      const elsewhere = client.open(tmpdir());
      const blocker = here.query("select 'slow' as blocker");
      await until(() => fake.calls() >= 1, 'la place est prise');

      await Promise.all([
        here.query('select 1'),
        here.query('select 2'),
        elsewhere.query('select 1'),
        here.query('select 1', { lane: 'light' }),
        queryAll(here, ['select 1']),
      ]);
      await blocker;

      // Le groupe d'une seule requête et la requête seule sont deux lectures de même texte, et une seule est identique à une autre : 5 distinctes + le bloqueur.
      expect(fake.calls()).toBe(5);
    });

    it('une lecture identique plus tard relit : rien n’est gardé une fois la lecture finie', async () => {
      const fake = numbered('0');
      const db = createDoltClient(options(fake.binary)).open(fake.dir);

      expect(await db.query('select 1')).toEqual([{ n: 1 }]);
      expect(await db.query('select 1')).toEqual([{ n: 2 }]);
    });

    it('un demandeur qui abandonne ne prive pas les autres de la lecture partagée', async () => {
      const fake = numbered('1');
      const db = createDoltClient({ ...options(fake.binary), maxConcurrent: 1 }).open(fake.dir);
      const blocker = db.query("select 'slow' as blocker");
      await until(() => fake.calls() >= 1, 'la place est prise');
      const leaving = new AbortController();
      const gone = db.query('select * from issues', { signal: leaving.signal });
      const stays = db.query('select * from issues');

      leaving.abort();

      await expect(gone).rejects.toBeInstanceOf(ReadAborted);
      expect(await stays).toEqual([{ n: 2 }]);
      await blocker;
      expect(fake.calls()).toBe(2);
    });

    it('quand tous les demandeurs d’une lecture en file abandonnent, elle ne part jamais', async () => {
      const fake = numbered('1');
      const db = createDoltClient({ ...options(fake.binary), maxConcurrent: 1 }).open(fake.dir);
      const blocker = db.query("select 'slow' as blocker");
      await until(() => fake.calls() >= 1, 'la place est prise');
      const [a, b] = [new AbortController(), new AbortController()];
      const first = db.query('select * from issues', { signal: a.signal });
      const second = db.query('select * from issues', { signal: b.signal });

      a.abort();
      b.abort();

      await expect(first).rejects.toBeInstanceOf(ReadAborted);
      await expect(second).rejects.toBeInstanceOf(ReadAborted);
      await blocker;
      await sleep(50);
      expect(fake.calls()).toBe(1); // le bloqueur seul
    });

    it('quand tous les demandeurs d’une lecture partie abandonnent, son processus n’est pas tué : il finit, son résultat est jeté', async () => {
      const fake = fakeDolt(
        `d="$(dirname "$0")"\ncase "$5" in *blocker*) sleep 0.3;; *) echo $$ > "$d/pid$n"; sleep 1.5; echo fini > "$d/fini$n";; esac\necho '{"rows": [{"n": 1}]}'`,
      );
      const db = createDoltClient({ ...options(fake.binary), maxConcurrent: 1 }).open(fake.dir);
      const blocker = db.query("select 'blocker'");
      await until(() => fake.calls() >= 1, 'la place est prise');
      const [a, b] = [new AbortController(), new AbortController()];
      const first = db.query('select 5', { signal: a.signal });
      const second = db.query('select 5', { signal: b.signal });
      await blocker;
      await until(() => pidIn(join(fake.dir, 'pid2')) !== undefined, 'la lecture partagée tourne');
      const pid = pidIn(join(fake.dir, 'pid2')) ?? 0;

      a.abort();
      await expect(first).rejects.toBeInstanceOf(ReadAborted);
      expect(alive(pid)).toBe(true); // b l'attend encore
      b.abort();

      await expect(second).rejects.toBeInstanceOf(ReadAborted);
      await sleep(300);
      expect(alive(pid)).toBe(true); // plus personne ne l'attend, et il n'est pas tué pour autant
      await until(() => !alive(pid), 'le processus a fini de lui-même');
      expect(existsSync(join(fake.dir, 'fini2'))).toBe(true); // il est allé au bout
    });

    it('une lecture abandonnée, retirée de la file, ne sert pas une demande qui arrive ensuite : elle lit', async () => {
      const fake = numbered('1');
      const db = createDoltClient({ ...options(fake.binary), maxConcurrent: 1 }).open(fake.dir);
      const blocker = db.query("select 'slow' as blocker");
      await until(() => fake.calls() >= 1, 'la place est prise');
      const leaving = new AbortController();
      const gone = db.query('select * from issues', { signal: leaving.signal });
      leaving.abort();
      await expect(gone).rejects.toBeInstanceOf(ReadAborted);

      const later = await db.query('select * from issues');

      expect(later).toEqual([{ n: 2 }]);
      await blocker;
    });
  });

  describe('withOptions : les options d’une requête, posées une fois pour toutes les lectures d’une base', () => {
    function recorder() {
      const seen: { sql: string; options: unknown }[] = [];
      const db: DoltDatabase = {
        dir: '/projet',
        async query(sql, queryOptions) {
          seen.push({ sql, options: queryOptions });
          return [];
        },
        async queryAll(sqls, queryOptions) {
          seen.push({ sql: sqls.join('|'), options: queryOptions });
          return sqls.map((): Row[] => []);
        },
      };
      return { db, seen };
    }

    it('ajoute le signal à chaque lecture, groupée ou non', async () => {
      const { db, seen } = recorder();
      const controller = new AbortController();
      const scoped = withOptions(db, { signal: controller.signal });

      await scoped.query('select 1');
      await queryAll(scoped, ['select 2', 'select 3']);

      expect(scoped.dir).toBe('/projet');
      expect(seen).toEqual([
        { sql: 'select 1', options: { signal: controller.signal } },
        { sql: 'select 2|select 3', options: { signal: controller.signal } },
      ]);
    });

    it('laisse la lecture préciser ses propres options : une autre voie, par exemple, ou un autre signal', async () => {
      const { db, seen } = recorder();
      const [outer, inner] = [new AbortController(), new AbortController()];
      const scoped = withOptions(db, { signal: outer.signal });

      await scoped.query('select 1', { lane: 'light' });
      await scoped.query('select 2', { signal: inner.signal });

      expect(seen).toEqual([
        { sql: 'select 1', options: { signal: outer.signal, lane: 'light' } },
        { sql: 'select 2', options: { signal: inner.signal } },
      ]);
    });

    it('n’invente pas de lecture groupée à une base qui n’en a pas', () => {
      const plain: DoltDatabase = { dir: '/projet', query: async () => [] };

      expect(withOptions(plain, { signal: new AbortController().signal }).queryAll).toBeUndefined();
    });
  });
});
