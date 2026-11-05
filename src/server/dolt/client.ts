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
import { isAbortError, ReadAborted } from '../abort';
import { Flight } from '../flight';
import { DoltNotFoundError, DoltQueryError } from './errors';
import { assertReadOnly, READ_ONLY_PREFIX } from './read-only';

export { DoltNotFoundError, DoltQueryError };

/**
 * Ligne de résultat de `dolt sql -r json` : les colonnes NULL sont absentes de l'objet. Le type des autres valeurs dépend de la façon dont dolt a lu
 * la base (bdesk-38k.44) : quand un `dolt sql-server` tourne pour elle, le CLI s'y connecte de lui-même et toutes les valeurs non NULL arrivent en
 * chaînes (entiers `"0"`, booléens `"1"`, nombres à virgule, `time`, et une colonne JSON, rendue par son texte), là où la lecture directe des fichiers
 * les rend en nombres, et le JSON en objet. Les textes, les dates et les décimaux sont les mêmes chaînes des deux côtés. Une colonne entière se lit donc
 * par `parseDoltInteger`, jamais par `typeof … === 'number'` ni par `=== 1` ; qui lira une colonne JSON (aucune ne l'est : `dependencies.metadata` n'est
 * pas utilisée) devra accepter l'objet comme le texte.
 */
export type Row = Record<string, unknown>;

/**
 * Les voies des lectures (bdesk-38k.20). Chacune a ses places et sa file : une voie pleine ne retarde pas les autres, et ce dont
 * tout dépend ne fait pas la queue derrière ce qui dure.
 */
export type Lane = 'normal' | 'light' | 'analysis' | 'discovery';

/** Comment une lecture est ordonnancée. */
export interface QueryOptions {
  /**
   * La voie de la lecture (défaut : `normal`, au plus `maxConcurrent` processus : tickets, fiches).
   * - `light` (au plus `maxLight` processus) : une lecture de quelques dizaines de millisecondes dont tout le reste dépend, le
   *   hash du HEAD, qui invalide les caches ;
   * - `discovery` (au plus `maxDiscovery` processus) : le préfixe des tickets, que lit chaque scan des Projets, une lecture par Projet
   *   (quarante pour quarante Projets) : à part, pour que la lecture du HEAD d'une demande arrivée pendant un scan ne fasse pas la queue
   *   derrière toutes (bdesk-38k.28) ;
   * - `analysis` (au plus `maxAnalysis` processus) : une lecture lourde de l'historique, dont le résultat est partagé par toutes
   *   les requêtes du Projet (cache par HEAD) : elle ne fait pas la queue derrière les lectures d'un seul ticket, ni ne la leur fait faire.
   */
  lane?: Lane;
  /**
   * Abandon du demandeur (le client HTTP est parti) : `query` rejette aussitôt par une `ReadAborted`. La lecture quitte la file si
   * elle attend encore, et ne part jamais ; si son processus est déjà lancé, il va au bout, sans être tué, et son résultat est jeté
   * (il garde sa place jusqu'à sa fin). Les demandeurs d'une même lecture partagée ne l'abandonnent qu'ensemble (voir ci-dessous) :
   * un seul qui l'attend encore la laisse finir pour lui.
   *
   * Un signal peut être celui d'une lecture que plus personne n'attend et que seul le délai de grâce de son `Flight` garde (bdesk-38k.37) :
   * tant qu'elle fait la queue, elle passe après toutes les lectures qu'on attend, quel que soit l'ordre d'arrivée ; elle part dès qu'une
   * place reste libre, et reprend son rang si quelqu'un la redemande avant la fin du délai.
   */
  signal?: AbortSignal;
}

