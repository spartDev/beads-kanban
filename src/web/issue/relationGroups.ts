import type { IssueDetail, IssueRef } from '../data/types';
import { kanban } from '../i18n/catalog/kanban';
import type { Language } from '../i18n/language';

export interface RelationItem {
  id: string;
  /** Le ticket lié ; indéfini hors du Projet (référence externe) : il n'y a rien à ouvrir. */
  ref: IssueRef | undefined;
}

export interface RelationGroup {
  id: string;
  label: string;
  items: RelationItem[];
}

/**
 * Les genres de relations que beads emploie, dans l'ordre où le panneau les écrit. `to` : ce ticket dépend de l'autre
 * (dépendance sortante) ; `from` : l'autre dépend de ce ticket (entrante). `parent-child` : l'enfant dépend de son parent ;
 * `blocks` : le ticket qui dépend est bloqué par sa cible ; `discovered-from` : le ticket qui dépend a été découvert en
 * travaillant sur sa cible.
 */
type KindLabel = Exclude<keyof (typeof kanban)['fr']['relations']['kinds'], 'dependsOn' | 'dependedOnBy'>;

const KINDS: readonly { id: string; label: KindLabel; direction: 'to' | 'from'; types: readonly string[] }[] = [
  { id: 'parent', label: 'parent', direction: 'to', types: ['parent-child'] },
  { id: 'children', label: 'children', direction: 'from', types: ['parent-child'] },
  { id: 'blocked-by', label: 'blockedBy', direction: 'to', types: ['blocks'] },
  { id: 'blocks', label: 'blocks', direction: 'from', types: ['blocks'] },
  // Un lien « lié à » n'a pas de sens : les deux tickets se valent, quel que soit celui qui l'a posé.
  { id: 'related', label: 'related', direction: 'to', types: ['relates-to', 'related'] },
  { id: 'discovered-from', label: 'discoveredFrom', direction: 'to', types: ['discovered-from'] },
  { id: 'origin-of', label: 'originOf', direction: 'from', types: ['discovered-from'] },
  { id: 'duplicate-of', label: 'duplicateOf', direction: 'to', types: ['duplicates'] },
  { id: 'duplicates', label: 'duplicates', direction: 'from', types: ['duplicates'] },
  // Posé sur le ticket abandonné, le lien `supersedes` a pour cible celui qui le remplace : sortant, le ticket est remplacé par sa cible.
  { id: 'superseded-by', label: 'supersededBy', direction: 'to', types: ['supersedes'] },
  { id: 'supersedes', label: 'supersedes', direction: 'from', types: ['supersedes'] },
];

const KNOWN_TYPES = new Set(KINDS.flatMap((kind) => kind.types));

/**
 * Les relations d'un ticket, groupées par genre (parent, enfants, bloqué par, bloque, lié à, découvert à partir de…), avec
 * le ticket lié de chacune. Un genre sans relation n'y figure pas. Une relation que beads connaît et pas nous garde son
 * nom de type, après les autres. Les genres sont nommés dans `language`.
 */
export function groupRelations(
  { dependencies, dependents, linked }: Pick<IssueDetail, 'dependencies' | 'dependents' | 'linked'>,
  language: Language = 'fr',
): RelationGroup[] {
  const labels = kanban[language].relations.kinds;
  const item = (id: string): RelationItem => ({ id, ref: linked[id] });
  const unique = (ids: string[]) => [...new Set(ids)];

  const groups: RelationGroup[] = KINDS.map(({ id, label, direction, types }) => {
    // « Lié à » se lit dans les deux sens ; tout autre genre dans le sien.
    const both = id === 'related';
    const out = dependencies.filter((d) => types.includes(d.type)).map((d) => d.to);
    const incoming = dependents.filter((d) => types.includes(d.type)).map((d) => d.from);
    const ids = both ? [...out, ...incoming] : direction === 'to' ? out : incoming;
    return { id, label: labels[label], items: unique(ids).map(item) };
  });

  const otherTypes = (types: string[]) => [...new Set(types.filter((type) => !KNOWN_TYPES.has(type)))].sort();
  for (const type of otherTypes(dependencies.map((d) => d.type))) {
    groups.push({ id: `out:${type}`, label: labels.dependsOn(type), items: unique(dependencies.filter((d) => d.type === type).map((d) => d.to)).map(item) });
  }
  for (const type of otherTypes(dependents.map((d) => d.type))) {
    groups.push({ id: `in:${type}`, label: labels.dependedOnBy(type), items: unique(dependents.filter((d) => d.type === type).map((d) => d.from)).map(item) });
  }

  return groups.filter((group) => group.items.length > 0);
}
