import { useLayoutEffect, useRef } from 'react';
import { useFormat, useLanguage, useT } from '../i18n';
import { cx } from '../lib/cx';
import type { Board, ColumnId } from './columns';
import type { BoardLayout } from './layout';
import { columnMeta, ticketNoun } from './meta';

/**
 * Mobile : le sélecteur de colonne. Une seule colonne est affichée à la fois ; chaque bouton annonce le nombre de
 * cartes de la sienne. Il colle sous la barre du haut pendant qu'on fait défiler la colonne, et disparaît dès que le
 * panneau est assez large pour afficher toutes les colonnes du Projet (`layout`). Qu'il soit affiché ou non dit quelle disposition est en vigueur : les
 * raccourcis h et l le lisent (`data-column-selector`) pour savoir s'ils ont une colonne affichée ou toutes.
 *
 * Il a un bouton par colonne du Projet (`Board.columnIds`). Au-delà de cinq, avec les colonnes des Statuts de relais, les boutons gardent leur nom
 * sur une ligne et la rangée défile en elle-même quand elle ne tient pas (`layout.scrolls`) : le bouton de la colonne affichée y est ramené à la vue,
 * à l'ouverture (`?col=`), quand h ou l change de colonne et quand la rangée change de largeur, avec la place de son anneau de focus.
 */
export function ColumnSelector({
  board,
  current,
  layout,
  onSelect,
}: {
  board: Board;
  current: ColumnId;
  layout: BoardLayout;
  onSelect: (column: ColumnId) => void;
}) {
  const { language } = useLanguage();
  const t = useT();
  const format = useFormat();
  const meta = columnMeta(language);
  const row = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const group = row.current;
    if (!layout.scrolls || !group) return;
    const reveal = () => {
      const button = group.querySelector<HTMLElement>('button[aria-pressed="true"]');
      if (!button) return;
      // Le défilement de la rangée seule, à la main : `scrollIntoView` pourrait aussi faire défiler la page. Le bouton garde de chaque côté la place
      // du remplissage de la rangée, où tient son anneau de focus.
      const room = Number.parseFloat(getComputedStyle(group).paddingLeft) || 0;
      const { offsetLeft, offsetWidth } = button;
      if (offsetLeft - room < group.scrollLeft) group.scrollLeft = offsetLeft - room;
      else if (offsetLeft + offsetWidth + room > group.scrollLeft + group.clientWidth) group.scrollLeft = offsetLeft + offsetWidth + room - group.clientWidth;
    };
    reveal();
    // Et quand la rangée change de largeur (fenêtre redimensionnée, téléphone tourné) : le bouton actif ne sort pas de la vue.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(reveal);
    observer.observe(group);
    return () => observer.disconnect();
  }, [current, layout.scrolls]);

  return (
    <div data-column-selector className={cx('sticky top-12 z-10 -mx-4 bg-panel px-4 py-1.5 md:top-11 md:-mx-5 md:px-5', layout.selector)}>
      <div ref={row} role="group" aria-label={t.kanban.board.columnSelector} className={layout.selectorGroup}>
        {board.columnIds.map((id) => {
          const count = board.columns[id].length;
          const active = id === current;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(id)}
              className={cx(layout.selectorButton, active ? 'bg-panel text-ink shadow-[0_0_0_1px_var(--line)]' : 'text-ink-2 hover:text-ink')}
            >
              <span className={layout.selectorLabel}>{meta[id].label}</span>
              <span className="tnum text-xs font-semibold">
                {format.formatCount(count)}
                <span className="sr-only"> {ticketNoun(count, language)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
