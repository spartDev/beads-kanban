import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeDolt } from './fake-dolt';

/**
 * Les tests d'intégration sur une vraie base Dolt (`describe.skipIf(!hasBinary('dolt'))`) sont sautés, jamais en échec, quand le
 * binaire manque (bdesk-38k.33, remarque r4 de la relecture finale de bdesk-38k.20). Un saut silencieux passerait pour un succès :
 * `hasBinary` le dit à voix haute.
 */
describe.skipIf(process.platform === 'win32')('hasBinary : un binaire absent fait sauter des tests, et le dit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /** Un module neuf : la mémoire des binaires déjà signalés est celle d'un fichier de tests qui commence. */
  async function fresh() {
    vi.resetModules();
    return (await import('./dolt-fixture')).hasBinary;
  }
  const warnings = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  it('dit vrai, sans rien dire, d’un binaire qui répond à « version »', async () => {
    const warn = warnings();
    const hasBinary = await fresh();

    expect(hasBinary(fakeDolt('exit 0').binary)).toBe(true);

    expect(warn).not.toHaveBeenCalled();
  });

  it('dit faux d’un binaire introuvable, et avertit que les tests qui l’exigent sont sautés, pas échoués', async () => {
    const warn = warnings();
    const hasBinary = await fresh();

    expect(hasBinary('/introuvable/dolt')).toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('/introuvable/dolt');
    expect(message).toContain('introuvable');
    expect(message).toContain('SAUTÉS');
    expect(message).toContain('CLAUDE.md');
  });

  it('dit faux aussi d’un binaire qui échoue à « version », avec le même avertissement', async () => {
    const warn = warnings();
    const hasBinary = await fresh();

    expect(hasBinary(fakeDolt('exit 3').binary)).toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('ne le dit qu’une fois par binaire dans un fichier de tests (dolt.test.ts le demande cinq fois), mais le dit de chacun', async () => {
    const warn = warnings();
    const hasBinary = await fresh();

    for (let i = 0; i < 5; i++) hasBinary('/introuvable/dolt');
    hasBinary('/introuvable/bd');

    expect(warn).toHaveBeenCalledTimes(2);
  });
});
