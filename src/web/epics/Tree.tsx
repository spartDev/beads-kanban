import type { EpicProgress, TreeNode } from '../../domain/epics';
import type { Issue } from '../data/types';
import { cx } from '../lib/cx';
import { ChildRow } from './ChildRow';

/** Au-delà de ce niveau l'arborescence ne se décale plus : un arbre profond ne déborde pas d'un écran de téléphone. */
const MAX_INDENT = 5;

/**
 * Les Enfants d'une Epic en arbre, à tous les niveaux : chaque ticket sous son parent, avec sa colonne écrite sur sa ligne
 * (rien ne les groupe ici). Une liste dans une liste, donc lue comme telle par les lecteurs d'écran : « liste de 3 éléments »,
 * puis la sous-liste de chacun. Les niveaux se voient à un filet et un retrait ; le DOM garde la structure même quand le retrait
 * cesse de croître.
 */
export function Tree({
  nodes,
  projectId,
  now,
  progressOf,
  depth = 0,
}: {
  nodes: TreeNode<Issue>[];
  projectId: string;
  now: number;
  progressOf: (epicId: string) => EpicProgress;
  depth?: number;
}) {
  return (
    <ul aria-label={depth === 0 ? 'Arborescence' : undefined} className={cx('flex flex-col', depth > 0 && depth <= MAX_INDENT && 'ml-2.5 border-l border-line pl-2')}>
      {nodes.map(({ ticket, children }) => (
        <li key={ticket.id} className="min-w-0">
          <ChildRow
            issue={ticket}
            projectId={projectId}
            now={now}
            showColumn
            nested={ticket.type === 'epic' ? progressOf(ticket.id) : undefined}
          />
          {children.length > 0 ? <Tree nodes={children} projectId={projectId} now={now} progressOf={progressOf} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}
