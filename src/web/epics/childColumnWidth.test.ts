import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOGS } from '../i18n/catalog';
import { COLUMN_IDS } from '../kanban/columns';
import { columnMeta } from '../kanban/meta';
import { holds, lengthOf, rootFontSizeOf, rulesFor, selectorOf, type Rule } from '../test/compiledCss';
import { KERNING_ALLOWANCE, SANS_FILE, textMeasurer } from '../test/fontMetrics';
import { CHILD_COLUMN_WIDTH } from './ChildRow';

/**
 * La colonne écrite sur une ligne de l'arborescence d'une Epic (`ChildRow`) a, dès `sm`, une largeur fixe : les noms s'alignent d'une ligne à l'autre,
 * et la priorité et l'âge qui suivent aussi, quel que soit le nom. Elle doit tenir le plus long nom de colonne des deux langues (« Awaiting
 * validation »), et « En pause » : ce test les mesure dans la police de l'application, à la taille de la ligne (`text-xs`, lue dans la feuille, à 18 px
 * le rem), crénage compris. Une largeur minimale ferait déborder les lignes d'un nom plus long que les autres : la règle est une largeur.
 */

const SM = 640;
const LINE_TEXT = 'text-xs';

async function widthOf(): Promise<{ sheet: Rule[]; width: string | undefined; minWidth: string | undefined; fontSize: string | undefined }> {
  const sheet = await rulesFor([...CHILD_COLUMN_WIDTH.split(' '), LINE_TEXT]);
  const at = (name: string, property: string) => {
    let found: string | undefined;
    for (const rule of sheet) {
      if (rule.selector === selectorOf(name) && property in rule.declarations && rule.within.every((condition) => holds(condition, SM))) found = rule.declarations[property];
    }
    return found;
  };
  return { sheet, width: at(CHILD_COLUMN_WIDTH, 'width'), minWidth: at(CHILD_COLUMN_WIDTH, 'min-width'), fontSize: at(LINE_TEXT, 'font-size') };
}

describe('la colonne d’une ligne de l’arborescence d’une Epic', () => {
  it('est écrite dans une largeur fixe, à partir de sm, dans la police de la ligne', async () => {
    const { width, minWidth } = await widthOf();
    expect(width).toBeDefined();
    expect(minWidth).toBeUndefined();
    expect(readFileSync(join(import.meta.dirname, 'ChildRow.tsx'), 'utf8')).toMatch(/text-xs text-ink-3">[\s\S]*className=\{CHILD_COLUMN_WIDTH\}/);
  });

  it('tient le plus long nom de colonne des deux langues, et « En pause », sur une ligne', async () => {
    const { sheet, width, fontSize } = await widthOf();
    const root = rootFontSizeOf(sheet);
    const available = lengthOf(sheet, width as string, root);
    const size = lengthOf(sheet, fontSize as string, root);
    const sans = textMeasurer(SANS_FILE);

    const labels = (['fr', 'en'] as const).flatMap((language) => [...COLUMN_IDS.map((id) => columnMeta(language)[id].label), CATALOGS[language].epics.children.paused]);
    const widest = Math.max(...labels.map((label) => sans(label, { size }) + KERNING_ALLOWANCE));
    expect(size).toBe(13.5);
    expect(labels).toContain('Awaiting validation');
    expect(widest).toBeLessThanOrEqual(available);
    // Pas plus large qu'il ne faut : moins d'un demi-rem de marge.
    expect(available - widest).toBeLessThan(root / 2);
  });
});
