import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createScratchDirs, removeScratchDirs, scratchDir } from './scratch';

/**
 * Les dossiers temporaires des tests (bdesk-38k.60) : la suite en laissait plus de 300 par exécution dans le dossier temporaire du système, un
 * par test qui en crée un. `scratchDir` les crée et le fichier de tests les retire à sa fin ; `createScratchDirs` est le même mécanisme sans ce
 * crochet, pour essayer ici le retrait sans attendre la fin du fichier.
 */
describe('dossiers temporaires de test : créés par scratchDir, retirés sans rien laisser', () => {
  const scratch = createScratchDirs();
  /** root passe outre les droits des dossiers : les cas qui en dépendent n'ont rien à prouver pour lui. */
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

  afterEach(() => {
    vi.unstubAllEnvs();
    scratch.removeAll();
  });

  it('crée un dossier neuf sous le dossier temporaire, au préfixe demandé, réservé à son propriétaire', () => {
    const first = scratch.dir('bdesk-essai-');
    const second = scratch.dir('bdesk-essai-');

    expect(dirname(first)).toBe(tmpdir());
    expect(basename(first)).toMatch(/^bdesk-essai-.+/);
    expect(statSync(first).isDirectory()).toBe(true);
    expect(statSync(first).mode & 0o777).toBe(0o700);
    expect(second).not.toBe(first);
  });

  it.each(['essai-', 'bdesk', 'x/bdesk-', 'bdesk-a/b-', 'bdesk-../evasion-'])(
    'refuse le préfixe « %s » sans rien créer : celui d’un dossier de test commence par « bdesk- » (ce que l’on compte pour vérifier qu’aucun ne reste) et n’a pas de séparateur de chemin',
    (prefix) => {
      expect(() => scratch.dir(prefix)).toThrow(/commence par « bdesk- »/);

      expect(readdirSync(tmpdir()).filter((name) => name.startsWith('essai-') || name.startsWith('evasion-'))).toEqual([]);
    },
  );

  it('retire tout ce qu’il a créé, contenu compris, puis n’a plus rien à retirer', () => {
    const first = scratch.dir('bdesk-essai-');
    const second = scratch.dir('bdesk-essai-');
    mkdirSync(join(first, 'a', 'b'), { recursive: true });
    writeFileSync(join(first, 'a', 'b', 'fichier'), 'x');
    writeFileSync(join(second, 'fichier'), 'x');

    scratch.removeAll();

    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(false);
    expect(() => scratch.removeAll()).not.toThrow();
  });

  it('ne retire que ce qu’il a créé : le dossier d’un autre registre reste', () => {
    const mine = scratch.dir('bdesk-essai-');
    const neighbour = scratchDir('bdesk-voisin-'); // celui du fichier de tests : retiré à la fin de ce fichier, pas par `scratch`
    writeFileSync(join(neighbour, 'fichier'), 'x');

    scratch.removeAll();

    expect(existsSync(mine)).toBe(false);
    expect(existsSync(join(neighbour, 'fichier'))).toBe(true);
  });

  // `rmSync` ne suit pas les liens symboliques, et le retrait n'en suit aucun : dans le dépôt, `node_modules` est un lien vers l'installation du dépôt
  // vivant, et un nettoyage qui le suivrait en effacerait les paquets.
  it('ne suit pas un lien symbolique posé dans son dossier : ce qu’il montre reste intact', () => {
    const target = scratchDir('bdesk-cible-'); // retiré à la fin de ce fichier
    writeFileSync(join(target, 'precieux'), 'x');
    const dir = scratch.dir('bdesk-essai-');
    symlinkSync(target, join(dir, 'lien'));

    scratch.removeAll();

    expect(existsSync(dir)).toBe(false);
    expect(existsSync(join(target, 'precieux'))).toBe(true);
  });

  it('retire le lien, pas ce qu’il montre, quand son dossier a été remplacé par un lien symbolique', () => {
    const target = scratchDir('bdesk-cible-');
    writeFileSync(join(target, 'precieux'), 'x');
    const dir = scratch.dir('bdesk-essai-');
    rmSync(dir, { recursive: true });
    symlinkSync(target, dir); // le nom que le registre a donné est maintenant un lien vers la cible

    scratch.removeAll();

    expect(lstatSync(dir, { throwIfNoEntry: false })).toBeUndefined();
    expect(existsSync(join(target, 'precieux'))).toBe(true);
  });

  it.skipIf(isRoot)('retire un dossier qu’un test a laissé en lecture seule, avec ce qu’il contient, sans suivre un lien pour en changer la cible', () => {
    const target = scratchDir('bdesk-cible-');
    chmodSync(target, 0o755);
    const dir = scratch.dir('bdesk-essai-');
    const locked = join(dir, 'verrouille');
    mkdirSync(join(locked, 'dedans'), { recursive: true });
    writeFileSync(join(locked, 'dedans', 'fichier'), 'x');
    symlinkSync(target, join(locked, 'lien'));
    chmodSync(join(locked, 'dedans', 'fichier'), 0o400);
    chmodSync(join(locked, 'dedans'), 0o500);
    chmodSync(locked, 0o500);

    try {
      scratch.removeAll();

      expect(existsSync(dir)).toBe(false);
      expect(statSync(target).mode & 0o777).toBe(0o755); // rouvrir un dossier ne rouvre pas ce que ses liens montrent
    } finally {
      if (existsSync(locked)) {
        chmodSync(locked, 0o700);
        chmodSync(join(locked, 'dedans'), 0o700);
      }
    }
  });

  it.skipIf(isRoot)('dit ceux qu’il ne peut pas retirer sans renoncer aux autres, et les retire à l’appel suivant quand c’est possible', () => {
    // Un dossier ne quitte pas un dossier parent sans droit d'écriture : `stuck` est créé dans `parent`, que l'on met en lecture seule.
    const parent = scratchDir('bdesk-parent-'); // retiré à la fin de ce fichier
    vi.stubEnv('TMPDIR', parent);
    const stuck = scratch.dir('bdesk-coince-');
    vi.unstubAllEnvs();
    const free = scratch.dir('bdesk-libre-');
    chmodSync(parent, 0o500);

    try {
      expect(() => scratch.removeAll()).toThrow(/non retirés : 1/);
      expect(existsSync(free)).toBe(false); // les autres sont retirés quand même
      expect(existsSync(stuck)).toBe(true);
    } finally {
      chmodSync(parent, 0o700);
    }

    expect(() => scratch.removeAll()).not.toThrow(); // retenté : le dossier qui restait est retiré, et il n'en reste aucun à signaler
    expect(existsSync(stuck)).toBe(false);
  });
});

