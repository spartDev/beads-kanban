import { useId, useMemo, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { MetricsCfdPoint, MetricsDurationTile, MetricsHealth, MetricsTiles, MetricsTrend } from '../../shared/api';
import { SectionHeading } from './ChartParts';
import type { Comparison } from './comparison';
import { formatCount, formatDuration, formatPercent } from './format';
import { describeJourney, type JourneyStage, type JourneyView } from './journey';
import { DurationText } from './SpokenText';
import { plural, Trend } from './Tiles';
import { MEASURES } from './trend';

/**
 * Le parcours d'un ticket, en tête des métriques (bdesk-bxq.3) : la direction « Le fil ». Les chiffres sont posés là où ils se produisent. Ce qui entre est à gauche
 * (les Arrivées), ce qui sort à droite (les Livraisons) ; entre les deux, un fil de trois tronçons (Backlog, Prêt, En cours) dont la longueur est la part du Lead Time
 * cumulé qui s'y passe. Le tube est vide là où le ticket attend, plein là où l'on y travaille : on voit où part le temps sans connaître les métriques. Le Lead Time et
 * le Cycle Time sont cotés au-dessus, comme sur un plan : le premier embrasse tout le fil, le second le seul tronçon En cours.
 *
 * Le dessin (fil, perles, cotes) est un décor, caché aux lecteurs d'écran : tout ce qu'il montre est écrit à côté, en texte. Sur un conteneur étroit, le fil se lit
 * de haut en bas, une étape par ligne (metrics.css).
 */
export function JourneyPanel({
  tiles,
  health,
  cfd,
  comparison,
  signalsHref,
}: {
  tiles: MetricsTiles;
  health: MetricsHealth;
  cfd: readonly MetricsCfdPoint[];
  comparison: Comparison;
  /** La page « À regarder » de ce que la page mesure : les Prêts qui stagnent y mènent. */
  signalsHref: string;
}) {
  const titleId = useId();
  const view = useMemo(() => describeJourney({ tiles, health, cfd }), [tiles, health, cfd]);
  const moment = comparison.running ? 'en ce moment' : 'à la fin de la période';
  const [backlog, ready, work] = view.stages;
  // Les trois tronçons, en parts d'un même total : la grille les répartit, avec une largeur plancher pour que leur texte tienne (metrics.css).
  const sum = view.widths[0] + view.widths[1] + view.widths[2];
  const columns = Object.fromEntries(
    (['backlog', 'ready', 'work'] as const).map((key, index) => [`--journey-${key}`, `${(((view.widths[index] ?? 0) / sum) * 100).toFixed(2)}fr`]),
  ) as CSSProperties;

  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-5 rounded-xl border border-line bg-panel p-4 @md:p-6">
      <header>
        <SectionHeading id={titleId}>Le parcours d’un ticket</SectionHeading>
        <p className="mt-1 max-w-[70ch] text-ui text-ink-2">Ce qui entre, ce qui attend, ce qui sort. Le tube est vide quand le ticket attend, plein quand on y travaille.</p>
      </header>

      <div className="journey" style={columns}>
        <Dimension className="journey-lead" title="Lead Time" tile={tiles.leadTime} trend={tiles.leadTime.trend.median} comparison={comparison} note="de la création à la Livraison, en médiane" empty="Aucune Livraison sur la période." />
        <Dimension className="journey-cycle" title="Cycle Time" tile={tiles.cycleTime} trend={tiles.cycleTime.trend.median} comparison={comparison} note="de travail, en médiane" empty="Aucune Livraison démarrée sur la période." />

        <div aria-hidden="true" className="journey-stub journey-stub-in" />
        <div aria-hidden="true" className="journey-tube" />
        <div aria-hidden="true" className="journey-tube" />
        <div aria-hidden="true" className="journey-tube journey-tube-full">
          <i />
        </div>
        <div aria-hidden="true" className="journey-stub journey-stub-out" />

        <div className="journey-flow">
          <p data-flow="arrivals" className="journey-count">
            {formatCount(view.arrivals)}
          </p>
          <h3 className="text-[1.0625rem] font-bold text-ink">Arrivées</h3>
          <p className="text-ui text-ink-2">{view.arrivals > 1 ? 'tickets créés' : 'ticket créé'}</p>
        </div>

        <Stage stage={backlog} moment={moment} />
        <Stage stage={ready} moment={moment}>
          {view.stagnant > 0 ? (
            <>
              , dont{' '}
              <Link to={signalsHref} className="font-bold text-ink underline decoration-mark decoration-2 underline-offset-4 hover:decoration-ink">
                {formatCount(view.stagnant)} {view.stagnant > 1 ? 'stagnent' : 'stagne'}
              </Link>{' '}
              depuis plus de {formatDuration(view.stagnantAfter)}
            </>
          ) : null}
        </Stage>
        <Stage stage={work} moment={moment}>
          {view.blockedStock !== null && view.blockedStock > 0 ? `, dont ${formatCount(view.blockedStock)} en Blocage` : null}
        </Stage>

        <div className="journey-flow journey-flow-out">
          <p data-flow="deliveries" className="journey-count">
            {formatCount(view.deliveries)}
          </p>
          <h3 className="text-[1.0625rem] font-bold text-ink">Livraisons</h3>
          <Trend trend={tiles.throughput.trend} measure={MEASURES.count} comparison={comparison} label="Livraisons" />
        </div>
      </div>

      <p className="border-t border-line pt-4 text-ui text-ink-2">
        <Insight view={view} />
      </p>
    </section>
  );
}

