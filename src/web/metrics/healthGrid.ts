/**
 * La grille des cinq tuiles de la santé du flux, sans case vide quelle que soit la largeur du conteneur : sur deux colonnes
 * (écran étroit), la dernière tuile occupe sa ligne ; de 36rem à 68rem, la grille a six colonnes, les trois premières tuiles en
 * prennent deux chacune et les deux dernières trois (3 + 2 sur toute la largeur, là où trois colonnes en laissaient une vide) ;
 * dès 68rem, une colonne chacune. Les tuiles (`HealthTiles`) et la silhouette de la page (`MetricsSkeleton`, dans le morceau
 * principal, qui ne doit pas importer les tuiles) la partagent : elles ne peuvent pas diverger.
 */
export const HEALTH_GRID = 'grid grid-cols-2 gap-3 @min-[36rem]:grid-cols-6 @min-[68rem]:grid-cols-5';

/** La portée en colonnes de chaque tuile, dans l'ordre : Arrivées vs Débit, Efficacité, Réouverture, Abandon, Prêts. */
export const HEALTH_SPANS = [
  '@min-[36rem]:col-span-2 @min-[68rem]:col-span-1',
  '@min-[36rem]:col-span-2 @min-[68rem]:col-span-1',
  '@min-[36rem]:col-span-2 @min-[68rem]:col-span-1',
  '@min-[36rem]:col-span-3 @min-[68rem]:col-span-1',
  'col-span-2 @min-[36rem]:col-span-3 @min-[68rem]:col-span-1',
] as const;
