import { type ExecFileException, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DoltNotFoundError, DoltQueryError } from './errors';
import { assertReadOnly, READ_ONLY_PREFIX } from './read-only';

export { DoltNotFoundError, DoltQueryError };

/** Ligne de résultat de `dolt sql -r json` : les colonnes NULL sont absentes de l'objet. */
export type Row = Record<string, unknown>;

/** Une base Dolt (dossier contenant `.dolt/`), interrogée en lecture seule. */
export interface DoltDatabase {
  readonly dir: string;
  /**
   * Exécute une seule requête de lecture (SELECT, SHOW, DESCRIBE, EXPLAIN, WITH … SELECT) et renvoie ses lignes.
   * Un échec est une `DoltQueryError` (ou une `DoltNotFoundError`), jamais une erreur brute de Node : son message
   * citerait la requête, qui n'a pas sa place dans une réponse HTTP. Le refus du garde-fou (`ReadOnlyViolation`)
   * est une `DoltQueryError`, lui aussi sans la requête.
   */
  query(sql: string): Promise<Row[]>;
}

export interface DoltClientOptions {
  /** Binaire à lancer (défaut : `dolt`, cherché dans le PATH). */
  binary?: string;
  /** Nouvelles tentatives quand la base est verrouillée (défaut : 4). */
  retries?: number;
  /** Attente avant la première nouvelle tentative, doublée à chaque fois (défaut : 100 ms). */
  retryDelayMs?: number;
  /** Délai maximal d'une requête (défaut : 60 s). */
  timeoutMs?: number;
  /** Taille maximale du résultat d'une requête, en octets (défaut : 512 Mo). */
  maxOutputBytes?: number;
  /** Nombre maximal de processus `dolt` simultanés (défaut : 6). */
  maxConcurrent?: number;
  /** Nombre maximal de lectures en attente d'un processus libre (défaut : 1000) ; au-delà, elles échouent aussitôt. */
  maxQueued?: number;
  /**
   * Dossier de configuration globale de dolt (`DOLT_ROOT_PATH`). Par défaut un dossier privé de l'app, qui
   * désactive l'envoi des métriques de dolt (un second processus par requête) ; un `DOLT_ROOT_PATH` déjà
   * défini dans l'environnement est respecté. Ce dossier est partagé par tous les processus de l'app : son
   * `config_global.json` n'est réécrit que s'il est périmé, et d'un coup (voir `writeFileAtomically`).
   * S'il est inutilisable (lien symbolique, dossier d'un autre utilisateur, rien d'inscriptible…), dolt reçoit un dossier
   * de repli jetable, propre au processus et configuré de même ; si même celui-là est impossible, les lectures échouent
   * (`DoltQueryError`) sans lancer dolt. Il n'est jamais lancé sans `DOLT_ROOT_PATH` : il écrirait dans le `~/.dolt` de
   * l'utilisateur, y rétablirait l'envoi de ses métriques d'usage et y laisserait ses fichiers.
   */
  rootPath?: string;
}

export interface DoltClient {
  open(dir: string): DoltDatabase;
}

const LOCK_ERROR = /locked by another dolt process|database is locked|timeout acquiring lock|file is locked|resource temporarily unavailable/i;

export function createDoltClient(options: DoltClientOptions = {}): DoltClient {
  const {
    binary = 'dolt',
    retries = 4,
    retryDelayMs = 100,
    timeoutMs = 60_000,
    maxOutputBytes = 512 * 1024 * 1024,
    maxConcurrent = 6,
    maxQueued = 1000,
    rootPath = process.env.DOLT_ROOT_PATH ? undefined : defaultRootPath(),
  } = options;
  const env = { ...process.env, ...(rootPath ? doltEnv(rootPath) : {}) };
  // Sans DOLT_ROOT_PATH, dolt se rabat sur le ~/.dolt de l'utilisateur : il y crée ses fichiers et y rétablit l'envoi des métriques.
  let refusal: DoltQueryError | undefined;
  if (!env.DOLT_ROOT_PATH) {
    try {
      env.DOLT_ROOT_PATH = fallbackRootPath();
    } catch (err) {
      const reason = err instanceof Error ? String((err as NodeJS.ErrnoException).code ?? err.name) : 'erreur inconnue';
      refusal = new DoltQueryError(
        `Impossible de préparer un dossier de configuration privé pour dolt dans ${tmpdir()} (${reason}) : dolt n'est pas lancé, car il écrirait dans le ~/.dolt de l'utilisateur.`,
        '',
        false,
        err,
      );
    }
  }
  const limit = createLimiter(maxConcurrent, maxQueued);

  async function query(dir: string, sql: string): Promise<Row[]> {
    assertReadOnly(sql);
    if (refusal) throw refusal;
    for (let attempt = 0; ; attempt++) {
      try {
        return await limit(() => run(binary, dir, sql, env, timeoutMs, maxOutputBytes));
      } catch (err) {
        if (err instanceof QueueFull) throw new DoltQueryError(`Trop de lectures Dolt en attente (plus de ${maxQueued}) : réessayez dans un instant.`, dir);
        if (!(err instanceof DoltQueryError) || !err.locked || attempt >= retries) throw typed(err, binary, dir, sql);
        await sleep(retryDelayMs * 2 ** attempt);
      }
    }
  }

  return { open: (dir) => ({ dir, query: (sql) => query(dir, sql) }) };
}

