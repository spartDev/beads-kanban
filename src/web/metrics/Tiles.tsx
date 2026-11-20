import { ArrowDown, ArrowUp, Hourglass, Info, Minus, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import type { MetricsDurationTile, MetricsFailureRateTile, MetricsSoundThroughputTile, MetricsTiles, MetricsTrend, MetricsWipTile } from '../../shared/api';
import { cx } from '../lib/cx';
import { useFormat, useLanguage, useT } from '../i18n';
import { Tip } from '../ui/Tip';
import { SectionHeading } from './ChartParts';
import type { Comparison } from './comparison';
import { failureRateReason } from './failureReason';
import { INDICATOR_GRID, INDICATOR_SPANS } from './indicatorGrid';
import { MetricHelp } from './MetricHelp';
import { DurationText, SpokenText } from './SpokenText';
import { describeTrend, MEASURES, type Measure, type TrendDirection, type TrendTone } from './trend';

const TREND_ICONS: Record<Exclude<TrendDirection, 'none'>, LucideIcon> = { up: ArrowUp, down: ArrowDown, flat: Minus };
const TONE_CLASSES: Record<TrendTone, string> = { good: 'text-(--good)', bad: 'text-danger', neutral: 'text-ink-2' };

const lowerFirst = (sentence: string) => sentence.charAt(0).toLowerCase() + sentence.slice(1);

/**
 * Les sept tuiles de la page : Débit, Débit sain, Lead Time, Cycle Time, Taux d'échec, Temps de rétablissement, WIP. Chacune
 * donne sa valeur, la taille de l'échantillon, et sa tendance par rapport à la période précédente. Une tuile qui ne peut rien
 * dire le dit : aucune Livraison, ou Taux d'échec et Débit sain non significatifs. Le Débit sain est toujours à côté du Débit
 * (`INDICATOR_GRID`).
 */
export function MetricTiles({ tiles, comparison }: { tiles: MetricsTiles; comparison: Comparison }) {
  const titleId = useId();
  const t = useT();
  const { formatCount } = useFormat();
  const texts = t.metrics.tiles;
  const help = t.metrics.metricHelp;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <SectionHeading id={titleId}>{texts.heading}</SectionHeading>
      <div className={INDICATOR_GRID}>
        <ThroughputTile tile={tiles.throughput} comparison={comparison} className={INDICATOR_SPANS[0]} />
        <SoundThroughputTile tile={tiles.soundThroughput} comparison={comparison} className={INDICATOR_SPANS[1]} />
        <DurationTile
          title={texts.leadTime}
          help={help.leadTime}
          tile={tiles.leadTime}
          sample={texts.deliveries(tiles.leadTime.n, formatCount(tiles.leadTime.n))}
          empty={texts.noDeliveries}
          comparison={comparison}
          className={INDICATOR_SPANS[2]}
        />
        <DurationTile
          title={texts.cycleTime}
          help={help.cycleTime}
          tile={tiles.cycleTime}
          sample={texts.deliveries(tiles.cycleTime.n, formatCount(tiles.cycleTime.n))}
          empty={texts.noStartedDeliveries}
          comparison={comparison}
          className={INDICATOR_SPANS[3]}
        />
        <FailureRateTile tile={tiles.failureRate} comparison={comparison} className={INDICATOR_SPANS[4]} />
        <DurationTile
          title={texts.recoveryTime}
          help={help.recoveryTime}
          tile={tiles.recoveryTime}
          sample={texts.criticalBugs(tiles.recoveryTime.n, formatCount(tiles.recoveryTime.n))}
          empty={texts.noCriticalBugs}
          comparison={comparison}
          className={INDICATOR_SPANS[5]}
        />
        <WipTile tile={tiles.wip} comparison={comparison} className={INDICATOR_SPANS[6]} />
      </div>
      <p className="flex items-start gap-1.5 text-micro leading-4 text-ink-3">
        <Info size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span className="min-w-0 max-w-[90ch]">{comparison.summary}</span>
      </p>
    </section>
  );
}