/**
 * `scratchDir` appelé à la collecte, ici dans le corps du fichier (bdesk-38k.60, relecture) : aucun crochet n'a encore tourné, et un fichier dont aucun test ne
 * tourne (`-t` qui ne retient rien, `vitest list`, tout sauté faute de `dolt`) n'en exécute jamais : le dossier resterait. Il est refusé, pour que l'oubli se voie
 * partout au lieu de ne fuir que dans ces cas-là (`client.test.ts` créait un faux dolt dans le corps d'un `describe`).
 */
const calledAtCollection = (() => {
  try {
    scratchDir('bdesk-collecte-');
  } catch (error) {
    return error;
  }
  return undefined;
})();

describe('scratchDir à la collecte et dans un crochet', () => {
  let fromHook: string | undefined;
  beforeAll(() => {
    fromHook = scratchDir('bdesk-crochet-');
  });

  it('est refusé à la collecte : aucun crochet ne retirerait le dossier d’un fichier dont aucun test ne tourne', () => {
    expect(calledAtCollection).toBeInstanceOf(Error);
    expect((calledAtCollection as Error).message).toMatch(/à la collecte/);
  });

  it('est permis dans un `beforeAll` : le dossier existe, et sera retiré à la fin du fichier', () => {
    expect(existsSync(String(fromHook))).toBe(true);
  });
});

/**
 * Un module rechargé par `vi.resetModules()` (`dolt-fixture.test.ts` le fait pour `hasBinary`) est une seconde instance de `scratch.ts`, évaluée en plein test :
 * le crochet `afterAll` qu'elle poserait alors est ignoré par vitest, sans un mot, et les dossiers qu'elle crée ne seraient jamais retirés (bdesk-38k.60, relecture).
 * Le registre du fichier est donc celui du worker, partagé par toutes les instances ; un module évalué pour la première fois en plein test échoue au lieu de
 * poser un crochet qui ne servirait à rien.
 */
describe('module scratch rechargé en plein test', () => {
  const STATE = Symbol.for('beads-desktop.scratch');
  const holder = globalThis as unknown as Record<symbol, unknown>;

  it('une seconde instance partage le registre du fichier : ses dossiers sont retirés par le crochet de fin de fichier', async () => {
    vi.resetModules();
    const reloaded = await import('./scratch');
    expect(reloaded.scratchDir).not.toBe(scratchDir); // bien une autre instance du module
    const dir = reloaded.scratchDir('bdesk-recharge-');

    removeScratchDirs(); // ce que le crochet de fin de fichier exécute, celui de la première instance

    expect(existsSync(dir)).toBe(false);
  });

  it('un module évalué pour la première fois en plein test échoue, au lieu de poser un crochet que vitest ignorerait', async () => {
    const saved = holder[STATE];
    delete holder[STATE]; // comme si ce worker n'avait encore jamais chargé le module
    try {
      vi.resetModules();
      await expect(import('./scratch')).rejects.toThrow(/en cours de test/);
    } finally {
      holder[STATE] = saved;
    }
  });
});
