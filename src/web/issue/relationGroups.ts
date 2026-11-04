import type { IssueDetail, IssueRef } from '../data/types';

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
const KINDS: readonly { id: string; label: string; direction: 'to' | 'from'; types: readonly string[] }[] = [
  { id: 'parent', label: 'Parent', direction: 'to', types: ['parent-child'] },
  { id: 'children', label: 'Enfants', direction: 'from', types: ['parent-child'] },
  { id: 'blocked-by', label: 'Bloqué par', direction: 'to', types: ['blocks'] },
  { id: 'blocks', label: 'Bloque', direction: 'from', types: ['blocks'] },
  // Un lien « lié à » n'a pas de sens : les deux tickets se valent, quel que soit celui qui l'a posé.
  { id: 'related', label: 'Lié à', direction: 'to', types: ['relates-to', 'related'] },
  { id: 'discovered-from', label: 'Découvert à partir de', direction: 'to', types: ['discovered-from'] },
  { id: 'origin-of', label: 'À l’origine de', direction: 'from', types: ['discovered-from'] },
  { id: 'duplicate-of', label: 'Doublon de', direction: 'to', types: ['duplicates'] },
  { id: 'duplicates', label: 'A pour doublons', direction: 'from', types: ['duplicates'] },
  { id: 'supersedes', label: 'Remplace', direction: 'to', types: ['supersedes'] },
  { id: 'superseded-by', label: 'Remplacé par', direction: 'from', types: ['supersedes'] },
];

const KNOWN_TYPES = new Set(KINDS.flatMap((kind) => kind.types));

/**
 * Les relations d'un ticket, groupées par genre (parent, enfants, bloqué par, bloque, lié à, découvert à partir de…), avec
 * le ticket lié de chacune. Un genre sans relation n'y figure pas. Une relation que beads connaît et pas nous garde son
 * nom de type, après les autres.
 */
export function groupRelations({ dependencies, dependents, linked }: Pick<IssueDetail, 'dependencies' | 'dependents' | 'linked'>): RelationGroup[] {
  const item = (id: string): RelationItem => ({ id, ref: linked[id] });
  const unique = (ids: string[]) => [...new Set(ids)];

  const groups: RelationGroup[] = KINDS.map(({ id, label, direction, types }) => {
    // « Lié à » se lit dans les deux sens ; tout autre genre dans le sien.
    const both = id === 'related';
    const out = dependencies.filter((d) => types.includes(d.type)).map((d) => d.to);
    const incoming = dependents.filter((d) => types.includes(d.type)).map((d) => d.from);
    const ids = both ? [...out, ...incoming] : direction === 'to' ? out : incoming;
    return { id, label, items: unique(ids).map(item) };
  });

  const otherTypes = (types: string[]) => [...new Set(types.filter((type) => !KNOWN_TYPES.has(type)))].sort();
  for (const type of otherTypes(dependencies.map((d) => d.type))) {
    groups.push({ id: `out:${type}`, label: `Dépend de (${type})`, items: unique(dependencies.filter((d) => d.type === type).map((d) => d.to)).map(item) });
  }
  for (const type of otherTypes(dependents.map((d) => d.type))) {
    groups.push({ id: `in:${type}`, label: `Dont dépendent (${type})`, items: unique(dependents.filter((d) => d.type === type).map((d) => d.from)).map(item) });
  }

  return groups.filter((group) => group.items.length > 0);
}
