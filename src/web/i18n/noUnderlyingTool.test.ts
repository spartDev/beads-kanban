import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../lib/appName';
import { CATALOGS } from './catalog';
import { LANGUAGES } from './language';

/**
 * L'interface ne nomme pas l'outil de tickets qu'elle lit (bdesk-1xz) : l'utilisateur suit des Projets, pas un outil. Aucun texte du
 * catalogue, dans aucune langue, ne cite beads ni sa commande bd ; un texte à paramètres est lu dans sa source.
 */
const UNDERLYING_TOOL = /\bbeads?\b|\bbd\b/i;

function texts(value: unknown, path: string): [string, string][] {
  if (typeof value === 'string') return [[path, value]];
  if (typeof value === 'function') return [[path, String(value)]];
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => texts(child, `${path}.${key}`));
  }
  return [];
}

describe('l’interface ne nomme pas l’outil de tickets qu’elle lit', () => {
  for (const language of LANGUAGES) {
    it(`aucun texte du catalogue ne le cite (${language})`, () => {
      const found = texts(CATALOGS[language], language).filter(([, text]) => UNDERLYING_TOOL.test(text));
      expect(found).toEqual([]);
    });
  }

  it('l’onglet porte le nom de l’application avant tout rendu', () => {
    const source = readFileSync(join(import.meta.dirname, '../index.html'), 'utf8');
    expect(source).toContain(`<title>${APP_NAME}</title>`);
  });
});