/**
 * Une base Dolt (dossier contenant `.dolt/`), interrogée en lecture seule.
 *
 * Deux lectures identiques (même base, mêmes requêtes, même voie) qui attendent encore une place ne font qu'un processus et
 * partagent ses lignes (qu'il ne faut donc pas modifier) : aucune des deux n'a lu quoi que ce soit, le résultat est celui de
 * l'instant où le processus part, donc postérieur à leur arrivée. Une lecture déjà partie n'est jamais jointe : qui arrive
 * après elle lit à son tour, car elle a pu précéder un commit.
 */
export interface DoltDatabase {
  readonly dir: string;
  /**
   * Exécute une seule requête de lecture (SELECT, SHOW, DESCRIBE, EXPLAIN, WITH … SELECT) et renvoie ses lignes.
   * Un échec est une `DoltQueryError` (ou une `DoltNotFoundError`), jamais une erreur brute de Node : son message
   * citerait la requête, qui n'a pas sa place dans une réponse HTTP. Le refus du garde-fou (`ReadOnlyViolation`)
   * est une `DoltQueryError`, lui aussi sans la requête. Un abandon (`options.signal`) est une `ReadAborted`.
   */
  query(sql: string, options?: QueryOptions): Promise<Row[]>;
  /**
   * Plusieurs lectures dans UN processus `dolt` (et une seule transaction en lecture seule, donc un seul état de la base),
   * pour qui en enchaîne plusieurs : un processus coûte une centaine de millisecondes, bien plus que chaque requête.
   * Renvoie les lignes de chaque requête, dans l'ordre. Chacune passe le garde-fou lexical à son tour, avant
   * que dolt ne soit lancé : une seule qui n'est pas une lecture simple fait refuser le groupe. Optionnel pour les bases
   * factices ; utiliser `queryAll(db, …)`, qui se replie sur une lecture par requête.
   */
  queryAll?(sqls: readonly string[], options?: QueryOptions): Promise<Row[][]>;
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
  /** Nombre maximal de processus `dolt` simultanés pour les lectures légères (voie `light`), en plus de `maxConcurrent` (défaut : 4). */
  maxLight?: number;
  /** Nombre maximal de processus `dolt` simultanés pour la lecture du préfixe des Projets par la découverte (voie `discovery`), en plus des autres voies (défaut : 4, comme la voie `light` qui la portait : un scan n'en est pas ralenti). */
  maxDiscovery?: number;
  /** Nombre maximal de processus `dolt` simultanés pour les lectures d'historique (voie `analysis`), en plus de `maxConcurrent` (défaut : 6, comme avant : le calcul à froid des métriques de plusieurs Projets n'en est pas ralenti). */
  maxAnalysis?: number;
  /** Nombre maximal de lectures en attente d'un processus libre, dans chaque voie (défaut : 1000) ; au-delà, elles échouent aussitôt. */
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
    maxLight = 4,
    maxDiscovery = 4,
    maxAnalysis = 6,
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
  // Quatre voies, chacune avec sa file : le HEAD ne fait pas la queue derrière des lectures lourdes ni derrière les préfixes d'un scan, ni l'historique derrière les fiches.
  const limits: Record<Lane, ReturnType<typeof createLimiter>> = {
    normal: createLimiter(maxConcurrent, maxQueued),
    light: createLimiter(maxLight, maxQueued),
    discovery: createLimiter(maxDiscovery, maxQueued),
    analysis: createLimiter(maxAnalysis, maxQueued),
  };
  /** Les lectures qui attendent encore une place, par voie, base et requêtes : les identiques les rejoignent (voir `DoltDatabase`). */
  const queued = new Map<string, Flight<Row[][]>>();

