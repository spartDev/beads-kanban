import { cx } from '../lib/cx';
import { Skeleton } from '../ui/states';

/** Cartes de chaque colonne en attente : une silhouette du tableau, une seule colonne quand le panneau est étroit. */
const PLACEHOLDER_CARDS = [3, 4, 2, 1, 3];

export function BoardSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Chargement des tickets" className="@container">
      <div className="flex flex-col gap-2 @min-[60rem]:grid @min-[60rem]:grid-cols-5">
        {PLACEHOLDER_CARDS.map((cards, column) => (
          <div
            key={column}
            className={cx('flex-col gap-1.5 rounded-xl border border-line bg-well p-1.5', column === 0 ? 'flex' : 'hidden @min-[60rem]:flex')}
          >
            <Skeleton className="mx-1 my-1.5 h-4 w-24" />
            {Array.from({ length: cards }, (_, card) => (
              <Skeleton key={card} className="h-[4.5rem] w-full" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
