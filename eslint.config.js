import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Les dossiers temporaires des tests (bdesk-38k.60) : un `mkdtemp` direct, ou un dossier à nom fixe sous `tmpdir()`, reste dans le dossier temporaire du système après
// la suite (elle en laissait plus de 300 par exécution). Ils passent par `scratchDir` (src/server/testing/scratch.ts), que le fichier de tests retire à sa fin.
// Ce que la règle voit : l'import de `mkdtemp`, son accès par point ou par crochets, sa déstructuration, `mkdirSync(join(tmpdir(), …))` et `join(tmpdir(), 'bdesk-…')`.
// Ce qu'elle ne voit pas : un nom construit (`fs[nom]`), un chemin passé par une variable (`const d = join(tmpdir(), 'x'); mkdirSync(d)`) ou un autre moyen de créer un
// dossier. `src/server/testing/scratch-lint.test.ts` essaie chaque forme, refusée ou permise, sur cette configuration même.
const MKDTEMP = '/^mkdtemp(Sync)?$/';
const MKDIR = '/^mkdir(Sync)?$/';
/** `f(…)` ou `x.f(…)` : le nom appelé se lit dans `callee.name` ou dans `callee.property.name`. */
const calling = (path, name) => [`[${path}callee.name=${name}]`, `[${path}callee.property.name=${name}]`];
/** `join(tmpdir(), …)`, sous toutes ses formes : `path.join(os.tmpdir(), …)`, `resolve(tmpdir(), …)`. */
const underTmpdir = calling('', '/^(join|resolve)$/').flatMap((join) =>
  calling('arguments.0.', '/^tmpdir$/').map((tmpdir) => `CallExpression${join}${tmpdir}`),
);
const MKDTEMP_FORMS = [
  `ImportSpecifier[imported.name=${MKDTEMP}]`, // import { mkdtempSync } from 'node:fs'
  `MemberExpression[property.name=${MKDTEMP}]`, // fs.mkdtempSync(…)
  `MemberExpression[computed=true][property.value=${MKDTEMP}]`, // fs['mkdtempSync'](…)
  `ObjectPattern > Property[key.name=${MKDTEMP}]`, // const { mkdtempSync } = fs
  `ObjectPattern > Property[key.value=${MKDTEMP}]`, // const { 'mkdtempSync': creer } = fs
];
const FIXED_FOLDER_FORMS = [
  ...underTmpdir.flatMap((call) => [`${call}[arguments.1.value=/^bdesk-/]`, `${call}[arguments.1.quasis.0.value.cooked=/^bdesk-/]`]), // join(tmpdir(), 'bdesk-…')
  ...calling('', MKDIR).flatMap((mkdir) => underTmpdir.map((call) => `CallExpression${mkdir} ${call}`)), // mkdirSync(join(tmpdir(), …))
];

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.beads', '.claude/worktrees', '.sandbox', '.gates'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  { files: ['src/server/**/*.ts', '*.config.ts'], languageOptions: { globals: globals.node } },
  // Les dossiers temporaires des tests passent par `scratchDir` : voir plus haut. Le code de l'app (`client.ts`) peut en créer.
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/server/testing/**/*.ts'],
    ignores: ['src/server/testing/scratch.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...MKDTEMP_FORMS.map((selector) => ({
          selector,
          message: 'Créez un dossier temporaire de test par `scratchDir` (src/server/testing/scratch.ts) : le fichier de tests le retire à sa fin.',
        })),
        ...FIXED_FOLDER_FORMS.map((selector) => ({
          selector,
          message: 'Un dossier à nom fixe sous `tmpdir()` reste après la suite : créez-le par `scratchDir` (src/server/testing/scratch.ts), que le fichier de tests retire à sa fin.',
        })),
      ],
    },
  },
);
