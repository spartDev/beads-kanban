import { Layers } from 'lucide-react';
import { useMemo } from 'react';
import type { Issue } from '../data/types';
import { epicLabels } from './epics';

const SELECT_ID = 'kanban-epic-filter';

/**
 * Le filtre Epic : une liste native (clavier, lecteurs d'écran et sélecteur du mobile pour rien). Les Epics ouvertes
 * viennent d'abord ; les fermées sont rangées à part dès qu'il y en a. Deux Epics de même titre portent en plus leur
 * identifiant (`epicLabels`), pour qu'on les distingue.
 */
export function EpicFilter({
  open,
  closed,
  value,
  onChange,
}: {
  open: readonly Issue[];
  closed: readonly Issue[];
  /** Identifiant de l'Epic choisie, ou vide pour toutes. */
  value: string;
  onChange: (epicId: string | null) => void;
}) {
  const labels = useMemo(() => epicLabels([...open, ...closed]), [open, closed]);
  const options = (epics: readonly Issue[]) =>
    epics.map((epic) => (
      <option key={epic.id} value={epic.id}>
        {labels.get(epic.id) ?? epic.title}
      </option>
    ));

  return (
    <div className="flex min-w-0 basis-full items-center gap-2 sm:basis-auto sm:flex-none">
      <label htmlFor={SELECT_ID} className="flex shrink-0 items-center gap-1.5 text-ui font-medium text-ink-2">
        <Layers size={14} aria-hidden="true" className="text-ink-3" />
        Epic
      </label>
      <select
        id={SELECT_ID}
        value={value}
        onChange={(event) => onChange(event.target.value || null)}
        className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-panel pl-2 pr-1 text-ui text-ink sm:w-80 sm:flex-none"
      >
        <option value="">Toutes les Epics</option>
        {closed.length > 0 ? (
          <>
            {open.length > 0 ? <optgroup label="Epics ouvertes">{options(open)}</optgroup> : null}
            <optgroup label="Epics fermées">{options(closed)}</optgroup>
          </>
        ) : (
          options(open)
        )}
      </select>
    </div>
  );
}