function run(binary: string, dir: string, sql: string, env: NodeJS.ProcessEnv, timeoutMs: number, maxOutputBytes: number): Promise<Row[]> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      ['sql', '-r', 'json', '-q', READ_ONLY_PREFIX + sql],
      { cwd: dir, env, timeout: timeoutMs, maxBuffer: maxOutputBytes, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) return reject(toError(error, binary, dir, withoutQuery(stderr, sql), timeoutMs, maxOutputBytes));
        try {
          resolve(parseRows(stdout));
        } catch (err) {
          reject(new DoltQueryError(`Sortie de dolt illisible : ${(err as Error).message}`, dir));
        }
      },
    );
  });
}

/** Les lignes du résultat. Avec la transaction en lecture seule, dolt écrit d'abord un document `{}` vide, puis le résultat. */
function parseRows(stdout: string): Row[] {
  const rows: Row[] = [];
  for (const document of jsonDocuments(stdout)) {
    const documentRows = (JSON.parse(document) as { rows?: unknown }).rows;
    if (Array.isArray(documentRows)) for (const row of documentRows) rows.push(row as Row);
  }
  return rows;
}

/** Les documents JSON mis bout à bout dans la sortie de dolt. */
function jsonDocuments(text: string): string[] {
  const documents: string[] = [];
  let depth = 0;
  let start = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '{' || c === '[') {
      if (depth++ === 0) start = i;
    } else if (c === '}' || c === ']') {
      if (--depth === 0) documents.push(text.slice(start, i + 1));
      else if (depth < 0) throw new Error('JSON mal formé');
    } else if (depth === 0 && c.trim() !== '') {
      throw new Error(`texte inattendu hors d'un document JSON (« ${c} »)`);
    }
  }
  if (depth !== 0 || inString) throw new Error('document JSON tronqué');
  return documents;
}

function toError(
  error: ExecFileException,
  binary: string,
  dir: string,
  stderr: string,
  timeoutMs: number,
  maxOutputBytes: number,
): Error {
  if (error.code === 'ENOENT') {
    // ENOENT vient aussi d'un `cwd` absent : on ne le confond pas avec un binaire manquant.
    return existsSync(dir) ? new DoltNotFoundError(binary) : new DoltQueryError(`Dossier introuvable : ${dir}`, dir);
  }
  // Selon la version de Node, le processus tué pour avoir trop écrit est aussi marqué `killed` : on le teste avant le délai.
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return new DoltQueryError(`Sortie de dolt trop volumineuse (plus de ${formatBytes(maxOutputBytes)}) pour lire ${dir}`, dir);
  }
  if (error.killed) return new DoltQueryError(`Délai dépassé (${timeoutMs} ms) pour lire ${dir}`, dir);
  // Dolt écrit ses erreurs sur stderr ; stdout n'a que les documents JSON des instructions réussies (le `{}` de la
  // transaction en lecture seule, des lignes de résultat) : jamais un message.
  const detail = firstLines(stderr) || describeFailure(error, binary);
  return new DoltQueryError(detail, dir, LOCK_ERROR.test(detail));
}

/**
 * Pourquoi dolt s'est arrêté sans rien dire. On ne reprend pas `error.message` : celui de Node cite la ligne de
 * commande (« Command failed: dolt sql -r json -q start transaction read only; select … »), requête comprise.
 */
