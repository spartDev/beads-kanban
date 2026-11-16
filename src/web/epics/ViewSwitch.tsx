import { Columns3, ListTree, type LucideIcon } from 'lucide-react';
import { useT } from '../i18n';
import { cx } from '../lib/cx';
import type { EpicView } from './view';

const OPTIONS: readonly { id: EpicView; label: 'byColumn' | 'tree'; icon: LucideIcon }[] = [
  { id: 'columns', label: 'byColumn', icon: Columns3 },
  { id: 'tree', label: 'tree', icon: ListTree },
];

/**
 * Le choix de l'affichage des Enfants : par colonne ou en arbre. Deux boutons à bascule (`aria-pressed`) dans un groupe nommé,
 * pas des onglets : ils ne changent pas de panneau d'une page, ils changent la façon de lire la même liste.
 */
export function ViewSwitch({ value, onChange }: { value: EpicView; onChange: (view: EpicView) => void }) {
  const words = useT().epics.children;
  return (
    <div role="group" aria-label={words.viewGroup} className="inline-flex rounded-md border border-line bg-well p-0.5">
      {OPTIONS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={cx(
            'inline-flex h-7 items-center gap-1.5 rounded px-2 text-ui font-medium transition-colors',
            value === id ? 'bg-panel text-ink shadow-panel' : 'text-ink-2 hover:text-ink',
          )}
        >
          <Icon size={13} strokeWidth={2} aria-hidden="true" />
          {words[label]}
        </button>
      ))}
    </div>
  );
}
