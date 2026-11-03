import { lazy, Suspense } from 'react';
import { MetricsSkeleton } from './MetricsSkeleton';
import type { MetricsScope } from './MetricsView';

/**
 * La vue des métriques est un morceau à part, chargé à l'ouverture d'une page Métriques ou de la Vue globale : visx, d3 et les
 * cinq graphiques pèsent près de 130 kB que le kanban n'a pas à télécharger. Ce fichier est le seul à la désigner d'une façon que
 * le bundler suit (`import()`) ; l'import de son type est effacé à la compilation.
 */
const View = lazy(() => import('./MetricsView').then((module) => ({ default: module.MetricsView })));

/**
 * Pendant que le morceau arrive, la silhouette de la page tient la place : c'est celle que la vue montre elle-même pendant le
 * premier calcul des chiffres, la page ne change pas d'allure entre les deux attentes. Le titre de la page, lui, est déjà là.
 */
export function LazyMetricsView({ scope }: { scope: MetricsScope }) {
  return (
    <Suspense fallback={<MetricsSkeleton />}>
      <View scope={scope} />
    </Suspense>
  );
}
