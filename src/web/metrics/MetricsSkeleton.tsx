import { useT } from '../i18n';
import { Skeleton } from '../ui/states';
import { HEALTH_GRID, HEALTH_SPANS } from './healthGrid';
import { INDICATOR_GRID, INDICATOR_SPANS } from './indicatorGrid';

/**
 * La silhouette de la page pendant le premier calcul : le parcours d'un ticket, sept tuiles, le flux cumulé, deux graphiques, puis la santé du flux : cinq tuiles et deux graphiques.
 *
 * `minHeight` : la hauteur des chiffres qu'elle remplace, quand le fuseau du navigateur change (bdesk-38k.81 ; voir `useKeptPlace`). Un plancher, pas une hauteur : plus bas que la silhouette, il ne
 * change rien ; plus haut, la page garde sa hauteur et le défilement de qui lisait plus bas n'est pas ramené en haut. La dernière rangée grandit pour le remplir : une silhouette qui ne couvre que le
 * haut de la place laisserait, plus bas, un vide que rien n'explique.
 */
export function MetricsSkeleton({ minHeight }: { minHeight?: number }) {
  const t = useT();
  return (
    <div role="status" aria-busy="true" aria-label={t.metrics.metricsSkeleton.loading} style={minHeight === undefined ? undefined : { minHeight }} className="flex flex-col gap-6">
      <Skeleton className="h-96" />
      <div className={INDICATOR_GRID}>
        {INDICATOR_SPANS.map((span, index) => (
          <Skeleton key={index} className={`h-40 ${span}`} />
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
      <div className="grid flex-1 gap-3 @min-[56rem]:grid-cols-2">
        <Skeleton className="min-h-72" />
        <Skeleton className="min-h-72" />
      </div>
    </div>
  );
}
