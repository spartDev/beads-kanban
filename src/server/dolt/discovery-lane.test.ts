import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakeDolt } from '../testing/fake-dolt';
import { createDoltClient } from './client';

/**
 * La voie de la découverte (bdesk-38k.28) : le préfixe que lit chaque scan des Projets a sa voie, comme le HEAD a la sienne. Un rescan
 * de nombreux Projets met en file autant de lectures qu'il y a de Projets (quarante, une centaine de millisecondes chacune) : dans la
 * voie du HEAD, la lecture du HEAD d'une demande arrivée pendant le scan attendait derrière toutes.
 */

const options = (binary: string) => ({ binary, retryDelayMs: 1, rootPath: join(tmpdir(), 'bdesk-fake-dolt-root') });
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
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

/** Les requêtes qui contiennent « slow » durent ; les autres sont immédiates. Chaque processus note son début et sa fin. */
const slowDolt = (seconds: string) => {
  const fake = fakeDolt(
    `log="$(dirname "$0")/events"\nq="\${5#start transaction read only; }"\necho "start $q" >> "$log"\ncase "$q" in *slow*) sleep ${seconds};; esac\necho "end $q" >> "$log"\necho '{"rows": []}'`,
  );
  return { ...fake, events: () => lines(join(fake.dir, 'events')) };
};

describe.skipIf(process.platform === 'win32')('voie de la découverte', { timeout: 30_000 }, () => {
  it('une lecture légère s’exécute pendant que toutes les places de la découverte sont prises, avant même que la première finisse', async () => {
    const fake = slowDolt('5'); // assez long pour qu'une machine saturée lance le processus léger avant la fin des lectures de la découverte
    const db = createDoltClient({ ...options(fake.binary), maxDiscovery: 1 }).open(fake.dir);
    const stop = new AbortController();
    const scan = ['a', 'b', 'c'].map((name) => db.query(`select 'slow' as ${name}`, { lane: 'discovery', signal: stop.signal }).catch(() => undefined));
    await until(() => fake.events().length >= 1, 'la première lecture de la découverte a démarré');

    await db.query("select hashof('HEAD')", { lane: 'light' });

    expect(fake.events()).toEqual(["start select 'slow' as a", "start select hashof('HEAD')", "end select hashof('HEAD')"]);
    stop.abort(); // inutile d'attendre cinq secondes trois fois
    await Promise.all(scan);
  });

  it('la découverte s’exécute pendant que toutes les places légères et normales sont prises', async () => {
    const fake = slowDolt('5');
    const db = createDoltClient({ ...options(fake.binary), maxLight: 1, maxConcurrent: 1 }).open(fake.dir);
    const stop = new AbortController();
    const busy = [
      db.query("select 'slow' as light", { lane: 'light', signal: stop.signal }).catch(() => undefined),
      db.query("select 'slow' as normal", { signal: stop.signal }).catch(() => undefined),
    ];
    await until(() => fake.events().length >= 2, 'les places légère et normale sont prises');

    await db.query("select `value` from config where `key` = 'issue_prefix'", { lane: 'discovery' });

    expect(fake.events().filter((line) => line.includes('issue_prefix'))).toEqual([
      "start select `value` from config where `key` = 'issue_prefix'",
      "end select `value` from config where `key` = 'issue_prefix'",
    ]);
    stop.abort();
    await Promise.all(busy);
  });

  it('la voie de la découverte est bornée par maxDiscovery (quatre par défaut)', async () => {
    const bounded = slowDolt('0.5');
    const db = createDoltClient({ ...options(bounded.binary), maxDiscovery: 2 }).open(bounded.dir);
    await Promise.all(Array.from({ length: 6 }, (_, i) => db.query(`select 'slow' as d${i}`, { lane: 'discovery' })));
    expect(peak(join(bounded.dir, 'events'))).toBe(2);
    expect(bounded.calls()).toBe(6);

    const byDefault = slowDolt('0.5');
    const other = createDoltClient(options(byDefault.binary)).open(byDefault.dir);
    await Promise.all(Array.from({ length: 10 }, (_, i) => other.query(`select 'slow' as d${i}`, { lane: 'discovery' })));
    expect(peak(join(byDefault.dir, 'events'))).toBe(4);
  });

  it('les voies tournent ensemble : la découverte ne prend la place d’aucune autre', async () => {
    const fake = slowDolt('0.6');
    const db = createDoltClient({ ...options(fake.binary), maxConcurrent: 1, maxLight: 1, maxAnalysis: 1, maxDiscovery: 1 }).open(fake.dir);

    await Promise.all([
      db.query("select 'slow' as n"),
      db.query("select 'slow' as l", { lane: 'light' }),
      db.query("select 'slow' as a", { lane: 'analysis' }),
      db.query("select 'slow' as d", { lane: 'discovery' }),
    ]);

    expect(peak(join(fake.dir, 'events'))).toBe(4);
  });
});
