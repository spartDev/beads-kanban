import { ChevronRight, CirclePause } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { cx } from '../lib/cx';
import { ticketNoun } from './meta';

const PANEL_ID = 'kanban-paused';

/**
 * Le tiroir « En pause » : les tickets différés, épinglés ou d'un statut que le kanban ne connaît pas (statut
 * personnalisé de beads, ou statut vide), qui ne sont dans aucune colonne. Fermé tant qu'on ne l'ouvre pas ; il se
 * montre même vide, pour qu'on sache où irait un ticket différé. Ouvert et fermé par le tableau (`open`) : l'état vide d'un
 * tableau dont tous les tickets sont en pause l'ouvre aussi, et amène le focus sur son bouton (`toggleRef`).
 */
export function PausedDrawer({
  count,
  open,
  onOpenChange,
  toggleRef,
  children,
}: {
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Le bouton qui ouvre et ferme le tiroir. */
  toggleRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={() => onOpenChange(!open)}
        className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-ui font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
      >
        <ChevronRight size={14} aria-hidden="true" className={cx('shrink-0 text-ink-3 transition-transform', open && 'rotate-90')} />
        <CirclePause size={14} aria-hidden="true" className="shrink-0 text-ink-3" />
        En pause
        <span className="tnum text-ink-3">
          {count}
          <span className="sr-only"> {ticketNoun(count)}</span>
        </span>
        <span className="hidden min-w-0 truncate text-xs font-normal text-ink-3 sm:inline">Reportés, épinglés ou d’un statut inconnu</span>
      </button>

      {open ? (
        <div id={PANEL_ID} role="region" aria-label="En pause" className="rounded-xl border border-line bg-well p-1.5">
          {count > 0 ? (
            <ul className="grid grid-cols-1 gap-1.5 @min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-5">{children}</ul>
          ) : (
            <p className="px-2.5 py-4 text-center text-xs text-ink-3">Aucun ticket en pause</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
