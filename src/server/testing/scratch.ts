import { chmodSync, lstatSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll } from 'vitest';

/**
 * Les dossiers temporaires des tests (bdesk-38k.60). Un test qui crée un dossier sous le dossier temporaire du système le laisse après lui : la
 * suite en laissait plus de 300 par exécution (`bdesk-*`, dont les `bdesk-fake-dolt-*` des faux binaires, un par test). Tout dossier de test
 * passe donc par `scratchDir`, et le fichier de tests le retire à sa fin. ESLint interdit d'importer `mkdtemp` ailleurs que dans ce fichier (eslint.config.js).
 *
 * Le registre et les crochets de fin de fichier sont posés par `setup.ts`, le fichier d'initialisation du projet « node » (`setupFiles` de vite.config.ts), qui
 * tourne avant chacun des fichiers de tests, même sous `--no-isolate` (bdesk-38k.66) : un fichier qui importe `scratchDir`, directement ou par `fakeDolt`,
 * `fakeDoltRoot` et `isolatedDoltEnv`, est nettoyé sans rien déclarer, et après ses propres crochets de fin (ils partent en pile : le dernier posé part le premier),
 * donc un serveur arrêté dans un `afterAll` du fichier l'est avant que son dossier ne soit retiré. Les poser à l'évaluation de ce module, comme avant, les faisait
 * dépendre du moment où il est chargé (dans un crochet, c'est trop tard : vitest les ignore) et d'un worker par fichier de tests, ce que `--no-isolate` ne donne pas.
 *
 * À appeler dans un `beforeAll`, un `beforeEach` ou un test, jamais à la collecte (niveau du module, corps d'un `describe`) : un fichier dont aucun test ne
 * tourne (tous sautés, faute de `dolt` ou de `bd`, `-t` qui ne retient rien, `vitest list`) n'exécute aucun crochet, et ce qu'il aurait créé resterait. Appelé
 * à la collecte, `scratchDir` échoue donc au lieu de laisser le dossier. Un processus qui recrée le dossier une fois retiré le ferait aussi revenir : celui de
 * `dolt`, après chacune de ses commandes (voir `isolatedDoltEnv`).
 *
 * L'état du fichier (son registre, et si ses tests ont commencé) est sur `globalThis`, non dans le module : un module rechargé par `vi.resetModules()` est une
 * seconde instance, qui doit retrouver le registre de son fichier, et sous `--no-isolate` le module lui-même est partagé par les fichiers d'un worker.
 */

/**
 * Tout dossier de test porte ce préfixe : c'est ce que l'on compte pour vérifier qu'aucun ne reste, et rien d'autre n'est jamais retiré. Le reste du
 * nom n'a pas de séparateur de chemin : le dossier est toujours créé directement sous le dossier temporaire.
 */
const NAME_PREFIX = /^bdesk-[\w.-]*$/;

/** Retire `dir` et ce qu'il contient. `rmSync` ne suit pas les liens symboliques : un lien est retiré, jamais ce qu'il montre. */
function remove(dir: string): void {
  const options = { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } as const;
  try {
    rmSync(dir, options);
  } catch {
    // Un test a laissé un dossier en lecture seule : ce qu'il contient ne peut plus en être retiré. On le rouvre (sans suivre de lien : `lstat`), puis on retente.
    reopen(dir);
    rmSync(dir, options);
  }
}

/** Rend `path` et les dossiers qu'il contient inscriptibles par leur propriétaire. Un lien symbolique n'est pas un dossier pour `lstat` : il n'est pas suivi. */
function reopen(path: string): void {
  if (!lstatSync(path, { throwIfNoEntry: false })?.isDirectory()) return;
  chmodSync(path, 0o700);
  for (const name of readdirSync(path)) reopen(join(path, name));
}