/** Un délai coté au-dessus du fil : son nom, sa médiane en grand, ce qu'il mesure, sa tendance, puis l'accolade qui embrasse le tronçon mesuré. */
function Dimension({
  className,
  title,
  tile,
  trend,
  comparison,
  note,
  empty,
}: {
  className: string;
  /** Le nom du délai : « Lead Time », « Cycle Time ». */
  title: string;
  tile: MetricsDurationTile;
  trend: MetricsTrend;
  comparison: Comparison;
  note: string;
  empty: string;
}) {
  const defined = tile.n > 0 && tile.median !== null;
  return (
    <div className={`journey-dim ${className}`}>
      {/* Un `div`, pas un paragraphe : la tendance peut en être un (« Avant : … »), et un paragraphe n'en contient pas d'autre. */}
      <div className="journey-dim-label">
        <span className="text-[1.0625rem] font-bold text-ink">{title}</span>
        <b data-median="" className={defined ? 'journey-figure text-ink' : 'journey-figure text-ink-3'}>
          <DurationText ms={tile.median} />
        </b>
        <span className="text-ui text-ink-2">{defined ? note : empty}</span>
        {defined ? <Trend trend={trend} measure={MEASURES.duration} comparison={comparison} label={`${title}, médiane`} hasValue={false} /> : null}
      </div>
      <span aria-hidden="true" className="journey-brace" />
    </div>
  );
}

/** Un état du parcours : son nom, la part du temps qui s'y passe, et les tickets qui s'y trouvent. */
function Stage({ stage, moment, children }: { stage: JourneyStage; moment: string; children?: ReactNode }) {
  return (
    <div data-stage={stage.key} className="journey-stage">
      <h3 className="text-[1.0625rem] font-bold text-ink">{stage.label}</h3>
      {stage.share !== null ? (
        <p className="text-ui text-ink-2">
          <b data-share="" className="tnum text-[1.3125rem] font-extrabold tracking-[-0.01em] text-ink">
            {formatPercent(stage.share)}
          </b>{' '}
          du temps, {stage.doing}
        </p>
      ) : null}
      {stage.stock !== null ? (
        <p className="mt-1.5 text-ui text-ink-2">
          <b data-stock="" className="font-bold text-ink">
            {formatCount(stage.stock)}
          </b>{' '}
          {stage.stock > 1 ? 'tickets' : 'ticket'} {moment}
          {children}
        </p>
      ) : null}
    </div>
  );
}

/** Ce que le fil apprend, en une phrase : la part d'attente, où elle se passe, et sur quoi les parts sont comptées. */
function Insight({ view }: { view: JourneyView }) {
  if (view.empty || view.waitShare === null) return <>Aucune Livraison sur la période : le fil est dessiné sans proportions.</>;
  const [backlog, ready] = view.stages;
  const where = backlog.duration > ready.duration ? 'en Backlog' : 'en Prêt';
  return (
    <>
      <strong className="font-bold text-ink">
        Un ticket livré a passé {formatPercent(view.waitShare)} de sa vie à attendre
      </strong>
      , surtout {where}. Les parts sont celles du Lead Time cumulé des {plural(view.deliveries, 'Livraison')} de la période, soit <DurationText ms={view.total} />.
      {view.otherShare !== null && view.otherShare >= 0.005 ? <> Le reste, {formatPercent(view.otherShare)}, est une autre attente : ticket différé, ou revenu en Backlog après un premier démarrage.</> : null}
      {view.blockedShare !== null && view.blockedShare >= 0.005 ? <> Le Blocage compte pour {formatPercent(view.blockedShare)}, dans le tronçon En cours.</> : null}
    </>
  );
}