  /**
   * Un processus pour toutes les requêtes, avec de nouvelles tentatives tant que la base est verrouillée par un autre processus.
   * `idle` : personne n'attend vraiment cette lecture (voir `Flight.idle`) ; tant qu'elle fait la queue, les lectures qu'on attend passent devant.
   */
  async function read(
    dir: string,
    sqls: readonly string[],
    lane: Lane,
    signal: AbortSignal,
    leftQueue: () => void,
    idle: () => boolean,
  ): Promise<Row[][]> {
    const limit = limits[lane];
    for (let attempt = 0; ; attempt++) {
      try {
        return await limit(
          () => {
            leftQueue();
            return run(binary, dir, sqls, env, timeoutMs, maxOutputBytes, signal);
          },
          signal,
          idle,
        );
      } catch (err) {
        if (err instanceof QueueFull) throw new DoltQueryError(`Trop de lectures Dolt en attente (plus de ${maxQueued}) : réessayez dans un instant.`, dir);
        if (!(err instanceof DoltQueryError) || !err.locked || attempt >= retries) throw typed(err, binary, dir, sqls);
        await sleep(retryDelayMs * 2 ** attempt, signal);
      }
    }
  }

  async function execute(dir: string, sqls: readonly string[], { lane = 'normal', signal }: QueryOptions = {}): Promise<Row[][]> {
    for (const sql of sqls) assertReadOnly(sql);
    if (refusal) throw refusal;
    if (sqls.length === 0) return [];
    if (signal?.aborted) throw new ReadAborted();
    const key = [lane, dir, ...sqls].join('\0');
    let flight = queued.get(key);
    if (!flight || flight.abandoned) {
      const created: Flight<Row[][]> = new Flight((flightSignal) =>
        read(
          dir,
          sqls,
          lane,
          flightSignal,
          () => {
            if (queued.get(key) === created) queued.delete(key); // elle a sa place : qui arrive maintenant lira à son tour
          },
          () => created.idle,
        ),
      );
      queued.set(key, created);
      flight = created;
      created.start();
      void created.settled.then(() => {
        if (queued.get(key) === created) queued.delete(key); // retirée de la file sans avoir jamais lu
      });
    }
    return flight.join(signal);
  }

  return {
    open: (dir) => ({
      dir,
      query: async (sql, queryOptions) => (await execute(dir, [sql], queryOptions))[0] ?? [],
      queryAll: (sqls, queryOptions) => execute(dir, sqls, queryOptions),
    }),
  };
}

/** Plusieurs lectures d'une même base : dans un seul processus si la base sait grouper (`queryAll`), une par une sinon. */
export function queryAll(db: DoltDatabase, sqls: readonly string[], options?: QueryOptions): Promise<Row[][]> {
  return db.queryAll ? db.queryAll(sqls, options) : Promise.all(sqls.map((sql) => db.query(sql, options)));
}

/** La même base, dont les lectures reçoivent d'office `defaults` (le signal d'une requête HTTP, par exemple) ; chaque lecture peut les préciser. */
export function withOptions(db: DoltDatabase, defaults: QueryOptions): DoltDatabase {
  const { queryAll: grouped } = db;
  return {
    dir: db.dir,
    query: (sql, options) => db.query(sql, { ...defaults, ...options }),
    ...(grouped ? { queryAll: (sqls: readonly string[], options?: QueryOptions) => grouped.call(db, sqls, { ...defaults, ...options }) } : {}),
  };
}

/** Entre deux instructions d'un groupe : le saut de ligne referme un commentaire de fin de ligne, qui avalerait sinon le « ; » et la suite. */
const STATEMENT_SEPARATOR = '\n;\n';

