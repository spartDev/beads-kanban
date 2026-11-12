import { ArrowDown, ArrowUp, Info, Minus, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import type { MetricsDurationTile, MetricsFailureRateTile, MetricsTiles, MetricsTrend, MetricsWipTile } from '../../shared/api';
import { cx } from '../lib/cx';
import { Tip } from '../ui/Tip';
import { SectionHeading } from './ChartParts';
import type { Comparison } from './comparison';
import { METRIC_HELP } from './metricHelp';
import { formatCount, formatDecimal, formatPercent, tidy } from './format';
import { DurationText, SpokenText } from './SpokenText';
import { describeTrend, MEASURES, type Measure, type TrendDirection, type TrendTone } from './trend';

const TREND_ICONS: Record<Exclude<TrendDirection, 'none'>, LucideIcon> = { up: ArrowUp, down: ArrowDown, flat: Minus };
const TONE_CLASSES: Record<TrendTone, string> = { good: 'text-(--good)', bad: 'text-danger', neutral: 'text-ink-2' };

const lowerFirst = (sentence: string) => sentence.charAt(0).toLowerCase() + sentence.slice(1);

export const plural = (count: number, singular: string, many = `${singular}s`) => `${formatCount(count)} ${count > 1 ? many : singular}`;

/**
 * Les six tuiles de la page : Débit, Lead Time, Cycle Time, Taux d'échec, Temps de rétablissement, WIP. Chacune donne
 * sa valeur, la taille de l'échantillon, et sa tendance par rapport à la période précédente. Une tuile qui ne peut rien
 * dire le dit : aucune Livraison, ou Taux d'échec non significatif.
 */
export function MetricTiles({ tiles, comparison }: { tiles: MetricsTiles; comparison: Comparison }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <SectionHeading id={titleId}>Indicateurs</SectionHeading>
      <div className="grid grid-cols-2 gap-3 @min-[36rem]:grid-cols-3 @min-[68rem]:grid-cols-6">
        <ThroughputTile tile={tiles.throughput} comparison={comparison} />
        <DurationTile
          title="Lead Time"
          help={METRIC_HELP.leadTime}
          tile={tiles.leadTime}
          sample={plural(tiles.leadTime.n, 'Livraison')}
          empty="Aucune Livraison sur la période."
          comparison={comparison}
        />
        <DurationTile
          title="Cycle Time"
          help={METRIC_HELP.cycleTime}
          tile={tiles.cycleTime}
          sample={plural(tiles.cycleTime.n, 'Livraison')}
          empty="Aucune Livraison démarrée sur la période."
          comparison={comparison}
        />
        <FailureRateTile tile={tiles.failureRate} comparison={comparison} />
        <DurationTile
          title="Temps de rétablissement"
          help={METRIC_HELP.recoveryTime}
          tile={tiles.recoveryTime}
          sample={plural(tiles.recoveryTime.n, 'bug critique', 'bugs critiques')}
          empty="Aucun bug critique (P0 ou P1) livré sur la période."
          comparison={comparison}
        />
        <WipTile tile={tiles.wip} comparison={comparison} />
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
      className={cx('flex min-w-0 flex-col gap-2 rounded-lg border p-3', indicative ? 'border-dashed border-line-strong bg-well' : 'border-line bg-panel', className)}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="flex min-w-0 items-center gap-0.5">
          <h3 id={titleId} className="min-w-0 text-ui font-medium text-ink-2">
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

/** L'icône info d'une tuile : au survol ou au focus clavier, une infobulle dit ce que mesure la tuile et à quoi elle sert. */
function MetricHelp({ title, help }: { title: string; help: string }) {
  return (
    <Tip label={help} side="bottom">
      <button
        type="button"
        aria-label={`À propos de ${title}`}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-3 hover:text-ink-2"
      >
        <Info size={13} aria-hidden="true" />
      </button>
    </Tip>
  );
}

/** Une valeur en grand, et ce qu'elle mesure en dessous. */
export function Value({ children, caption, muted = false }: { children: ReactNode; caption?: ReactNode; muted?: boolean }) {
  return (
    <div className="flex flex-col">
      <p data-value="" className={cx('tnum text-[26px] font-semibold leading-8 tracking-[-0.02em] wrap-anywhere', muted ? 'text-ink-3' : 'text-ink')}>
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
  const view = describeTrend(trend, measure);
  if (view.direction === 'none') {
    // « Avant : < 1 min » : l'écran écrit le chevron (comme la puce), les lecteurs d'écran entendent « moins d'une minute » (comme la phrase).
    if (trend.previous !== null) {
      return (
        <p className="text-micro text-ink-3 tnum">
          Avant : <SpokenText written={measure.format(trend.previous)} spoken={measure.speak(trend.previous)} />
        </p>
      );
    }
    return hasValue ? <p className="text-micro text-ink-3">Pas de période précédente à comparer.</p> : null;
  }
  const Icon = TREND_ICONS[view.direction];
  return (
    <Tip label={comparison.tooltip} side="bottom">
      <span
        tabIndex={0}
        data-trend={view.direction}
        data-tone={view.tone}
        className={cx('inline-flex w-fit max-w-full flex-wrap items-center gap-x-1.5 rounded-sm text-micro tnum', TONE_CLASSES[view.tone])}
      >
        <span aria-hidden="true" className="inline-flex items-center gap-0.5 font-medium">
          <Icon size={12} strokeWidth={2.25} />
          {view.direction === 'flat' ? 'stable' : view.delta}
        </span>
        <span aria-hidden="true" className="text-ink-3">
          avant {view.previous}
        </span>
        <span className="sr-only">{label ? `${label} : ${lowerFirst(view.sentence)}` : view.sentence}</span>
      </span>
    </Tip>
  );
}

function ThroughputTile({ tile, comparison }: { tile: MetricsTiles['throughput']; comparison: Comparison }) {
  return (
    <Tile title="Débit" help={METRIC_HELP.throughput}>
      <Value caption="Livraisons sur la période">{formatCount(tile.total)}</Value>
      <Trend trend={tile.trend} measure={MEASURES.count} comparison={comparison} />
    </Tile>
  );
}

/**
 * Lead Time, Cycle Time, Temps de rétablissement : la médiane en grand, le P85 dessous, chacun avec sa tendance. Quand la
 * période précédente n'a rien à comparer, une seule phrase le dit pour les deux.
 */
function DurationTile({ title, help, tile, sample, empty, comparison }: { title: string; help?: string; tile: MetricsDurationTile; sample: string; empty: string; comparison: Comparison }) {
  const defined = tile.n > 0 && tile.median !== null;
  const nothingBefore = tile.trend.median.previous === null && tile.trend.p85.previous === null;
  return (
    <Tile title={title} help={help} sample={sample}>
      <div className="flex flex-col gap-1">
        <Value muted={!defined} caption={defined ? 'médiane' : empty}>
          <DurationText ms={tile.median} />
        </Value>
        <Trend trend={tile.trend.median} measure={MEASURES.duration} comparison={comparison} label="Médiane" hasValue={defined && !nothingBefore} />
      </div>
      {defined ? (
        <div className="flex flex-col gap-1 border-t border-line pt-2">
          <p className="flex items-baseline gap-1.5">
            <span className="text-micro text-ink-3">P85</span>
            <span data-p85="" className="tnum text-[15px] font-semibold leading-5 text-ink">
              <DurationText ms={tile.p85} />
            </span>
          </p>
          <Trend trend={tile.trend.p85} measure={MEASURES.duration} comparison={comparison} label="P85" hasValue={!nothingBefore} />
          {nothingBefore ? <p className="text-micro text-ink-3">Pas de période précédente à comparer.</p> : null}
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
function FailureRateTile({ tile, comparison }: { tile: MetricsFailureRateTile; comparison: Comparison }) {
  const sample = plural(tile.deliveries, 'Livraison');
  const observed = tile.rate === null ? null : `Observé : ${formatPercent(tile.rate, { precise: true })} (${tile.failed} sur ${tile.deliveries})`;

  if (!tile.significant) {
    return (
      <Tile title="Taux d’échec" help={METRIC_HELP.failureRate} sample={sample} indicative>
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-1.5 text-[15px] font-semibold leading-8 text-ink-2">
            <TriangleAlert size={15} aria-hidden="true" className="shrink-0 text-ink-3" />
            Non significatif
          </p>
          {tile.reason ? <p className="text-micro leading-4 text-ink-2">{tidy(tile.reason)}</p> : null}
          {observed ? <p className="text-micro text-ink-3 tnum">{observed}</p> : null}
        </div>
      </Tile>
    );
  }

  const defined = tile.rate !== null;
  return (
    <Tile title="Taux d’échec" help={METRIC_HELP.failureRate} sample={sample}>
      <Value muted={!defined} caption={defined ? `${tile.failed} sur ${tile.deliveries} en échec` : 'Aucune Livraison sur la période.'}>
        {formatPercent(tile.rate, { precise: true })}
      </Value>
      <Trend trend={tile.trend} measure={MEASURES.rate} comparison={comparison} hasValue={defined} />
      <p className="text-micro text-ink-3 tnum">Couverture {formatPercent(tile.coverage.ratio)}</p>
    </Tile>
  );
}

function WipTile({ tile, comparison }: { tile: MetricsWipTile; comparison: Comparison }) {
  return (
    <Tile title="WIP" help={METRIC_HELP.wip}>
      <Value caption={comparison.running ? `en cours à ${comparison.asOfTime}` : 'en cours à la fin de la période'}>{formatCount(tile.current)}</Value>
      <div className="flex flex-col gap-1 border-t border-line pt-2">
        <p className="flex items-baseline gap-1.5">
          <span className="text-micro text-ink-3">moyenne</span>
          <span data-average="" className="tnum text-[15px] font-semibold leading-5 text-ink">
            {formatDecimal(tile.average, 1)}
          </span>
        </p>
        <Trend trend={tile.trend} measure={MEASURES.average} comparison={comparison} label="Moyenne" />
      </div>
    </Tile>
  );
}
