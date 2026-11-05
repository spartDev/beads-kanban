import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { type AddressInfo, createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDatabase, hasBinary, isolatedDoltEnv } from './dolt-fixture';
import { freePort, retryableStartFailure, servedPort, startSqlServer } from './dolt-server';
import { scratchDir } from './scratch';

/** La racine du dépôt, où `tsx` est installé. */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
/** Le processus parent d'un serveur d'essai, que le test tue ou laisse sortir. */
const PARENT = fileURLToPath(new URL('./dolt-server-parent.ts', import.meta.url));

/** Le port est-il libre sur 127.0.0.1 ? */
const isFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });

/** Un port de 127.0.0.1 que ce test occupe, comme un autre processus qui l'aurait pris après son choix par `freePort`, avant que `dolt` ne le demande. */
async function occupiedPort(): Promise<{ port: number; release(): Promise<void> }> {
  const thief = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    thief.once('error', reject);
    thief.listen(0, '127.0.0.1', resolve);
  });
  return { port: (thief.address() as AddressInfo).port, release: () => new Promise<void>((resolve) => thief.close(() => resolve())) };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Attend que `condition` soit vraie (interrogée toutes les 250 ms) ; fausse au bout de `timeoutMs`. */
async function until(condition: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() >= deadline) return false;
    await sleep(250);
  }
  return true;
}

/** Le port que le processus parent annonce par sa première ligne de sortie. */
function announcedPort(parent: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let text = '';
    parent.stdout?.on('data', (chunk: Buffer) => {
      text += chunk.toString();
      if (!text.includes('\n')) return;
      try {
        resolve((JSON.parse(text.split('\n')[0] ?? '') as { port: number }).port);
      } catch (error) {
        reject(error);
      }
    });
    parent.once('close', (code, signal) => reject(new Error(`le processus parent s'est arrêté avant d'annoncer son serveur (${signal ?? code})`)));
  });
}

const hasExited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;
const exited = (child: ChildProcess) => (hasExited(child) ? Promise.resolve() : new Promise<void>((resolve) => child.once('exit', () => resolve())));

/** Le serveur de la base `dir`, s'il tourne encore (son pid est dans `.dolt/sql-server.info`, que dolt retire à un arrêt propre) : on ne laisse pas un serveur à un test qui échoue. */
function killServerOf(dir: string): void {
  try {
    const pid = Number(readFileSync(join(dir, '.dolt', 'sql-server.info'), 'utf8').split(':')[0]);
    if (Number.isInteger(pid) && pid > 1) process.kill(pid, 'SIGKILL');
  } catch {
    // arrêté proprement, ou jamais lancé : rien à tuer
  }
}

// Les textes de Dolt 2.5.0, recopiés de ses sorties (un serveur sur un port pris ; un serveur lancé pendant qu'un `dolt sql` tient la base).
const CONFIG = 'Starting server with Config HP="127.0.0.1:60403"|T="28800000"|R="false"|L="error"';
describe('retryableStartFailure : quand un autre port répare le démarrage', () => {
  it.each([
    ['un port pris', `${CONFIG}\nPort 60403 already in use.`],
    ['une base tenue par un autre dolt (la sonde du helper, port pris)', `${CONFIG}\ndatabase "db" is locked by another dolt process; either clone the database to run a second server, or stop the dolt process which currently holds an exclusive write lock on the database`],
    ['une liaison refusée par le système', 'listen tcp 127.0.0.1:3306: bind: address already in use'],
  ])('%s : oui', (_name, output) => expect(retryableStartFailure(output)).toBe(true));

  it.each([
    ['aucun message', ''],
    ['dolt introuvable', 'Error: spawn dolt ENOENT'],
    ['un serveur démarré puis arrêté', CONFIG],
    ['un drapeau inconnu', 'flag provided but not defined: -nope'],
  ])('%s : non', (_name, output) => expect(retryableStartFailure(output)).toBe(false));
});