function describeFailure(error: ExecFileException, binary: string): string {
  if (error.signal) return `dolt a été interrompu (${error.signal}) sans message d'erreur`;
  if (typeof error.code === 'number') return `dolt a échoué (code de sortie ${error.code}) sans message d'erreur`;
  return `Impossible de lancer « ${binary} » : ${error.code ?? 'cause inconnue'}.`;
}

/**
 * Dolt répète l'instruction en échec avant sa cause (« error on line 1 for query <instruction>: <cause> »). On la
 * retire : sur une requête de plusieurs lignes, la cause arrive après les lignes que `firstLines` garde, et la
 * requête n'a pas sa place dans un message d'erreur. Dolt la cite sans les blancs qui la précèdent ni le `;` qui la
 * termine (« select 1; » devient « select 1 ») : c'est cette forme rognée que l'on cherche. Il ne la répète pas
 * toujours telle quelle (commentaire après le `;`, en tête de requête…) : alors rien n'est retiré.
 */
function withoutQuery(text: string, sql: string): string {
  // Une boucle plutôt que /[\s;]+$/ : cette expression est quadratique sur une longue suite de blancs.
  let end = sql.length;
  while (end > 0 && /[\s;]/.test(sql.charAt(end - 1))) end--;
  const quoted = sql.slice(0, end).trimStart();
  return quoted ? text.split(quoted).join('[…]') : text;
}

/**
 * Toute erreur qui sort du client est typée. `execFile` lève lui-même des erreurs de Node : octet nul dans un
 * argument, requête trop longue pour la ligne de commande (E2BIG), option invalide… Leur message reprend la
 * requête (« Received "start transaction read only; select …" ») et finirait tel quel dans une réponse 500 :
 * on n'en garde que le code, et l'erreur d'origine reste dans `cause`.
 */
function typed(err: unknown, binary: string, dir: string, sql: string): Error {
  if (err instanceof DoltQueryError || err instanceof DoltNotFoundError) return err;
  let reason = 'erreur inconnue';
  if (sql.includes('\0')) reason = 'la requête contient un octet nul, que dolt ne peut pas recevoir en argument';
  else if (err instanceof Error) reason = String((err as NodeJS.ErrnoException).code ?? err.name);
  return new DoltQueryError(`Impossible de lancer « ${binary} » : ${reason}.`, dir, false, err);
}

