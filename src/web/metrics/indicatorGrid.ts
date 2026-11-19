/**
 * La grille des sept tuiles des indicateurs, sans case vide quelle que soit la largeur du conteneur, et le Débit sain toujours à côté du Débit, sur la même
 * rangée : sur deux colonnes (écran étroit), les tuiles vont par paires et le WIP, dernier, occupe sa ligne ; de 36rem à 68rem, la grille a six colonnes, le
 * Débit et le Débit sain en prennent trois chacun, les trois suivantes deux, les deux dernières trois (2 + 3 + 2) ; dès 68rem, douze colonnes, trois pour
 * chacune des quatre premières et quatre pour chacune des trois dernières (4 + 3). Les tuiles (`MetricTiles`) et la silhouette de la page
 * (`MetricsSkeleton`, dans le morceau principal, qui ne doit pas importer les tuiles) la partagent : elles ne peuvent pas diverger.
 */
export const INDICATOR_GRID = 'grid grid-cols-2 gap-3 @min-[36rem]:grid-cols-6 @min-[68rem]:grid-cols-12';

/** La portée en colonnes de chaque tuile, dans l'ordre : Débit, Débit sain, Lead Time, Cycle Time, Taux d'échec, Temps de rétablissement, WIP. */
export const INDICATOR_SPANS = [
  '@min-[36rem]:col-span-3',
  '@min-[36rem]:col-span-3',
  '@min-[36rem]:col-span-2 @min-[68rem]:col-span-3',
  '@min-[36rem]:col-span-2 @min-[68rem]:col-span-3',
  '@min-[36rem]:col-span-2 @min-[68rem]:col-span-4',
  '@min-[36rem]:col-span-3 @min-[68rem]:col-span-4',
  'col-span-2 @min-[36rem]:col-span-3 @min-[68rem]:col-span-4',
] as const;
