import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * L'anneau de focus de l'application (styles.css) : le contour d'accent, de 2 px et décalé de 2 px, que prennent au clavier les éléments de cette liste. Un élément qui n'y figure pas garde
 * l'anneau du navigateur, bleu et collé à son bord : c'était le cas du résumé d'un `<details>`, dont la ligne entière déplie (bdesk-38k.82). Les règles sont lues dans la feuille de style,
 * comme design/contrast.test.ts en lit les couleurs.
 */

const css = readFileSync(join(import.meta.dirname, '../styles.css'), 'utf8');
const rule = /:where\(([^)]*)\):focus-visible\s*\{([^}]*)\}/.exec(css);
const selectors = (rule?.[1] ?? '').split(',').map((selector) => selector.trim());
const declarations = rule?.[2] ?? '';

describe('l’anneau de focus de l’application', () => {
  it('est une règle de styles.css', () => {
    expect(rule, 'styles.css : « :where(…):focus-visible { … } » introuvable').not.toBeNull();
  });

  it('couvre le résumé d’un <details>, avec les liens, les boutons, les champs et ce qui prend le focus par tabindex', () => {
    expect(selectors).toEqual(expect.arrayContaining(['summary', 'a', 'button', 'input', "[role='button']", '[tabindex]']));
  });

  it('est un contour d’accent de 2 px, décalé de 2 px', () => {
    expect(declarations).toMatch(/outline:\s*2px solid var\(--accent\)/);
    expect(declarations).toMatch(/outline-offset:\s*2px/);
  });
});