/** Le cadre d'une tuile : son titre, la taille de l'échantillon, son contenu. Pointillé quand la valeur est indicative. */
export function Tile({
  title,
  help,
  sample,
  indicative = false,
  className,
  children,
}: {
  title: string;
  help?: string;
  sample?: string;
  indicative?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <article
      aria-labelledby={titleId}
      data-indicative={indicative ? '' : undefined}
      className={cx('flex min-w-0 flex-col gap-2 rounded-xl border p-4', indicative ? 'border-dashed border-line-strong bg-well' : 'border-line bg-panel', className)}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="flex min-w-0 items-center gap-0.5">
          <h3 id={titleId} className="min-w-0 text-ui font-bold text-ink">
            {title}
          </h3>
          {help ? <MetricHelp title={title} help={help} /> : null}
        </span>
        {sample ? (
          <span data-sample="" className="shrink-0 text-micro text-ink-3 tnum">
            {sample}
          </span>
        ) : null}
      </header>
      {children}
    </article>
  );
}

/** Une valeur en grand, et ce qu'elle mesure en dessous. */
export function Value({ children, caption, muted = false }: { children: ReactNode; caption?: ReactNode; muted?: boolean }) {
  return (
    <div className="flex flex-col">
      <p data-value="" className={cx('text-[1.875rem] font-extrabold leading-9 tracking-[-0.02em] wrap-anywhere', muted ? 'text-ink-3' : 'text-ink')}>
        {children}
      </p>
      {caption ? <p className="text-micro text-ink-3">{caption}</p> : null}
    </div>
  );
}

/**
 * La tendance d'une valeur : une flèche, l'écart, la valeur d'avant. Verte si la valeur s'améliore, rouge si elle se
 * dégrade, neutre pour un WIP ; jamais la couleur seule (flèche, signe, phrase pour les lecteurs d'écran). Une
 * infobulle rappelle à quoi la valeur est comparée.
 */
export function Trend({ trend, measure, comparison, label, hasValue = true }: { trend: MetricsTrend; measure: Measure; comparison: Comparison; label?: string; hasValue?: boolean }) {
  const t = useT();
  const texts = t.metrics.tileFrame;
  const view = describeTrend(trend, measure);
  if (view.direction === 'none') {
    // « Avant : < 1 min » : l'écran écrit le chevron (comme la puce), les lecteurs d'écran entendent « moins d'une minute » (comme la phrase).
    if (trend.previous !== null) {
      return (
        <p className="text-micro text-ink-3 tnum">
          {texts.before}
          <SpokenText written={measure.format(trend.previous)} spoken={measure.speak(trend.previous)} />
        </p>
      );
    }
    return hasValue ? <p className="text-micro text-ink-3">{texts.noPrevious}</p> : null;
  }
  const Icon = TREND_ICONS[view.direction];
  return (
    <Tip label={comparison.tooltip} side="bottom">
      <span
        tabIndex={0}
        data-trend={view.direction}
        data-tone={view.tone}
        className={cx('inline-flex w-fit max-w-full flex-wrap items-center gap-x-1.5 rounded-sm text-micro font-semibold tnum', TONE_CLASSES[view.tone])}
      >
        <span aria-hidden="true" className="inline-flex items-center gap-0.5 font-bold">
          <Icon size={12} strokeWidth={2.25} />
          {view.direction === 'flat' ? texts.flat : view.delta}
        </span>
        <span aria-hidden="true" className="font-normal text-ink-3">
          {texts.previous(view.previous ?? '')}
        </span>
        <span className="sr-only">{label ? texts.labelled(label, lowerFirst(view.sentence)) : view.sentence}</span>
      </span>
    </Tip>
  );
}

function ThroughputTile({ tile, comparison, className }: { tile: MetricsTiles['throughput']; comparison: Comparison; className?: string }) {
  const t = useT();
  const format = useFormat();
  const { language } = useLanguage();
  return (
    <Tile title={t.metrics.tiles.throughput} help={t.metrics.metricHelp.throughput} className={className}>
      <Value caption={t.metrics.tiles.deliveriesInPeriod}>{format.formatCount(tile.total)}</Value>
      <Trend trend={tile.trend} measure={MEASURES[language].count} comparison={comparison} />
    </Tile>
  );
}

