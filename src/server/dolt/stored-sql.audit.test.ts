import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * L'inventaire de ce que le serveur envoie à Dolt (bdesk-38k.74, relecture finale, round 4 : « chercher toute autre requête lancée contre une autre base que celle qu'on vérifie, ou par le client brut
 * hors de la vérification »). Trois règles, que ce fichier garde pour les chemins qu'aucun essai n'emprunte :
 *
 *   1. le client brut (`createDoltClient`) n'est créé que par `client.ts`, qui le définit, et `stored-sql.ts`, qui l'enveloppe de la vérification (`createCheckedDoltClient`) : le service des Projets et la
 *      découverte reçoivent le client vérifié, et aucun autre fichier du serveur n'en construit un ;
 *   2. aucune instruction du serveur ne liste les bases (`information_schema.schemata`, `show databases`) : celle que la vérification vérifie est la seule qu'elle lit ;
 *   3. `stored-sql.ts`, qui envoie ses propres instructions par le client brut (la recherche du commit de base, le diagnostic), n'écrit jamais une table qualifiée par une base (`` `<base>`.table ``,
 *      `${sqlIdent(…)}.`) : la seule référence à une autre racine est celle d'une **révision de la même base**, `` `<base>/<commit>` ``, sans point après (`revisionTablesSql`, `history.ts`).
 *
 * C'est la règle qui a manqué : `culpritDatabase` (R5, round 3) lançait `` select count(*) from `<voisine>`.dolt_nonlocal_tables `` par le client brut, et une vue de ce nom, dans la voisine, s'exécutait
 * (`stored-sql.neighbour.integration.test.ts`). Les essais, qui construisent des clients bruts à dessein pour établir des faits sur leurs propres bases jetables, ne sont pas du serveur : ils sont exclus.
 */
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Les fichiers de production du serveur : ni les essais (`*.test.ts`), ni les aides d'essai (`testing/`). */
function productionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'testing' ? [] : productionFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

/** Le code sans ses commentaires : un commentaire qui raconte une règle ne la viole pas. */
const withoutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`\\])\/\/.*$/gm, '$1');

const FILES = productionFiles(SERVER).map((path) => ({ name: relative(SERVER, path), code: withoutComments(readFileSync(path, 'utf8')) }));

describe('la vérification ne lit que la base qu’elle vérifie', () => {
  it('le serveur a des fichiers de production à inspecter (l’inventaire ne passe pas parce qu’il est vide)', () => {
    expect(FILES.length).toBeGreaterThan(20);
    expect(FILES.map((file) => file.name)).toEqual(expect.arrayContaining(['dolt/stored-sql.ts', 'dolt/client.ts', 'dolt/history.ts', 'dolt/reader.ts', 'projects/service.ts']));
  });

  it('`createDoltClient` n’est appelé que par `client.ts` (sa définition) et `stored-sql.ts` (qui l’enveloppe de la vérification)', () => {
    const callers = FILES.filter((file) => /\bcreateDoltClient\s*\(/.test(file.code)).map((file) => file.name);

    expect(callers.sort()).toEqual(['dolt/client.ts', 'dolt/stored-sql.ts']);
  });

  it('le service des Projets et la découverte reçoivent le client vérifié par défaut', () => {
    for (const name of ['projects/service.ts', 'projects/discovery.ts']) {
      const code = FILES.find((file) => file.name === name)?.code ?? '';

      expect(code, name).toContain('createCheckedDoltClient()');
      expect(code, name).not.toMatch(/\bcreateDoltClient\b/);
    }
  });

  it('aucune instruction du serveur ne liste les bases : ni `information_schema.schemata`, ni `show databases`', () => {
    for (const file of FILES) {
      expect(file.code, file.name).not.toMatch(/information_schema\s*\.\s*schemata/i);
      expect(file.code, file.name).not.toMatch(/show\s+databases/i);
    }
  });

  it('`stored-sql.ts` et `history.ts` n’écrivent aucune table qualifiée par une base : une révision `` `<base>/<commit>` `` de la même base, jamais `` `<base>`.table ``', () => {
    for (const name of ['dolt/stored-sql.ts', 'dolt/history.ts']) {
      const code = FILES.find((file) => file.name === name)?.code ?? '';

      expect(code, name).not.toMatch(/\$\{\s*sqlIdent\([^)]*\)\s*\}\s*\./); // `${sqlIdent(base)}.table`
      expect(code, name).not.toMatch(/`\s*\$\{[^}]*\}\s*`\s*\.\s*[A-Za-z_]/); // `${base}`.table, en échappant à la main
    }
  });

  it('`client.ts` est le seul fichier du serveur qui lance un processus (`child_process`) : tout SQL part de lui, après le garde de lecture seule', () => {
    const launchers = FILES.filter((file) => /\bchild_process\b/.test(file.code)).map((file) => file.name);

    expect(launchers).toEqual(['dolt/client.ts']);
  });
});
