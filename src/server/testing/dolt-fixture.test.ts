import { chmodSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dolt, hasBinary, isolatedDoltEnv } from './dolt-fixture';
import { fakeDolt } from './fake-dolt';
import { scratchDir } from './scratch';

/**
 * Les tests d'intégration sur une vraie base Dolt (`describe.skipIf(!hasBinary('dolt'))`) sont sautés, jamais en échec, quand le
 * binaire manque (bdesk-38k.33, remarque r4 de la relecture finale de bdesk-38k.20). Un saut silencieux passerait pour un succès :
 * `hasBinary` le dit à voix haute.
 */
describe.skipIf(process.platform === 'win32')('hasBinary : un binaire absent, ou qui ne répond pas à « version », fait sauter des tests, et le dit', () => {
  const startDirectory = process.cwd();

  afterEach(() => {
    process.chdir(startDirectory); // sort du dossier où un test s'est placé, que `scratchDir` retire à la fin du fichier
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** Un faux binaire `dolt` (voir `fakeDolt`) : comme les scripts ci-dessous, son dossier est retiré à la fin du fichier (`scratchDir`, bdesk-38k.45 puis bdesk-38k.60). */
  const fake = fakeDolt;

  /** Un module neuf : la mémoire des binaires déjà signalés est celle d'un fichier de tests qui commence. */
  async function fresh() {
    vi.resetModules();
    return (await import('./dolt-fixture')).hasBinary;
  }
  const warnings = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  /** Un script exécutable dont l'interpréteur n'existe pas : le noyau répond ENOENT pour le script, qui est pourtant là. */
  function scriptWithoutInterpreter(name: string) {
    const dir = scratchDir('bdesk-sans-interpreteur-');
    const script = join(dir, name);
    writeFileSync(script, '#!/introuvable/interpreteur\nexit 0\n');
    chmodSync(script, 0o755);
    return { dir, script };
  }

  it('dit vrai, sans rien dire, d’un binaire qui répond à « version »', async () => {
    const warn = warnings();
    const hasBinary = await fresh();

    expect(hasBinary(fake('exit 0').binary)).toBe(true);

    expect(warn).not.toHaveBeenCalled();
  });

  it('dit faux d’un nom que le PATH ne contient pas, et avertit que les tests qui l’exigent sont sautés, pas échoués', async () => {
    const warn = warnings();
    const hasBinary = await fresh();

    expect(hasBinary('bdesk-binaire-introuvable-xyz')).toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('« bdesk-binaire-introuvable-xyz » est introuvable dans le PATH');
    expect(message).toContain('Installez-le pour les exécuter');
    expect(message).toContain('SAUTÉS');
    expect(message).toContain('CLAUDE.md');
  });

  it('dit faux d’un chemin qui n’existe pas, sans parler du PATH : un chemin n’y est pas cherché (bdesk-38k.37)', async () => {
    const warn = warnings();
    const hasBinary = await fresh();

    expect(hasBinary('/introuvable/dolt')).toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain("« /introuvable/dolt » est introuvable (ce chemin n'existe pas)");
    expect(message).not.toContain('PATH');
    expect(message).toContain('SAUTÉS');
    expect(message).toContain('CLAUDE.md');
  });

  it('dit faux d’un script qui existe mais dont l’interpréteur manque, sans le dire introuvable : ENOENT est celui de l’interpréteur (bdesk-38k.37)', async () => {
    const warn = warnings();
    const hasBinary = await fresh();
    const { script } = scriptWithoutInterpreter('dolt');

    expect(hasBinary(script)).toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain(`« ${script} » existe mais ne peut pas être lancé (ENOENT`);
    expect(message).toContain('interpréteur');
    expect(message).not.toContain('introuvable dans le PATH');
    expect(message).not.toContain("n'existe pas");
    expect(message).toContain('SAUTÉS');
  });

  it('dit de même d’un script du PATH dont l’interpréteur manque : trouvé dans le PATH, il n’est pas « introuvable dans le PATH » (bdesk-38k.37)', async () => {
    const warn = warnings();
    const hasBinary = await fresh();
    const { dir } = scriptWithoutInterpreter('bdesk-sans-interpreteur');
    vi.stubEnv('PATH', `${dir}${delimiter}${process.env.PATH ?? ''}`);

    expect(hasBinary('bdesk-sans-interpreteur')).toBe(false);

    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('« bdesk-sans-interpreteur » existe mais ne peut pas être lancé (ENOENT');
    expect(message).not.toContain('introuvable dans le PATH');
  });

  it('dit introuvable un nom que le PATH absent ne peut pas résoudre, même si le dossier courant en contient un (bdesk-38k.45)', async () => {
    const warn = warnings();
    const hasBinary = await fresh();
    const { dir } = scriptWithoutInterpreter('bdesk-sans-interpreteur');
    // Sans PATH, libuv cherche dans son chemin par défaut, pas dans le dossier courant : le nom est introuvable, et le script du dossier courant n'y change rien.
    vi.stubEnv('PATH', undefined);
    process.chdir(dir);

    expect(hasBinary('bdesk-sans-interpreteur')).toBe(false);

    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('« bdesk-sans-interpreteur » est introuvable dans le PATH');
    expect(message).not.toContain('existe mais ne peut pas être lancé');
  });

  it('dit faux d’un binaire qui existe mais échoue à « version », sans le dire introuvable (bdesk-38k.37)', async () => {
    const warn = warnings();
    const hasBinary = await fresh();
    const { binary } = fake('exit 3');

    expect(hasBinary(binary)).toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain(binary);
    expect(message).toContain('version'); // c'est la commande qui échoue
    expect(message).toContain('code de sortie 3'); // et il dit pourquoi
    expect(message).toContain('SAUTÉS');
    expect(message).toContain('CLAUDE.md');
    expect(message).not.toContain('introuvable'); // le binaire est là : un « introuvable » enverrait chercher la mauvaise cause
  });

  it('dit faux d’un binaire qui existe mais ne peut pas être lancé (non exécutable), avec la cause du système', async () => {
    const warn = warnings();
    const hasBinary = await fresh();
    const { binary } = fake('exit 0');
    chmodSync(binary, 0o644);

    expect(hasBinary(binary)).toBe(false);

    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('EACCES');
    expect(message).toContain('SAUTÉS');
    expect(message).not.toContain('introuvable');
  });

  it('ne le dit qu’une fois par binaire dans un fichier de tests (dolt.test.ts le demande cinq fois), mais le dit de chacun', async () => {
    const warn = warnings();
    const hasBinary = await fresh();

    for (let i = 0; i < 5; i++) hasBinary('/introuvable/dolt');
    hasBinary('/introuvable/bd');

    expect(warn).toHaveBeenCalledTimes(2);
  });
});

/**
 * `dolt` lance, après chaque commande, un processus détaché (`dolt send-metrics`) qui recrée `DOLT_ROOT_PATH` s'il a disparu, même quand ses métriques sont
 * désactivées : mesuré, un dossier retiré revenait dans les 100 ms qui suivaient la dernière commande, avec un `config_global.json` de `{}` et un `eventsData`.
 * Le dossier d'un fichier de tests, retiré à sa fin (`scratchDir`) juste après sa dernière commande, restait donc dans le dossier temporaire (bdesk-38k.60) :
 * `isolatedDoltEnv` demande à dolt de ne pas lancer ce processus (`DOLT_DISABLE_EVENT_FLUSH`).
 */
describe.skipIf(!hasBinary('dolt'))('isolatedDoltEnv : le dossier de configuration retiré après une commande de dolt ne revient pas (bdesk-38k.60)', () => {
  it('reste retiré : dolt ne lance pas, après sa commande, le processus qui le recréerait', async () => {
    const env = isolatedDoltEnv();
    const root = String(env.DOLT_ROOT_PATH);
    const database = scratchDir('bdesk-essai-');
    dolt(env, database, 'init', '--name', 'testeur', '--email', 'testeur@example.com');
    dolt(env, database, 'sql', '-r', 'json', '-q', 'select 1'); // la lecture que l'app fait toute la journée
    rmSync(root, { recursive: true, force: true });

    await new Promise((resolve) => setTimeout(resolve, 800)); // le processus revenait en moins de 100 ms ; une machine chargée peut l'allonger
    expect(existsSync(root)).toBe(false);
  });
});