/** Un registre de dossiers temporaires : `dir` en crée, `removeAll` retire tous ceux qu'il a créés. */
export function createScratchDirs(): { dir(prefix: string): string; removeAll(): void } {
  const made = new Set<string>();
  return {
    /** Un dossier neuf (`mkdtemp`, 0700) sous le dossier temporaire du système : `prefix` (qui commence par `bdesk-`) suivi de six caractères au hasard. */
    dir(prefix) {
      if (!NAME_PREFIX.test(prefix)) {
        throw new Error(`Le préfixe d'un dossier temporaire de test commence par « bdesk- » et n'a pas de séparateur de chemin (reçu : « ${prefix} »).`);
      }
      const dir = mkdtempSync(join(tmpdir(), prefix));
      made.add(dir);
      return dir;
    },
    /** Retire tous les dossiers créés, un échec n'empêchant pas les autres. Ceux qui n'ont pas pu l'être sont dits (`AggregateError`) et retentés à l'appel suivant. */
    removeAll() {
      const failures: unknown[] = [];
      for (const dir of made) {
        try {
          remove(dir);
          made.delete(dir);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, `Dossiers temporaires de test non retirés : ${failures.length}.`);
      }
    },
  };
}

/** L'état des dossiers du fichier de tests en cours : son registre, et si ses tests ont commencé. */
interface FileScratch {
  readonly dirs: ReturnType<typeof createScratchDirs>;
  /** Vrai dès que les tests du fichier tournent : avant, c'est la collecte (le module, le corps d'un `describe`), où aucun crochet n'a encore tourné. */
  running: boolean;
}

/** Où l'état du fichier est gardé : sur `globalThis`, sous une clé de `Symbol.for`, que toutes les instances du module retrouvent. Le fichier suivant d'un worker le remplace. */
const STATE = Symbol.for('beads-desktop.scratch');

const holder = () => globalThis as unknown as Record<symbol, FileScratch | undefined>;

/**
 * Pose le registre et les crochets du fichier de tests qui commence. Appelé par `setup.ts`, avant chaque fichier : les crochets sont les premiers de ce fichier, donc
 * `beforeAll` passe avant les siens et `afterAll` après les siens. Le registre est celui de ce fichier seulement : sous `--no-isolate`, le suivant a le sien.
 */
export function installScratchHooks(): void {
  const file: FileScratch = { dirs: createScratchDirs(), running: false };
  holder()[STATE] = file;
  beforeAll(() => {
    file.running = true;
  });
  // Le délai du crochet est large : retirer des centaines de dossiers sur une machine très chargée peut dépasser les 10 s par défaut de vitest.
  afterAll(file.dirs.removeAll, 60_000);
}

/** L'état du fichier en cours ; dit clairement s'il n'a pas été posé (un vitest lancé sans `setup.ts`), au lieu de faire croire à autre chose. */
function fileScratch(): FileScratch {
  const file = holder()[STATE];
  if (!file) {
    throw new Error(
      "scratchDir est appelé sans le registre du fichier de tests : src/server/testing/setup.ts, qui le pose avant chaque fichier, n'a pas tourné " +
        '(setupFiles du projet « node » de vite.config.ts).',
    );
  }
  return file;
}

/** Un dossier temporaire neuf (voir `createScratchDirs().dir`), retiré à la fin du fichier de tests. Pas à la collecte : voir plus haut. */
export function scratchDir(prefix: string): string {
  const file = fileScratch();
  if (!file.running) {
    throw new Error(
      `scratchDir('${prefix}') est appelé à la collecte (niveau du module, corps d'un describe) : un fichier dont aucun test ne tourne (-t, vitest list, tout sauté) ` +
        "n'exécute aucun crochet, et le dossier resterait. Créez-le dans un beforeAll, un beforeEach ou un test.",
    );
  }
  return file.dirs.dir(prefix);
}

/** Ce que le crochet de fin de fichier exécute : retire tous les dossiers de `scratchDir`. */
export const removeScratchDirs = (): void => fileScratch().dirs.removeAll();
