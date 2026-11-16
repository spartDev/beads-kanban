import { useId, useMemo, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { MetricsCfdPoint, MetricsDurationTile, MetricsHealth, MetricsTiles, MetricsTrend } from '../../shared/api';
import { useFormat, useLanguage, useT } from '../i18n';
import { SectionHeading } from './ChartParts';
import type { Comparison } from './comparison';
import { describeJourney, type JourneyStage, type JourneyView } from './journey';
import { DurationText } from './SpokenText';
import { Trend } from './Tiles';
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
  const t = useT();
  const { formatCount, formatDuration } = useFormat();
  const { language } = useLanguage();
  const texts = t.metrics.journeyPanel;
  const view = useMemo(() => describeJourney({ tiles, health, cfd }, language), [tiles, health, cfd, language]);
  const moment = comparison.running ? texts.now : texts.atEnd;
  const [backlog, ready, work] = view.stages;
  // Les trois tronçons, en parts d'un même total : la grille les répartit, avec une largeur plancher pour que leur texte tienne (metrics.css).
  const sum = view.widths[0] + view.widths[1] + view.widths[2];
  const columns = Object.fromEntries(
    (['backlog', 'ready', 'work'] as const).map((key, index) => [`--journey-${key}`, `${(((view.widths[index] ?? 0) / sum) * 100).toFixed(2)}fr`]),
  ) as CSSProperties;

  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-5 rounded-xl border border-line bg-panel p-4 @md:p-6">
      <header>
        <SectionHeading id={titleId}>{texts.heading}</SectionHeading>
        <p className="mt-1 max-w-[70ch] text-ui text-ink-2">{texts.intro}</p>
      </header>

      <div className="journey" style={columns}>
        <Dimension
          className="journey-lead"
          title={t.metrics.tiles.leadTime}
          tile={tiles.leadTime}
          trend={tiles.leadTime.trend.median}
          comparison={comparison}
          note={texts.leadTimeNote}
          empty={t.metrics.tiles.noDeliveries}
        />
        <Dimension
          className="journey-cycle"
          title={t.metrics.tiles.cycleTime}
          tile={tiles.cycleTime}
          trend={tiles.cycleTime.trend.median}
          comparison={comparison}
          note={texts.cycleTimeNote}
          empty={t.metrics.tiles.noStartedDeliveries}
        />

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
          <h3 className="text-[1.0625rem] font-bold text-ink">{texts.arrivals}</h3>
          <p className="text-ui text-ink-2">{texts.created(view.arrivals)}</p>
        </div>

        <Stage stage={backlog} moment={moment} />
        <Stage stage={ready} moment={moment}>
          {view.stagnant > 0 ? (
            <>
              {texts.ofWhich}{' '}
              <Link to={signalsHref} className="font-bold text-ink underline decoration-mark decoration-2 underline-offset-4 hover:decoration-ink">
                {texts.stagnant(view.stagnant, formatCount(view.stagnant))}
              </Link>{' '}
              {texts.staleFor(formatDuration(view.stagnantAfter))}
            </>
          ) : null}
        </Stage>
        <Stage stage={work} moment={moment}>
          {view.blockedStock !== null && view.blockedStock > 0 ? texts.blockedAmong(view.blockedStock, formatCount(view.blockedStock)) : null}
        </Stage>

        <div className="journey-flow journey-flow-out">
          <p data-flow="deliveries" className="journey-count">
            {formatCount(view.deliveries)}
          </p>
          <h3 className="text-[1.0625rem] font-bold text-ink">{texts.deliveries}</h3>
          <Trend trend={tiles.throughput.trend} measure={MEASURES[language].count} comparison={comparison} label={texts.deliveries} />
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
  const t = useT();
  const { language } = useLanguage();
  return (
    <div className={`journey-dim ${className}`}>
      {/* Un `div`, pas un paragraphe : la tendance peut en être un (« Avant : … »), et un paragraphe n'en contient pas d'autre. */}
      <div className="journey-dim-label">
        <span className="text-[1.0625rem] font-bold text-ink">{title}</span>
        <b data-median="" className={defined ? 'journey-figure text-ink' : 'journey-figure text-ink-3'}>
          <DurationText ms={tile.median} />
        </b>
        <span className="text-ui text-ink-2">{defined ? note : empty}</span>
        {defined ? <Trend trend={trend} measure={MEASURES[language].duration} comparison={comparison} label={t.metrics.journeyPanel.medianOf(title)} hasValue={false} /> : null}
      </div>
      <span aria-hidden="true" className="journey-brace" />
    </div>
  );
}

/** Un état du parcours : son nom, la part du temps qui s'y passe, et les tickets qui s'y trouvent. */
function Stage({ stage, moment, children }: { stage: JourneyStage; moment: string; children?: ReactNode }) {
  const t = useT();
  const { formatCount, formatPercent } = useFormat();
  const texts = t.metrics.journeyPanel;
  return (
    <div data-stage={stage.key} className="journey-stage">
      <h3 className="text-[1.0625rem] font-bold text-ink">{stage.label}</h3>
      {stage.share !== null ? (
        <p className="text-ui text-ink-2">
          <b data-share="" className="tnum text-[1.3125rem] font-extrabold tracking-[-0.01em] text-ink">
            {formatPercent(stage.share)}
          </b>{' '}
          {texts.shareOfTime(stage.doing)}
        </p>
      ) : null}
      {stage.stock !== null ? (
        <p className="mt-1.5 text-ui text-ink-2">
          <b data-stock="" className="font-bold text-ink">
            {formatCount(stage.stock)}
          </b>{' '}
          {texts.tickets(stage.stock, moment)}
          {children}
        </p>
      ) : null}
    </div>
  );
}

/** Ce que le fil apprend, en une phrase : la part d'attente, où elle se passe, et sur quoi les parts sont comptées. */
function Insight({ view }: { view: JourneyView }) {
  const t = useT();
  const { formatCount, formatPercent } = useFormat();
  const texts = t.metrics.journeyPanel;
  if (view.empty || view.waitShare === null) return <>{texts.empty}</>;
  const [backlog, ready] = view.stages;
  const where = backlog.duration > ready.duration ? texts.inBacklog : texts.inReady;
  return (
    <>
      <strong className="font-bold text-ink">{texts.waiting(formatPercent(view.waitShare))}</strong>
      {texts.where(where, t.metrics.tiles.deliveries(view.deliveries, formatCount(view.deliveries)))}
      <DurationText ms={view.total} />
      {texts.end}
      {view.otherShare !== null && view.otherShare >= 0.005 ? texts.otherWait(formatPercent(view.otherShare)) : null}
      {view.blockedShare !== null && view.blockedShare >= 0.005 ? texts.blockedShare(formatPercent(view.blockedShare)) : null}
    </>
  );
}
