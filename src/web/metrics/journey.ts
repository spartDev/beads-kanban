import type { MetricsCfdPoint, MetricsHealth, MetricsTiles } from '../../shared/api';

/**
 * Le parcours d'un ticket (bdesk-bxq.3) : ce qui entre (les Arrivées), les trois états qu'un ticket traverse (Backlog, Prêt, En cours) et ce qui sort (les Livraisons).
 * La page le dessine comme un fil : la longueur de chaque tronçon est la part du Lead Time cumulé des Livraisons qui s'y est passée, et chaque tronçon dit combien
 * de tickets s'y trouvent. Rien n'est calculé ici que l'API ne serve déjà : les parts viennent de la Décomposition du Lead Time, les tickets du dernier relevé du flux cumulé.
 *
 * Les cinq parts de la Décomposition se rangent en trois tronçons. L'Attente de dépendance est le temps en Backlog ; l'Attente en Prêt, le temps Prêt ; le travail et le
 * Blocage (qui est dans le Cycle Time) sont le temps En cours. L'autre attente (un ticket différé, ou revenu en Backlog après un premier démarrage) n'appartient à aucun des
 * trois : le fil lui garde sa longueur, entre Prêt et En cours, et la page la dit à part, pour que les parts écrites restent celles de la Décomposition.
 */

export type JourneyStageKey = 'backlog' | 'ready' | 'work';

export interface JourneyStage {
  key: JourneyStageKey;
  /** Le nom de l'état, celui de sa colonne au kanban. */
  label: string;
  /** Ce que le ticket y fait, à lire après « du temps » : « à attendre une dépendance ». */
  doing: string;
  /** Temps cumulé des Livraisons dans cet état (ms). */
  duration: number;
  /** Part du Lead Time cumulé, de 0 à 1 ; null quand il n'y a rien à répartir. */
  share: number | null;
  /** Tickets dans cet état au dernier relevé ; null sans relevé. */
  stock: number | null;
}

export interface JourneyView {
  /** Tickets créés sur la période. */
  arrivals: number;
  /** Livraisons de la période. */
  deliveries: number;
  stages: readonly [JourneyStage, JourneyStage, JourneyStage];
  /**
   * La largeur de chaque tronçon du fil, en parts qui s'additionnent : Backlog, Prêt (avec l'autre attente), En cours. Sans rien à répartir, trois parts égales :
   * le fil se dessine quand même, sans rien affirmer.
   */
  widths: readonly [number, number, number];
  /** Part du Lead Time cumulé passée à attendre (dépendance, Prêt, autre attente) ; null quand il n'y a rien à répartir. */
  waitShare: number | null;
  /** Part de l'autre attente ; null quand il n'y a rien à répartir. */
  otherShare: number | null;
  /** Part du Blocage, qui est dans le tronçon En cours ; null quand il n'y a rien à répartir. */
  blockedShare: number | null;
  /** Tickets en Blocage parmi ceux en cours, au dernier relevé ; null sans relevé. */
  blockedStock: number | null;
  /** Prêts qui stagnent, et l'âge au-delà duquel un Prêt stagne (ms). */
  stagnant: number;
  stagnantAfter: number;
  /** Lead Time cumulé des Livraisons (ms). */
  total: number;
  /** Aucune Livraison, ou aucun Lead Time cumulé : pas de part à donner. */
  empty: boolean;
}

export function describeJourney({ tiles, health, cfd }: { tiles: Pick<MetricsTiles, 'arrivals' | 'throughput'>; health: Pick<MetricsHealth, 'leadTimeBreakdown' | 'readyAges'>; cfd: readonly MetricsCfdPoint[] }): JourneyView {
  const breakdown = health.leadTimeBreakdown;
  const empty = breakdown.deliveries === 0 || breakdown.total === 0;
  const share = (duration: number): number | null => (empty ? null : duration / breakdown.total);
  // Le dernier relevé du flux cumulé : l'état des colonnes à la fin de la période, ou maintenant si elle court encore.
  const last = cfd.at(-1);
  const working = breakdown.work + breakdown.blocked;

  const stages = [
    { key: 'backlog', label: 'Backlog', doing: 'à attendre une dépendance', duration: breakdown.dependencyWait, share: share(breakdown.dependencyWait), stock: last ? last.backlog : null },
    { key: 'ready', label: 'Prêt', doing: 'à attendre d’être démarré', duration: breakdown.readyWait, share: share(breakdown.readyWait), stock: last ? last.ready : null },
    { key: 'work', label: 'En cours', doing: 'au travail', duration: working, share: share(working), stock: last ? last.inProgress + last.blocked : null },
  ] as const satisfies readonly JourneyStage[];

  return {
    arrivals: tiles.arrivals.total,
    deliveries: tiles.throughput.total,
    stages,
    widths: empty ? [1, 1, 1] : [breakdown.dependencyWait, breakdown.readyWait + breakdown.otherWait, working],
    waitShare: share(breakdown.dependencyWait + breakdown.readyWait + breakdown.otherWait),
    otherShare: share(breakdown.otherWait),
    blockedShare: share(breakdown.blocked),
    blockedStock: last ? last.blocked : null,
    stagnant: health.readyAges.stagnant,
    stagnantAfter: health.readyAges.stagnantAfter,
    total: breakdown.total,
    empty,
  };
}