/**
 * Lance `dolt sql` pour toutes les requêtes à la fois. Un abandon (`signal`) ne tue JAMAIS le processus : le demandeur est libéré
 * aussitôt (`ReadAborted`, par `Flight.join` ou `abortable`), mais le processus va au bout, garde sa place jusqu'à sa fin, et son
 * résultat est jeté.
 *
 * C'est que tuer un `dolt sql` laisse des traces dans la base de l'utilisateur. À l'ouverture de la base, il réécrit
 * `.dolt/noms/journal.idx` et `manifest` ; `manifest` l'est par un fichier temporaire `nbs_manifest_…` qui existe 5 ms vers 40-60 ms
 * après le lancement, puis à la fermeture. Un lecteur tué à ces instants (le cas d'un parcours rapide : une fiche dure environ 110 ms)
 * laisse un fichier de 0 ou 148 octets que dolt ne lit ni ne nettoie jamais, pas même `dolt gc --full` : de 5 à 50 par parcours de
 * 92 tickets sur deux Projets aux pas de 60 à 250 ms, qui s'accumulent sans fin dans la base (inertes pour `dolt`, mais jamais
 * retirés). Un lecteur tué laisse aussi `journal.idx` tronqué, que dolt reconstruit à l'ouverture suivante. Laisser finir coûte plus de
 * temps de processus (de 60 à 90 % sur un parcours rapide aux pas de 30 à 120 ms) sans perte de latence (ADR 0003 ; mesures dans
 * `proofs/bdesk-38k.20.md`, §18).
 *
 * Les seuls arrêts qui restent sont ceux de `execFile` : le délai (`timeoutMs`, 60 s) et le dépassement de `maxBuffer`. Ils tuent
 * (SIGTERM) un processus qui tourne depuis très longtemps ou qui écrit trop, donc en pleine lecture : ils peuvent laisser un
 * `journal.idx` tronqué, comme un plantage, et un fichier temporaire seulement s'ils tombent dans les 5 ms de la fermeture.
 */
function run(
  binary: string,
  dir: string,
  sqls: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  maxOutputBytes: number,
  signal: AbortSignal,
): Promise<Row[][]> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new ReadAborted());
    execFile(
      binary,
      ['sql', '-r', 'json', '-q', READ_ONLY_PREFIX + sqls.join(STATEMENT_SEPARATOR)],
      { cwd: dir, env, timeout: timeoutMs, maxBuffer: maxOutputBytes, windowsHide: true },
      (error, stdout, stderr) => {
        if (signal.aborted) return reject(new ReadAborted()); // abandonnée en route : son résultat est jeté, ni délai ni échec à rapporter
        if (error) return reject(toError(error, binary, dir, sqls.reduce(withoutQuery, stderr), timeoutMs, maxOutputBytes));
        try {
          resolve(parseResults(stdout, sqls.length));
        } catch (err) {
          reject(new DoltQueryError(`Sortie de dolt illisible : ${(err as Error).message}`, dir));
        }
      },
    );
  });
}

/**
 * Les lignes de chaque requête. Avec la transaction en lecture seule, dolt écrit d'abord un document `{}` vide, puis un
 * document par instruction (`{}` quand elle ne rend aucune ligne). Une requête seule se contente de les mettre bout à bout ;
 * un groupe exige exactement un document par instruction : un compte différent (une instruction avalée par un commentaire,
 * une sortie d'un autre format) décalerait les lignes d'une requête à l'autre, ce qui vaut mieux une erreur que des réponses fausses.
 */
function parseResults(stdout: string, statements: number): Row[][] {
  const documents = jsonDocuments(stdout).map(rowsOf);
  if (statements === 1) return [documents.flat()];
  if (documents.length !== statements + 1) throw new Error(`${Math.max(documents.length - 1, 0)} résultat(s) pour ${statements} requêtes`);
  return documents.slice(1);
}

