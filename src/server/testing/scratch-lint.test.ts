import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/** La racine du dépôt, où est `eslint.config.js` : la configuration essayée ici est la sienne, d'où que vitest soit lancé. */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * La règle ESLint qui garde `scratchDir` (eslint.config.js, bdesk-38k.60), essayée sur du code : la vraie configuration du dépôt, par l'API d'ESLint, et non une
 * copie de ses sélecteurs. Chaque forme qu'elle doit refuser l'est ici, et ce qu'elle laisse passer aussi (un chemin qui n'est jamais créé, un faux `mkdtempSync`).
 * La relecture de bdesk-38k.60 avait trouvé qu'elle ne voyait ni la déstructuration, ni l'accès par crochets, ni le dossier à nom fixe sous `tmpdir()`.
 */
describe('règle ESLint des dossiers temporaires de test', () => {
  let eslint: ESLint;
  beforeAll(async () => {
    eslint = new ESLint({ cwd: ROOT });
    await eslint.calculateConfigForFile('src/server/testing/exemple.test.ts'); // charge la configuration (typescript-eslint, ses plugins) : seconde de plus sur une machine chargée
  }, 60_000);

  /** Ce que la règle dit de `code`, comme s'il était dans `filePath`. */
  async function refusals(code: string, filePath = 'src/server/testing/exemple.test.ts') {
    const [result] = await eslint.lintText(code, { filePath });
    return (result?.messages ?? []).filter((message) => message.ruleId === 'no-restricted-syntax');
  }

  it.each([
    // Ce que la règle refusait déjà.
    ['un import de mkdtempSync', "import { mkdtempSync } from 'node:fs';"],
    ['un import de mkdtemp renommé', "import { mkdtemp as creer } from 'node:fs/promises';"],
    ['un accès par point', "import * as fs from 'node:fs';\nfs.mkdtempSync('/tmp/bdesk-a-');"],
    ['un mkdtemp promisifié', "import { promisify } from 'node:util';\nimport * as fs from 'node:fs';\nexport const creer = promisify(fs.mkdtemp);"],
    // Ce qu'elle ne voyait pas.
    ['une déstructuration', "import * as fs from 'node:fs';\nconst { mkdtempSync } = fs;"],
    ['une déstructuration renommée, d’un require', "const { mkdtempSync: creer } = require('node:fs');"],
    ['une déstructuration d’un import dynamique', "const { mkdtemp } = await import('node:fs/promises');"],
    ['une déstructuration à clé texte', "import * as fs from 'node:fs';\nconst { 'mkdtempSync': creer } = fs;"],
    ['un accès par crochets', "import * as fs from 'node:fs';\nfs['mkdtempSync']('/tmp/bdesk-b-');"],
    ['un accès par crochets à mkdtemp', "import { promises } from 'node:fs';\npromises['mkdtemp']('/tmp/bdesk-b-');"],
    ['un dossier à nom fixe créé sous tmpdir()', "mkdirSync(join(tmpdir(), 'dossier-fixe'), { recursive: true });"],
    ['un dossier à nom fixe créé par fs.mkdirSync et path.join', "fs.mkdirSync(path.join(os.tmpdir(), 'dossier-fixe'));"],
    ['un dossier à nom fixe créé par mkdir et resolve', "await mkdir(resolve(tmpdir(), 'dossier-fixe'));"],
    ['un chemin bdesk-* écrit à la main sous tmpdir()', "const rootPath = join(tmpdir(), 'bdesk-fake-dolt-root');"],
    ['un chemin bdesk-* écrit à la main par path.join et os.tmpdir', "const rootPath = path.join(os.tmpdir(), 'bdesk-fake-dolt-root');"],
    ['un chemin bdesk-* écrit à la main dans un gabarit', 'const rootPath = join(tmpdir(), `bdesk-${nom}`);'],
  ])('refuse %s', async (_name, code) => {
    const found = await refusals(code);

    expect(found.length).toBeGreaterThan(0);
    expect(found.every((message) => message.message.includes('scratchDir'))).toBe(true);
  });

  it.each([
    ['scratchDir', "const dir = scratchDir('bdesk-x-');"],
    ['un chemin sous tmpdir() qui n’est jamais créé', "loadConfig({ home, configPath: join(tmpdir(), 'absent', 'config.json') });"],
    ['tmpdir() comme dossier existant', 'client.open(tmpdir());'],
    ['la lecture du dossier temporaire', 'readdirSync(tmpdir());'],
    ['un dossier créé sous un dossier de test', "mkdirSync(join(root, 'sous-dossier'), { recursive: true });"],
    ['un nom construit sous tmpdir(), sans bdesk-', 'const chemin = join(tmpdir(), nom);'],
    ['un faux mkdtempSync dans un objet', 'const faux = { mkdtempSync: vi.fn() };'],
    ['le mot dans un texte', "const note = 'mkdtempSync';"],
  ])('laisse passer %s', async (_name, code) => {
    expect(await refusals(code)).toEqual([]);
  });

  it('ne vaut que pour les tests et leurs fixtures : le code de l’app peut créer ses dossiers, et scratch.ts est le seul à appeler mkdtemp', async () => {
    const code = "import { mkdtempSync } from 'node:fs';\nmkdtempSync('/tmp/x-');\nmkdirSync(join(tmpdir(), 'bdesk-fixe'));";

    expect(await refusals(code, 'src/server/dolt/client.ts')).toEqual([]);
    expect(await refusals(code, 'src/server/testing/scratch.ts')).toEqual([]);
    expect((await refusals(code, 'src/server/testing/fake-dolt.ts')).length).toBeGreaterThan(0);
    expect((await refusals(code, 'src/web/exemple.test.tsx')).length).toBeGreaterThan(0);
  });
});
