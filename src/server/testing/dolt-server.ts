import { execFile, spawn } from 'node:child_process';
import { type AddressInfo, connect, createServer } from 'node:net';

/**
 * Un `dolt sql-server` lancé pour un test, dans le dossier d'une base jetable (bdesk-38k.44). Tant qu'il tourne, `dolt sql -r json -q`
 * lancé dans ce dossier, donc toute lecture du client Dolt de l'app, passe par lui : c'est ce que le CLI fait de lui-même quand un
 * serveur tourne pour la base (`.dolt/sql-server.info`), comme pour un Projet en mode server dont la base est locale, ou un Projet
 * embedded dont quelqu'un a lancé un serveur.
 */
export interface SqlServer {
  /** Le port de 127.0.0.1 où il écoute : un port libre au moment du lancement, jamais celui d'un autre serveur. */
  readonly port: number;
  /** L'arrête et attend sa fin : le port est libre ensuite, et la base de nouveau lue directement. Sans effet s'il est déjà arrêté. */
  stop(): Promise<void>;
}

/**
 * Le superviseur : un petit processus Node qui lance `dolt sql-server` sur le port de son premier argument et ne lui survit pas. Il l'arrête (SIGINT,
 * puis SIGKILL au bout de 20 s) quand son entrée standard se ferme, ou qu'il reçoit un signal d'arrêt, et sort dès que le serveur sort. L'entrée se
 * ferme quand `stop()` le demande, mais aussi quand le processus qui l'a lancé disparaît, quelle qu'en soit la cause : le noyau en ferme alors le tube.
 * C'est le cas que ni `process.on('exit')` ni un signal ne couvrent, un SIGKILL du worker de test (manque de mémoire, `kill -9`, délai que le lanceur
 * fait respecter par la force). Le serveur ne reste ainsi jamais orphelin, sauf si son superviseur est tué à son tour par un SIGKILL.
 *
 * La sortie standard du serveur est envoyée sur l'erreur standard du superviseur (le descripteur 2), la seule que `startSqlServer` lit : `dolt` y écrit
 * ses erreurs de démarrage, dont `Port N already in use.`, et la sortie standard du superviseur est ignorée.
 */
const SUPERVISOR = `
const { spawn } = require('node:child_process');
const server = spawn('dolt', ['sql-server', '--host', '127.0.0.1', '--port', process.argv[1], '--loglevel', 'error'], { stdio: ['ignore', 2, 'inherit'] });
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  server.kill('SIGINT');
  setTimeout(() => server.kill('SIGKILL'), 20000);
};
server.on('error', (error) => {
  console.error(String(error));
  process.exit(1);
});
server.on('exit', (code) => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, stop);
process.stdin.on('end', stop).on('close', stop).on('error', stop).resume();
`;

/**
 * Un port libre de 127.0.0.1. Un autre processus peut le prendre avant que `dolt` ne le demande : `dolt` refuse alors de démarrer (`Port N already
 * in use.`, sur sa sortie standard) et `startSqlServer` choisit un autre port (trois essais au plus).
 */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** Quelque chose accepte-t-il les connexions sur ce port ? */
function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

/**
 * Le port que `dolt sql`, lancé dans `dir`, voit annoncer par son moteur (`@@port`), ou undefined si la lecture échoue. Sans serveur, dolt lit les
 * fichiers lui-même et son moteur répond le port par défaut (3306) ; avec un serveur, c'est le sien. C'est le témoin qu'une lecture est passée par
 * le serveur, quel que soit le type des valeurs qu'il rend (un nombre sans serveur, une chaîne avec : `String` les rend comparables).
 */