describe.skipIf(!hasBinary('dolt'))('le dolt sql-server d’essai (bdesk-38k.44)', { timeout: 120_000 }, () => {
  it('sert la base sur un port libre où `dolt sql` passe, puis s’arrête en libérant le port et la base', async () => {
    const env = isolatedDoltEnv();
    const dir = join(realpathSync(scratchDir('bdesk-sql-server-helper-')), 'db');
    const db = createDatabase(env, dir);
    db.sql('create table t (id int primary key, n int); insert into t values (1, 7)');
    db.commit(1, 'x');
    expect(await servedPort(env, dir)).toBe('3306'); // sans serveur, dolt lit les fichiers lui-même : le moteur répond son port par défaut
    expect(db.rows('select n from t')).toEqual([{ n: 7 }]);

    const server = await startSqlServer(env, dir);
    try {
      expect(server.port).toBeGreaterThan(1023);
      expect(await servedPort(env, dir)).toBe(String(server.port));
      expect(await isFree(server.port)).toBe(false);
      expect(db.rows('select n from t')).toEqual([{ n: '7' }]); // servi par le serveur : les entiers arrivent en chaînes
    } finally {
      await server.stop();
    }

    expect(await isFree(server.port)).toBe(true);
    expect(await servedPort(env, dir)).toBe('3306');
    expect(db.rows('select n from t')).toEqual([{ n: 7 }]);
    await expect(server.stop()).resolves.toBeUndefined(); // déjà arrêté : sans effet
  });

  // `dolt` écrit `Port N already in use.` sur sa sortie standard, non sur l'erreur : si le superviseur ne la relaie pas, le port pris n'est pas reconnu
  // et l'essai échoue sans réessayer ni dire pourquoi.
  it('choisit un autre port quand celui qu’il avait choisi vient d’être pris, et sert la base', async () => {
    const env = isolatedDoltEnv();
    const dir = join(realpathSync(scratchDir('bdesk-sql-server-busy-')), 'db');
    const db = createDatabase(env, dir);
    db.sql('create table t (id int primary key, n int); insert into t values (1, 7)');
    db.commit(1, 'x');
    const thief = await occupiedPort();
    const picked: number[] = [];
    try {
      const server = await startSqlServer(env, dir, {
        choosePort: async () => {
          const port = picked.length === 0 ? thief.port : await freePort(); // le premier est déjà pris
          picked.push(port);
          return port;
        },
      });
      try {
        expect(picked).toHaveLength(2);
        expect(server.port).toBe(picked[1]);
        expect(await servedPort(env, dir)).toBe(String(server.port));
        expect(db.rows('select n from t')).toEqual([{ n: '7' }]);
      } finally {
        await server.stop();
      }
    } finally {
      await thief.release();
    }
  });

  it('abandonne au troisième port pris, en rapportant ce que dolt a écrit', async () => {
    const env = isolatedDoltEnv();
    const dir = join(realpathSync(scratchDir('bdesk-sql-server-busy-')), 'db');
    createDatabase(env, dir);
    const thief = await occupiedPort();
    let picks = 0;
    try {
      await expect(
        startSqlServer(env, dir, {
          choosePort: async () => {
            picks++;
            return thief.port;
          },
        }),
      ).rejects.toThrow(new RegExp(`Port ${thief.port} already in use|is locked by another dolt process`)); // dolt le dit : jamais « sans message »
      expect(picks).toBe(3);
    } finally {
      await thief.release();
    }
  });

  // Le démarrage échoue aussi, sur « locked by another dolt process », quand un autre `dolt` tient la base à cet instant : c'est ce que fait la sonde
  // `dolt sql` du helper quand le port choisi est pris (il accepte déjà les connexions). Un autre port répare cela aussi.
  it('choisit un autre port quand un autre dolt tient la base au moment du démarrage', async () => {
    const env = isolatedDoltEnv();
    const dir = join(realpathSync(scratchDir('bdesk-sql-server-locked-')), 'db');
    createDatabase(env, dir);
    const holder = spawn('dolt', ['sql'], { cwd: dir, env, stdio: ['pipe', 'pipe', 'inherit'] }); // il tient la base tant que son entrée reste ouverte
    try {
      await new Promise<void>((resolve, reject) => {
        let out = '';
        holder.stdout.on('data', (chunk: Buffer) => {
          out += chunk.toString();
          if (out.includes('ready')) resolve(); // la première instruction est exécutée : la base est ouverte
        });
        holder.once('error', reject);
        holder.once('close', () => reject(new Error('dolt sql s’est arrêté avant d’exécuter la première instruction')));
        holder.stdin.write("select 'ready' as r;\n");
      });
      let picks = 0;
      const server = await startSqlServer(env, dir, {
        choosePort: async () => {
          if (picks++ > 0) {
            holder.stdin.end(); // le premier essai a échoué sur la base tenue : on la libère
            await exited(holder);
          }
          return freePort();
        },
      });
      try {
        expect(picks).toBe(2);
        expect(await servedPort(env, dir)).toBe(String(server.port));
      } finally {
        await server.stop();
      }
    } finally {
      holder.kill('SIGKILL'); // sans effet s'il est déjà parti
    }
  });

  // Un worker de test que l'on tue (SIGKILL : manque de mémoire, `kill -9`, délai que le lanceur fait respecter par la force) ne passe par aucun
  // gestionnaire d'`exit` : le serveur ne doit pourtant pas lui survivre, ni rester avec son port et ses fichiers.
  it.each([
    ['est tué par SIGKILL', 'kill'],
    ['sort sans avoir arrêté le serveur', 'exit'],
  ] as const)('arrête le serveur quand le processus qui l’a lancé %s', async (_name, how) => {
    const env = isolatedDoltEnv();
    const dir = join(realpathSync(scratchDir('bdesk-sql-server-orphan-')), 'db');
    createDatabase(env, dir);
    const parent = spawn(process.execPath, ['--import', 'tsx', PARENT, dir, how], { cwd: ROOT, env, stdio: ['pipe', 'pipe', 'inherit'] });
    try {
      const port = await announcedPort(parent);
      expect(await servedPort(env, dir)).toBe(String(port)); // il tourne, et dolt y passe
      if (how === 'kill') parent.kill('SIGKILL');
      else parent.stdin?.write('sors\n'); // il sort sans avoir arrêté le serveur
      await exited(parent);

      const stopped = await until(async () => (await isFree(port)) && (await servedPort(env, dir)) === '3306', 30_000);
      expect(stopped, 'le serveur tourne encore, orphelin').toBe(true);
    } finally {
      parent.kill('SIGKILL'); // sans effet s'il est déjà parti
      killServerOf(dir);
    }
  });

  // Le worker meurt après l'annonce du port, avant que le test ne tue le parent : le noyau ferme alors l'entrée du parent, qui ne doit pas lui survivre. Sinon
  // il garde son superviseur, donc le serveur, pour toujours (le superviseur ne voit son entrée se fermer que quand le parent disparaît).
  it('arrête le serveur quand le processus qui l’a lancé disparaît avant qu’on ne tue le parent', async () => {
    const env = isolatedDoltEnv();
    const dir = join(realpathSync(scratchDir('bdesk-sql-server-orphan-')), 'db');
    createDatabase(env, dir);
    const parent = spawn(process.execPath, ['--import', 'tsx', PARENT, dir, 'kill'], { cwd: ROOT, env, stdio: ['pipe', 'pipe', 'inherit'] });
    try {
      const port = await announcedPort(parent);
      expect(await servedPort(env, dir)).toBe(String(port)); // il tourne, et dolt y passe
      parent.stdin?.end(); // ce que fait le noyau à la mort du lanceur : il ferme son bout du tube
      expect(await until(async () => hasExited(parent), 30_000), 'le parent survit à son lanceur').toBe(true);

      const stopped = await until(async () => (await isFree(port)) && (await servedPort(env, dir)) === '3306', 30_000);
      expect(stopped, 'le serveur tourne encore, orphelin').toBe(true);
    } finally {
      parent.kill('SIGKILL'); // sans effet s'il est déjà parti
      killServerOf(dir);
    }
  });
});
