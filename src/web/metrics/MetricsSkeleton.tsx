import { Skeleton } from '../ui/states';
import { HEALTH_GRID, HEALTH_SPANS } from './healthGrid';

/** La silhouette de la page pendant le premier calcul : six tuiles, le flux cumulé, deux graphiques, puis la santé du flux : cinq tuiles et deux graphiques. */
export function MetricsSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Chargement des métriques" className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 @min-[36rem]:grid-cols-3 @min-[68rem]:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-40" />
        ))}
      </div>
      <Skeleton className="h-80" />
      <div className="grid gap-3 @min-[56rem]:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
      <div className={HEALTH_GRID}>
        {HEALTH_SPANS.map((span, index) => (
          <Skeleton key={index} className={`h-36 ${span}`} />
        ))}
      </div>
      <div className="grid gap-3 @min-[56rem]:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