function rowsOf(document: string): Row[] {
  const rows = (JSON.parse(document) as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as Row[]) : [];
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
 * on n'en garde que le code, et l'erreur d'origine reste dans `cause`. Un abandon n'est pas une erreur de lecture : il passe tel quel.
 */
function typed(err: unknown, binary: string, dir: string, sqls: readonly string[]): Error {
  if (err instanceof DoltQueryError || err instanceof DoltNotFoundError || (err instanceof Error && isAbortError(err))) return err;
  let reason = 'erreur inconnue';
  if (sqls.some((sql) => sql.includes('\0'))) reason = 'la requête contient un octet nul, que dolt ne peut pas recevoir en argument';
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

/**
 * Au plus `max` tâches à la fois ; `maxQueued` autres attendent leur tour, les suivantes échouent aussitôt (`QueueFull`).
 * Une attente dont le signal est abandonné quitte la file aussitôt (`ReadAborted`) et ne prendra jamais de place.
 *
 * Une place libérée va à la première attente qu'on attend vraiment, dans l'ordre d'arrivée, et seulement à défaut à la première attente
 * `idle` : une lecture que plus personne n'attend et que seul un délai de grâce garde (voir `Flight.idle`) ne retarde ainsi jamais une
 * lecture demandée entre-temps, mais part dès qu'une place reste libre. `idle` est jugé à ce moment-là, pas à l'arrivée : une lecture
 * reprise pendant le délai retrouve son rang. Sans `idle`, l'attente est toujours attendue.
 */
function createLimiter(max: number, maxQueued: number): <T>(task: () => Promise<T>, signal?: AbortSignal, idle?: () => boolean) => Promise<T> {
  let active = 0;
  const waiting: { grant: () => void; idle: () => boolean }[] = [];
  return async (task, signal, idle = () => false) => {
    if (signal?.aborted) throw new ReadAborted();
    if (active < max) {
      active++;
    } else if (waiting.length >= maxQueued) {
      throw new QueueFull();
    } else {
      await new Promise<void>((resolve, reject) => {
        const turn = {
          grant: () => {
            signal?.removeEventListener('abort', leave);
            resolve(); // la place libérée nous est transmise
          },
          idle,
        };
        const leave = () => {
          const index = waiting.indexOf(turn);
          if (index >= 0) waiting.splice(index, 1);
          reject(new ReadAborted());
        };
        signal?.addEventListener('abort', leave, { once: true });
        waiting.push(turn);
      });
    }
    try {
      return await task();
    } finally {
      const awaited = waiting.findIndex((turn) => !turn.idle());
      const [next] = waiting.splice(Math.max(awaited, 0), 1);
      if (next) next.grant();
      else active--;
    }
  };
}

/** Attend `ms` ; rejette par une `ReadAborted`, sans attendre la fin du délai, si `signal` est abandonné. */
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new ReadAborted());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ReadAborted());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

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

/**
 * Un entier de Dolt (`priority`, `restart`…) : un nombre quand dolt lit les fichiers lui-même, une chaîne de chiffres (`"priority":"0"`) quand un
 * `dolt sql-server` tourne pour la base (voir `Row`). Les deux se lisent de même ; NULL, absent de la sortie JSON, rend `undefined` : le défaut de
 * la colonne est à l'appelant.
 *
 * Toute autre valeur (texte, décimal, booléen, entier que le nombre ne représente pas exactement, écriture qui n'est pas celle de Dolt comme « 02 »,
 * « 2.0 » ou « 1e3 ») vient d'une base qui n'a pas le format attendu : c'est une erreur de lecture (503 avec la raison, comme une date illisible),
 * jamais une valeur par défaut qui la masquerait. `column` dit de quelle colonne il s'agit.
 */
export function parseDoltInteger(value: unknown, column: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const number = typeof value === 'string' ? Number(value) : value;
  // Une chaîne n'est lue que si elle est l'écriture décimale de l'entier qu'elle donne : « 2 » oui, « 02 », « +2 », « 2.0 », « 1e3 », « -0 » non.
  if (typeof number === 'number' && Number.isSafeInteger(number) && (typeof value !== 'string' || String(number) === value)) return number;
  throw new DoltQueryError(`Entier Dolt invalide (${column}) : ${shown(value)}`);
}

/** Une valeur dans un message d'erreur : un texte entre guillemets, le reste en JSON, au plus quarante caractères. */
function shown(value: unknown): string {
  const text = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const clipped = text.length > 40 ? `${text.slice(0, 40)}…` : text;
  return typeof value === 'string' ? `« ${clipped} »` : clipped;
}
