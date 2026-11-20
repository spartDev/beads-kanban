import { describe, expect, it } from 'vitest';
import { columnsOf } from '../../domain/columns';
import { HANDOFF_STATUSES } from '../../domain/statuses';
import type { HandoffStatus } from '../../shared/api';
import { CATALOGS } from '../i18n/catalog';
import type { Language } from '../i18n/language';
import { columnMeta } from '../kanban/meta';
import { holds, lengthOf, rootFontSizeOf, rulesFor, selectorOf } from '../test/compiledCss';
import { KERNING_ALLOWANCE, SANS_FILE, textMeasurer } from '../test/fontMetrics';
import { childColumnWidth } from './ChildRow';

/**
 * La colonne écrite sur une ligne de l'arborescence d'une Epic (`ChildRow`) a, dès `sm`, une largeur fixe : les noms s'alignent d'une ligne à l'autre,
 * et la priorité et l'âge qui suivent aussi. En français, un Projet sans colonne de relais garde celle d'avant (`sm:w-14`, 63 px), telle quelle : ses
 * titres gardent leur place. Sinon, la case prend la largeur du plus long nom des colonnes du Projet et d'« En pause », dans la langue de l'interface :
 * ce test les mesure dans la police de l'application, à la taille de la ligne (`text-xs`, lue dans la feuille, à 18 px le rem), crénage compris,
 * pour chacun des huit jeux de colonnes de relais possibles (aucune comprise), dans les deux langues.
 */

const SM = 640;
const LINE_TEXT = 'text-xs';
const LANGUAGES: Language[] = ['fr', 'en'];

/** Les huit jeux de Statuts de relais, du jeu vide aux trois. */
const RELAY_SETS: HandoffStatus[][] = Array.from({ length: 2 ** HANDOFF_STATUSES.length }, (_, mask) => HANDOFF_STATUSES.filter((_status, index) => (mask >> index) & 1));

/** La feuille compilée pour `classes`, et ce que la classe `name` y déclare pour `property` à 640 px de fenêtre. */
async function sheetFor(classes: readonly string[]) {
  const sheet = await rulesFor([...classes, LINE_TEXT]);
  const at = (name: string, property: string) => {
    let found: string | undefined;
    for (const rule of sheet) {
      if (rule.selector === selectorOf(name) && property in rule.declarations && rule.within.every((condition) => holds(condition, SM))) found = rule.declarations[property];
    }
    return found;
  };
  return { sheet, at, root: rootFontSizeOf(sheet) };
}

describe('la colonne d’une ligne de l’arborescence d’une Epic', () => {
  it('garde en français, pour un Projet sans colonne de relais, exactement la classe d’avant', () => {
    expect(childColumnWidth(columnsOf([]), 'fr')).toBe('sm:w-14');
  });

  it('s’élargit en anglais, même sans colonne de relais : « In progress » (69,5 px) ne tient pas dans 63 px', () => {
    expect(childColumnWidth(columnsOf([]), 'en')).toBe('sm:w-16');
  });

  it('prend en français la largeur d’« En intégration », en anglais celle d’« Awaiting validation », avec les trois colonnes de relais', () => {
    expect(childColumnWidth(columnsOf([...HANDOFF_STATUSES]), 'fr')).toBe('sm:w-19');
    expect(childColumnWidth(columnsOf([...HANDOFF_STATUSES]), 'en')).toBe('sm:w-26');
  });

  it.each(LANGUAGES.flatMap((language) => RELAY_SETS.map((set) => [language, set.join(', ') || 'aucune colonne de relais', set] as const)))(
    'en %s, avec %s, a une largeur fixe qui tient sur une ligne le nom de chaque colonne et « En pause », sans plus',
    async (language, _name, set) => {
      const columns = columnsOf(set);
      const width = childColumnWidth(columns, language);
      const { sheet, at, root } = await sheetFor([width]);
      const available = lengthOf(sheet, at(width, 'width') as string, root);
      const size = lengthOf(sheet, at(LINE_TEXT, 'font-size') as string, root);
      const sans = textMeasurer(SANS_FILE);

      expect(at(width, 'min-width')).toBeUndefined();
      expect(size).toBe(13.5);
      const labels = [...columns.map((id) => columnMeta(language)[id].label), CATALOGS[language].epics.children.paused];
      const widest = Math.max(...labels.map((label) => sans(label, { size }) + KERNING_ALLOWANCE));
      expect(widest).toBeLessThanOrEqual(available);
      // Pas plus large qu'il ne faut : moins d'un demi-rem de marge, pour ne pas prendre aux titres plus que les noms n'en demandent. La case d'avant
      // (63 px), elle, reste telle quelle : « En pause » (55,5 px) lui laisse 7,5 px.
      expect(available - widest).toBeLessThan(root / 2);
    },
  );
});
