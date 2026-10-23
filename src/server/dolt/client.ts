import { type ExecFileException, execFile } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertReadOnly, READ_ONLY_PREFIX } from './read-only';

/** Ligne de résultat de `dolt sql -r json` : les colonnes NULL sont absentes de l'objet. */
export type Row = Record<string, unknown>;

/** Une base Dolt (dossier contenant `.dolt/`), interrogée en lecture seule. */
export interface DoltDatabase {
  readonly dir: string;
  /** Exécute une seule requête de lecture (SELECT, SHOW, DESCRIBE, EXPLAIN, WITH … SELECT) et renvoie ses lignes. */
  query(sql: string): Promise<Row[]>;
}

/** Le binaire `dolt` n'est pas installé (ou pas dans le PATH). */
export class DoltNotFoundError extends Error {
  constructor(binary: string) {
    super(`Le binaire « ${binary} » est introuvable : installez Dolt et vérifiez qu'il est dans le PATH.`);
    this.name = 'DoltNotFoundError';
  }
}

/** Échec d'une requête : base illisible, schéma inattendu, verrou persistant, délai dépassé… */
export class DoltQueryError extends Error {
  constructor(
    message: string,
    /** Dossier de la base, quand l'erreur en vient. */
    readonly dir = '',
    readonly locked = false,
  ) {
    super(message);
    this.name = 'DoltQueryError';
  }
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
   * défini dans l'environnement est respecté.
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
  const limit = createLimiter(maxConcurrent, maxQueued);

  async function query(dir: string, sql: string): Promise<Row[]> {
    assertReadOnly(sql);
    for (let attempt = 0; ; attempt++) {
      try {
        return await limit(() => run(binary, dir, sql, env, timeoutMs, maxOutputBytes));
      } catch (err) {
        if (err instanceof QueueFull) throw new DoltQueryError(`Trop de lectures Dolt en attente (plus de ${maxQueued}) : réessayez dans un instant.`, dir);
        if (!(err instanceof DoltQueryError) || !err.locked || attempt >= retries) throw err;
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
        if (error) return reject(toError(error, binary, dir, stdout, stderr, timeoutMs, maxOutputBytes));
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
  stdout: string,
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
  const detail = firstLines(stderr || stdout || error.message);
  return new DoltQueryError(detail, dir, LOCK_ERROR.test(detail));
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

/**
 * Prépare un dossier de configuration dolt à nous, métriques désactivées ; sans effet s'il n'est inscriptible nulle
 * part ou s'il n'est pas à nous. Le dossier par défaut est à un emplacement prévisible du dossier temporaire :
 * quelqu'un d'autre a pu y mettre un lien symbolique, dont la cible serait alors écrasée.
 */
function doltEnv(rootPath: string): NodeJS.ProcessEnv {
  try {
    ensurePrivateDir(rootPath);
    ensurePrivateDir(join(rootPath, '.dolt'));
    writeFileSync(join(rootPath, '.dolt', 'config_global.json'), JSON.stringify({ 'metrics.disabled': 'true' }));
    return { DOLT_ROOT_PATH: rootPath };
  } catch {
    return {};
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