/**
 * Le Débit sain, à côté du Débit : les Livraisons saines de la période, et leur écart avec le Débit (les Livraisons revenues). Comme le Taux d'échec, il ne
 * vaut que si la Couverture des bugs est assez haute : sinon la tuile le dit, avec le motif, garde le nombre observé en retrait et n'avance pas de tendance.
 * Tant que la période court, il est provisoire : ses Livraisons n'ont pas toutes eu le temps de revenir, et la tuile le dit en toutes lettres. Sans aucune
 * Livraison, il n'y a rien qui puisse revenir : elle ne le dit pas.
 */
function SoundThroughputTile({ tile, comparison, className }: { tile: MetricsSoundThroughputTile; comparison: Comparison; className?: string }) {
  const t = useT();
  const { formatCount } = useFormat();
  const { language } = useLanguage();
  const texts = t.metrics.tiles;
  const help = t.metrics.metricHelp.soundThroughput;
  const provisional = tile.provisional && tile.deliveries > 0 ? (
    <p data-provisional="" className="flex items-start gap-1.5 text-micro leading-4 text-ink-2">
      <Hourglass size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-3" />
      {texts.provisional}
    </p>
  ) : null;

  if (!tile.significant) {
    // Le motif est écrit dans la langue de l'interface à partir des codes de l'API, comme celui du Taux d'échec : c'est le même.
    const reason = failureRateReason(tile, language);
    return (
      <Tile title={texts.soundThroughput} help={help} indicative className={className}>
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1.5 text-base font-bold leading-9 text-ink-2">
            <TriangleAlert size={15} aria-hidden="true" className="shrink-0 text-ink-3" />
            {texts.notSignificant}
          </p>
          {reason ? <p className="text-micro leading-4 text-ink-2">{reason}</p> : null}
          <p data-gap="" className="text-micro text-ink-3 tnum">
            {tile.deliveries === 0 ? texts.noDeliveries : texts.observedSound(formatCount(tile.total), tile.deliveries, formatCount(tile.deliveries))}
          </p>
        </div>
        {provisional}
      </Tile>
    );
  }

  const gap = tile.deliveries - tile.total;
  return (
    <Tile title={texts.soundThroughput} help={help} className={className}>
      <Value caption={texts.soundDeliveriesInPeriod}>{formatCount(tile.total)}</Value>
      <Trend trend={tile.trend} measure={MEASURES[language].count} comparison={comparison} />
      <div className="flex flex-col gap-1 border-t border-line pt-2">
        <p data-gap="" className="text-micro text-ink-3 tnum">
          {tile.deliveries === 0 ? texts.noDeliveries : gap === 0 ? texts.allSound : texts.belowThroughput(gap, formatCount(gap), formatCount(tile.deliveries))}
        </p>
        {provisional}
      </div>
    </Tile>
  );
}

/**
 * Lead Time, Cycle Time, Temps de rétablissement : la médiane en grand, le P85 dessous, chacun avec sa tendance. Quand la
 * période précédente n'a rien à comparer, une seule phrase le dit pour les deux.
 */
function DurationTile({
  title,
  help,
  tile,
  sample,
  empty,
  comparison,
  className,
}: {
  title: string;
  help?: string;
  tile: MetricsDurationTile;
  sample: string;
  empty: string;
  comparison: Comparison;
  className?: string;
}) {
  const defined = tile.n > 0 && tile.median !== null;
  const nothingBefore = tile.trend.median.previous === null && tile.trend.p85.previous === null;
  const t = useT();
  const texts = t.metrics.tiles;
  const measure = MEASURES[useLanguage().language].duration;
  return (
    <Tile title={title} help={help} sample={sample} className={className}>
      <div className="flex flex-col gap-1">
        <Value muted={!defined} caption={defined ? texts.median : empty}>
          <DurationText ms={tile.median} />
        </Value>
        <Trend trend={tile.trend.median} measure={measure} comparison={comparison} label={texts.medianLabel} hasValue={defined && !nothingBefore} />
      </div>
      {defined ? (
        <div className="flex flex-col gap-1 border-t border-line pt-2">
          <p className="flex items-baseline gap-1.5">
            <span className="text-micro text-ink-3">{texts.p85}</span>
            <span data-p85="" className="tnum text-base font-bold leading-6 text-ink">
              <DurationText ms={tile.p85} />
            </span>
          </p>
          <Trend trend={tile.trend.p85} measure={measure} comparison={comparison} label={texts.p85} hasValue={!nothingBefore} />
          {nothingBefore ? <p className="text-micro text-ink-3">{t.metrics.tileFrame.noPrevious}</p> : null}
        </div>
      ) : null}
    </Tile>
  );
}

