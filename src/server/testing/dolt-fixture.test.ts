import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeDolt } from './fake-dolt';

/**
 * Les tests d'intégration sur une vraie base Dolt (`describe.skipIf(!hasBinary('dolt'))`) sont sautés, jamais en échec, quand le
 * binaire manque (bdesk-38k.33, remarque r4 de la relecture finale de bdesk-38k.20). Un saut silencieux passerait pour un succès :
 * `hasBinary` le dit à voix haute.
 */
describe.skipIf(process.platform === 'win32')('hasBinary : un binaire absent, ou qui ne répond pas à « version », fait sauter des tests, et le dit', () => {
  const startDirectory = process.cwd();
  /** Les dossiers que ces tests ont créés (scripts, faux binaires) : retirés à la fin de chacun (bdesk-38k.45), ils ne s'accumulent pas dans le dossier temporaire. */
  const created: string[] = [];

  afterEach(() => {
    process.chdir(startDirectory);
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** Un faux binaire `dolt` (voir `fakeDolt`), dont le dossier est retiré à la fin du test. */
  function fake(body: string) {
    const made = fakeDolt(body);
    created.push(made.dir);
    return made;
  }

  /** Un module neuf : la mémoire des binaires déjà signalés est celle d'un fichier de tests qui commence. */
  async function fresh() {
    vi.resetModules();
    return (await import('./dolt-fixture')).hasBinary;
  }
  const warnings = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  /** Un script exécutable dont l'interpréteur n'existe pas : le noyau répond ENOENT pour le script, qui est pourtant là. */
  function scriptWithoutInterpreter(name: string) {
    const dir = mkdtempSync(join(tmpdir(), 'bdesk-sans-interpreteur-'));
    created.push(dir);
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