const formatBytes = (bytes: number) => (bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} Mo` : `${bytes} octets`);

/** Dolt écrit parfois plusieurs lignes d'erreur : on garde les premières, sans le bruit d'usage (ni plus de 500 caractères). */
function firstLines(text: string, count = 3): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(0, count).join(' ').slice(0, 500);
}

function defaultRootPath(): string {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  return join(tmpdir(), `beads-desktop-dolt-${uid}`);
}

/** Le `config_global.json` de dolt : l'envoi des métriques est désactivé. */
const DOLT_CONFIG = JSON.stringify({ 'metrics.disabled': 'true' });

/**
 * Prépare un dossier de configuration dolt à nous, métriques désactivées ; sans effet (`{}`) s'il n'est inscriptible nulle
 * part ou s'il n'est pas à nous : `createDoltClient` se rabat alors sur `fallbackRootPath`. Le dossier par défaut est à un
 * emplacement prévisible du dossier temporaire : quelqu'un d'autre a pu y mettre un lien symbolique, dont la cible serait
 * alors écrasée.
 */
function doltEnv(rootPath: string): NodeJS.ProcessEnv {
  try {
    prepareRoot(rootPath);
    return { DOLT_ROOT_PATH: rootPath };
  } catch {
    return {};
  }
}

/** Prépare `rootPath` pour dolt : un dossier réservé à son propriétaire dont le `config_global.json` désactive les métriques. Lève si c'est impossible. */
function prepareRoot(rootPath: string): void {
  ensurePrivateDir(rootPath);
  ensurePrivateDir(join(rootPath, '.dolt'));
  writeFileAtomically(join(rootPath, '.dolt', 'config_global.json'), DOLT_CONFIG);
}

/** Le dossier de repli de ce processus (voir `fallbackRootPath`). */
let fallbackRoot: string | undefined;

/**
 * Le dossier de configuration où dolt se rabat quand celui qu'on voulait est inutilisable : un dossier jetable à nous, créé
 * par `mkdtemp` (0700, nom aléatoire : ni partagé avec un autre processus, ni prévisible) et préparé comme les autres,
 * métriques désactivées. Un seul par processus, créé au premier besoin et réutilisé tant qu'il existe ; il reste dans le
 * dossier temporaire, que le système purge. Lève si même celui-là est impossible.
 */
function fallbackRootPath(): string {
  if (fallbackRoot !== undefined && existsSync(fallbackRoot)) return fallbackRoot;
  const root = mkdtempSync(join(tmpdir(), 'beads-desktop-dolt-repli-'));
  try {
    prepareRoot(root);
  } catch (err) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // impossible à retirer : l'erreur d'origine est la seule utile
    }
    throw err;
  }
  return (fallbackRoot = root);
}

/**
 * Met `content` dans `file` sans qu'un autre processus puisse jamais le voir vide ou partiel. Le dossier de configuration
 * est partagé par tous les serveurs et tous les workers de test, et chaque `dolt` y relit `config_global.json` à son
 * lancement : un fichier tronqué le temps d'une réécriture (`writeFileSync` l'ouvre avec troncature avant d'écrire) fait
 * échouer ce `dolt` (« unexpected end of JSON input »).
 * - Rien n'est écrit si le fichier est déjà à jour : c'est le cas courant, sans course possible ni droit d'écriture requis.
 * - Sinon le contenu est écrit dans un fichier voisin au nom unique (même dossier, donc même volume), puis mis en place
 *   par `rename`, atomique : un lecteur voit l'ancien fichier ou le nouveau. `rename` remplace aussi un lien symbolique
 *   posé à cet endroit, au lieu d'en écraser la cible.
 * Le fichier temporaire, que seul ce processus a créé (`wx`), est retiré si l'écriture ou le rename échoue.
 */
function writeFileAtomically(file: string, content: string): void {
  if (isUpToDate(file, content)) return;
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const fd = openSync(temp, 'wx'); // échoue, sans rien créer, si le nom est déjà pris
  try {
    try {
      writeFileSync(fd, content);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, file);
  } catch (err) {
    try {
      unlinkSync(temp);
    } catch {
      // déjà parti, ou impossible à retirer : l'erreur d'origine est la seule utile
    }
    throw err;
  }
}

/** `file` est un vrai fichier (un lien symbolique n'est pas suivi, comme pour les dossiers) qui contient exactement `content`. */
function isUpToDate(file: string, content: string): boolean {
  try {
    const info = lstatSync(file);
    return info.isFile() && info.size === Buffer.byteLength(content) && readFileSync(file, 'utf8') === content;
  } catch {
    return false;
  }
}

/** Crée le dossier réservé à son propriétaire (0700) ; refuse un lien symbolique ou le dossier d'un autre utilisateur. */
function ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const info = lstatSync(path); // lstat ne suit pas les liens symboliques
  if (!info.isDirectory()) throw new Error(`${path} n'est pas un vrai dossier`);
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new Error(`${path} appartient à un autre utilisateur`);
  if ((info.mode & 0o077) !== 0) chmodSync(path, 0o700); // laissé avec des droits trop larges par une version précédente
}

/** La file des lectures en attente est pleine. */
class QueueFull extends Error {}

/** Au plus `max` tâches à la fois ; `maxQueued` autres attendent leur tour, les suivantes échouent aussitôt (`QueueFull`). */
function createLimiter(max: number, maxQueued: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    if (active < max) active++;
    else if (waiting.length >= maxQueued) throw new QueueFull();
    else await new Promise<void>((resolve) => waiting.push(resolve)); // la place libérée nous est transmise
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Échappe une valeur pour un littéral de chaîne SQL (dialecte MySQL de Dolt). */
export function sqlString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

/** Entoure un identifiant de guillemets inversés. */
export function sqlIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``;
}

/**
 * Les DATETIME de Dolt sont sans fuseau ; beads et les commits Dolt les écrivent en UTC.
 * Une date illisible vient d'une base qui n'a pas le format attendu : c'est une erreur de lecture (503), pas un bogue (500).
 */
export function parseDoltDate(value: unknown): Date {
  const date = typeof value === 'string' ? new Date(`${value.replace(' ', 'T')}Z`) : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) throw new DoltQueryError(`Date Dolt invalide : ${String(value)}`);
  return date;
}
