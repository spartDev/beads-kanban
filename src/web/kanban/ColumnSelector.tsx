import { cx } from '../lib/cx';
import type { Board, ColumnId } from './columns';
import { COLUMNS, ticketNoun } from './meta';

/**
 * Mobile : le sélecteur de colonne. Une seule colonne est affichée à la fois ; chaque bouton annonce le nombre de
 * cartes de la sienne. Il colle sous la barre du haut pendant qu'on fait défiler la colonne, et disparaît dès que le
 * panneau est assez large pour afficher les cinq. Qu'il soit affiché ou non dit quelle disposition est en vigueur : les
 * raccourcis h et l le lisent (`data-column-selector`) pour savoir s'ils ont une colonne affichée ou les cinq.
 */
export function ColumnSelector({
  board,
  current,
  onSelect,
}: {
  board: Board;
  current: ColumnId;
  onSelect: (column: ColumnId) => void;
}) {
  return (
    <div
      data-column-selector
      className="sticky top-12 z-10 -mx-4 bg-panel px-4 py-1.5 md:top-11 md:-mx-5 md:px-5 @min-[60rem]:hidden"
    >
      <div role="group" aria-label="Colonne affichée" className="grid grid-cols-5 gap-0.5 rounded-lg border border-line bg-well p-0.5">
        {COLUMNS.map(({ id, label }) => {
          const count = board.columns[id].length;
          const active = id === current;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(id)}
              className={cx(
                'flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-md px-0.5 py-1.5 text-micro font-medium transition-colors',
                active ? 'bg-panel text-ink shadow-[0_0_0_1px_var(--line)]' : 'text-ink-2 hover:text-ink',
              )}
            >
              <span className="text-center wrap-anywhere">{label}</span>
              <span className="tnum text-xs font-semibold">
                {count}
                <span className="sr-only"> {ticketNoun(count)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