/**
 * Le Taux d'échec ne vaut que si la Couverture des bugs est assez haute : sinon la tuile le dit, avec la raison de l'API,
 * et n'avance pas de tendance entre deux nombres sans valeur. Le taux observé reste lisible, en retrait, pour qui
 * veut le recouper.
 */
function FailureRateTile({ tile, comparison, className }: { tile: MetricsFailureRateTile; comparison: Comparison; className?: string }) {
  const t = useT();
  const { formatCount, formatPercent } = useFormat();
  const { language } = useLanguage();
  const texts = t.metrics.tiles;
  const [failed, deliveries] = [formatCount(tile.failed), formatCount(tile.deliveries)];
  const sample = texts.deliveries(tile.deliveries, deliveries);
  const observed = tile.rate === null ? null : texts.observed(formatPercent(tile.rate, { precise: true }), failed, deliveries);

  if (!tile.significant) {
    // Le motif est écrit dans la langue de l'interface à partir des codes de l'API : celui du serveur (`tile.reason`) est en français.
    const reason = failureRateReason(tile, language);
    return (
      <Tile title={texts.failureRate} help={t.metrics.metricHelp.failureRate} sample={sample} indicative className={className}>
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1.5 text-base font-bold leading-9 text-ink-2">
            <TriangleAlert size={15} aria-hidden="true" className="shrink-0 text-ink-3" />
            {texts.notSignificant}
          </p>
          {reason ? <p className="text-micro leading-4 text-ink-2">{reason}</p> : null}
          {observed ? <p className="text-micro text-ink-3 tnum">{observed}</p> : null}
        </div>
      </Tile>
    );
  }

  const defined = tile.rate !== null;
  return (
    <Tile title={texts.failureRate} help={t.metrics.metricHelp.failureRate} sample={sample} className={className}>
      <Value muted={!defined} caption={defined ? texts.failedOf(failed, deliveries) : texts.noDeliveries}>
        {formatPercent(tile.rate, { precise: true })}
      </Value>
      <Trend trend={tile.trend} measure={MEASURES[language].rate} comparison={comparison} hasValue={defined} />
      <p className="text-micro text-ink-3 tnum">{texts.coverage(formatPercent(tile.coverage.ratio))}</p>
    </Tile>
  );
}

function WipTile({ tile, comparison, className }: { tile: MetricsWipTile; comparison: Comparison; className?: string }) {
  const t = useT();
  const { formatCount, formatDecimal } = useFormat();
  const { language } = useLanguage();
  const texts = t.metrics.tiles;
  return (
    <Tile title={texts.wip} help={t.metrics.metricHelp.wip} className={className}>
      <Value caption={comparison.running ? texts.wipAt(comparison.asOfTime) : texts.wipAtEnd}>{formatCount(tile.current)}</Value>
      <div className="flex flex-col gap-1 border-t border-line pt-2">
        <p className="flex items-baseline gap-1.5">
          <span className="text-micro text-ink-3">{texts.average}</span>
          <span data-average="" className="tnum text-base font-bold leading-6 text-ink">
            {formatDecimal(tile.average, 1)}
          </span>
        </p>
        <Trend trend={tile.trend} measure={MEASURES[language].average} comparison={comparison} label={texts.averageLabel} />
      </div>
    </Tile>
  );
}