export function servedPort(env: NodeJS.ProcessEnv, dir: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('dolt', ['sql', '-r', 'json', '-q', 'select @@port as port'], { cwd: dir, env, timeout: 30_000 }, (error, stdout) => {
      if (error) return resolve(undefined);
      try {
        const port = (JSON.parse(stdout) as { rows?: { port?: unknown }[] }).rows?.[0]?.port;
        resolve(port === undefined ? undefined : String(port));
      } catch {
        resolve(undefined);
      }
    });
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Un démarrage raté qu'un autre port répare, d'après ce que `dolt` a écrit : le port est pris (`Port N already in use.`, ou `bind:` pour une erreur de
 * liaison du système), ou la base est tenue par un autre processus (`database "db" is locked by another dolt process…`). Le second cas découle du
 * premier : un port pris accepte déjà les connexions, donc `startSqlServer` lance `dolt sql` (`servedPort`) sans attendre le serveur, et cette lecture
 * tient la base au moment où le serveur la prend, avant qu'il ait vu que le port est pris (mesuré avec Dolt 2.5.0 : la base tenue est signalée la première).
 */
export function retryableStartFailure(output: string): boolean {
  return /already in use|bind:|is locked by another dolt process/i.test(output);
}

/**
 * Lance un `dolt sql-server` sur un port libre dans `dir` (avec l'environnement isolé `env`) et ne rend la main que quand il répond : `dolt sql`
 * y est alors passé (`servedPort`). Il écoute 127.0.0.1 seulement. Son arrêt (`stop`) est à la charge de l'appelant, en `afterAll`. Un appelant qui
 * l'oublie, ou qui disparaît, même par SIGKILL, ne laisse pas le serveur : voir `SUPERVISOR`.
 *
 * `dir` est une base (créée par `createDatabase`), ou un dossier qui en contient (`.beads/dolt` d'un Projet en mode server : un serveur lancé là
 * sert les bases qu'il contient) : `databaseDir` est alors la base où `dolt sql` doit passer par le serveur.
 *
 * Si le port choisi est pris entre-temps, `dolt` refuse de démarrer (`retryableStartFailure`) et on en choisit un autre, trois essais au plus ; l'erreur
 * finale dit alors ce que `dolt` a écrit. `choosePort` (`freePort` par défaut) permet à un test d'imposer un port déjà pris.
 */
export async function startSqlServer(
  env: NodeJS.ProcessEnv,
  dir: string,
  { timeoutMs = 90_000, databaseDir = dir, choosePort = freePort }: { timeoutMs?: number; databaseDir?: string; choosePort?: () => Promise<number> } = {},
): Promise<SqlServer> {
  for (let attempt = 1; ; attempt++) {
    const port = await choosePort();
    const child = spawn(process.execPath, ['-e', SUPERVISOR, String(port)], { cwd: dir, env, stdio: ['pipe', 'ignore', 'pipe'] });
    child.stdin.on('error', () => undefined); // le superviseur est déjà parti : rien à lui dire
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    let ended = false;
    const exited = new Promise<void>((resolve) => {
      const end = () => {
        ended = true;
        resolve();
      };
      child.once('exit', end);
      child.once('error', (error) => {
        stderr += String(error); // introuvable, droits…
        end();
      });
    });
    const stop = async () => {
      if (ended) return;
      child.stdin.end(); // le superviseur arrête le serveur (SIGINT, SIGKILL au bout de 20 s) et sort avec lui
      const forced = setTimeout(() => child.kill('SIGKILL'), 30_000);
      await exited;
      clearTimeout(forced);
    };

    const deadline = Date.now() + timeoutMs;
    let served = false;
    while (!ended && !served && Date.now() < deadline) {
      // On ne lance `dolt sql` qu'une fois le port ouvert : avant, il lirait les fichiers lui-même, en concurrence avec le démarrage du serveur
      // (un port pris est ouvert aussi : voir `retryableStartFailure`).
      served = (await listening(port)) && (await servedPort(env, databaseDir)) === String(port);
      if (!served) await sleep(200);
    }
    if (served) return { port, stop };

    const timedOut = !ended;
    await stop();
    if (retryableStartFailure(stderr) && attempt < 3) continue; // un autre processus a pris le port entre le choix et le lancement
    throw new Error(`dolt sql-server n'a pas répondu sur le port ${port} (${timedOut ? `délai de ${timeoutMs} ms dépassé` : `arrêté : ${stderr.trim() || 'sans message'}`})`);
  }
}
