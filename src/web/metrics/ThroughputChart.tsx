import { AxisBottom, AxisLeft } from '@visx/axis';
import { GridRows } from '@visx/grid';
import { Group } from '@visx/group';
import { scaleBand, scaleLinear } from '@visx/scale';
import { useId, useMemo } from 'react';
import type { MetricsBucket, MetricsBucketUnit } from '../../shared/api';
import { useFormat, useLanguage, useT, type DisplayFormat, type Messages } from '../i18n';
import { normalizeBuckets, totalDeliveries, type BucketView } from './buckets';
import { ChartCard, ChartFrame, ChartTooltip, DataTable, Legend, pointerIn, useActive } from './ChartParts';
import { EmptyChart } from './CfdChart';
import { AXIS_TEXT } from './axes';
import { outlineOf } from './palette';
import { bandIndexAt, integerTicks, thinLabels } from './scales';

const MARGIN = { top: 16, right: 8, bottom: 24, left: 30 };
const FILL = 'var(--flow-done)';

/** « 3 Livraisons », « Aucune Livraison ». */
const deliveriesText = (count: number, t: Messages, format: DisplayFormat) =>
  count === 0 ? t.metrics.throughputChart.none : t.metrics.chartParts.deliveries(format.formatCount(count), count);

/**
 * L'histogramme du Débit, à la largeur donnée : une barre par jour (période de 31 jours au plus) ou par semaine. Les
 * barres montrent les Livraisons brutes, dont la somme est celle de la tuile ; une tranche incomplète (semaine tronquée
 * aux bords de la période, jour ou semaine en cours) est hachurée, car la lire comme une tranche pleine ferait croire à
 * un recul.
 */
export function ThroughputPlot({ views, width, height }: { views: readonly BucketView[]; width: number; height: number }) {
  const { active, frame, show, leave } = useActive<number>();
  const t = useT();
  const format = useFormat();
  const hatch = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);

  const x = scaleBand<number>({ domain: views.map((_, index) => index), range: [0, innerWidth], padding: views.length > 24 ? 0.15 : 0.25 });
  const yTicks = integerTicks(Math.max(0, ...views.map((view) => view.deliveries)), Math.max(2, Math.floor(innerHeight / 34)));
  const y = scaleLinear({ domain: [0, yTicks.at(-1) ?? 1], range: [innerHeight, 0] });
  const labelled = thinLabels(views.length, Math.max(2, Math.floor(innerWidth / 52)));
  const showValues = x.bandwidth() >= 16;

  const view = active ? views[active.value] : undefined;

  return (
    <div ref={frame} className="relative">
      <svg width={width} height={height} role="img" aria-label={t.metrics.throughputChart.ariaLabel(
          deliveriesText(totalDeliveries(views), t, format),
          t.metrics.chartParts.buckets(format.formatCount(views.length), views.length),
        )} className="block overflow-visible">
        <defs>
          <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill={FILL} fillOpacity="0.35" />
            <line x1="0" y1="0" x2="0" y2="5" stroke={outlineOf(FILL)} strokeWidth="2" />
          </pattern>
        </defs>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={y} width={innerWidth} tickValues={yTicks} stroke="var(--line)" />
          {active && view ? <rect x={x(active.value) ?? 0} y={0} width={x.bandwidth()} height={innerHeight} fill="var(--hover)" pointerEvents="none" /> : null}
          {views.map((bucket, index) => {
            const left = x(index) ?? 0;
            const top = y(bucket.deliveries);
            return (
              <g key={bucket.from}>
                {bucket.deliveries > 0 ? (
                  <rect
                    data-bar=""
                    data-partial={bucket.partial ? '' : undefined}
                    x={left}
                    y={top}
                    width={x.bandwidth()}
                    height={innerHeight - top}
                    rx={2}
                    fill={bucket.partial ? `url(#${hatch})` : FILL}
                    stroke={outlineOf(FILL)}
                    strokeWidth={1.25}
                    strokeDasharray={bucket.partial ? '3 2' : undefined}
                  />
                ) : null}
                {showValues && bucket.deliveries > 0 ? (
                  <text x={left + x.bandwidth() / 2} y={top - 4} textAnchor="middle" {...AXIS_TEXT} fill="var(--ink-2)">
                    {format.formatCount(bucket.deliveries)}
                  </text>
                ) : null}
              </g>
            );
          })}
          <AxisLeft
            scale={y}
            tickValues={yTicks}
            hideAxisLine
            hideTicks
            tickFormat={(value) => format.formatCount(Number(value))}
            tickLabelProps={() => ({ ...AXIS_TEXT, textAnchor: 'end', dx: '-0.5em', dy: '0.33em' })}
          />
          <AxisBottom
            top={innerHeight}
            scale={x}
            tickValues={labelled}
            hideTicks
            stroke="var(--line-strong)"
            tickFormat={(index) => views[index]?.label ?? ''}
            tickLabelProps={() => ({ ...AXIS_TEXT, textAnchor: 'middle', dy: '0.5em' })}
          />
          <rect
            data-chart-hit=""
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            style={{ touchAction: 'pan-y' }}
            onPointerMove={(event) => {
              const at = pointerIn(event, event.currentTarget);
              show({ value: bandIndexAt(at.x, innerWidth, views.length), x: at.x + MARGIN.left, y: at.y + MARGIN.top });
            }}
            onPointerDown={(event) => {
              const at = pointerIn(event, event.currentTarget);
              show({ value: bandIndexAt(at.x, innerWidth, views.length), x: at.x + MARGIN.left, y: at.y + MARGIN.top });
            }}
            onPointerLeave={leave}
          />
        </Group>
      </svg>
      {active && view ? (
        <ChartTooltip pointer={active} bounds={{ width, height }}>
          <p className="font-medium">{view.title}</p>
          <p className="tnum">{deliveriesText(view.deliveries, t, format)}</p>
          {view.days > 1 ? (
            <p className="tnum text-ink-2">{t.metrics.throughputChart.perDay(format.formatDecimal(view.perDay, 1), format.formatCount(view.days))}</p>
          ) : null}
          {view.note ? <p className="text-ink-2">{view.note}</p> : null}
        </ChartTooltip>
      ) : null}
    </div>
  );
}

/** La carte « Débit » : l'histogramme, sa légende, et les valeurs en tableau. */
export function ThroughputPanel({
  buckets,
  unit,
  running,
  asOfTime,
}: {
  buckets: readonly MetricsBucket[];
  unit: MetricsBucketUnit;
  /** La période court encore : la dernière tranche n'est comptée que jusqu'à maintenant. */
  running: boolean;
  asOfTime: string;
}) {
  const t = useT();
  const format = useFormat();
  const { language } = useLanguage();
  const text = t.metrics.throughputChart;
  const views = useMemo(() => normalizeBuckets(buckets, { unit, running, asOfTime }, language), [buckets, unit, running, asOfTime, language]);
  const total = totalDeliveries(views);
  // La légende ne parle d'une tranche incomplète que si une barre hachurée est dessinée.
  const anyPartial = views.some((view) => view.partial && view.deliveries > 0);

  return (
    <ChartCard
      title={text.title}
      description={text.description(deliveriesText(total, t, format), t.metrics.chartParts.unit[unit])}
      legend={
        <Legend
          label={text.legend}
          items={[
            { key: 'full', label: text.full, color: FILL },
            ...(anyPartial ? [{ key: 'partial', label: unit === 'day' ? text.partialDay : text.partialWeek, color: FILL, hatched: true }] : []),
          ]}
        />
      }
      data={<ThroughputTable views={views} />}
    >
      {total === 0 ? (
        <EmptyChart>{text.empty}</EmptyChart>
      ) : (
        <ChartFrame height={260}>{({ width, height }) => <ThroughputPlot views={views} width={width} height={height} />}</ChartFrame>
      )}
    </ChartCard>
  );
}

function ThroughputTable({ views }: { views: readonly BucketView[] }) {
  const t = useT();
  const format = useFormat();
  const text = t.metrics.throughputChart;
  const columns = t.metrics.chartParts;
  return (
    <DataTable
      caption={text.caption}
      head={
        <tr>
          <th scope="col" className="px-3 py-1.5 font-medium">
            {columns.bucketColumn}
          </th>
          <th scope="col" className="px-3 py-1.5 text-right font-medium">
            {text.daysColumn}
          </th>
          <th scope="col" className="px-3 py-1.5 text-right font-medium">
            {columns.deliveriesColumn}
          </th>
          <th scope="col" className="px-3 py-1.5 text-right font-medium">
            {text.perDayColumn}
          </th>
          <th scope="col" className="px-3 py-1.5 font-medium">
            {columns.noteColumn}
          </th>
        </tr>
      }
    >
      {views.map((view) => (
        <tr key={view.from}>
          <th scope="row" className="whitespace-nowrap px-3 py-1 text-left font-normal text-ink-2">
            {view.title}
          </th>
          <td className="px-3 py-1 text-right">{format.formatCount(view.days)}</td>
          <td className="px-3 py-1 text-right font-medium">{format.formatCount(view.deliveries)}</td>
          <td className="px-3 py-1 text-right">{format.formatDecimal(view.perDay, 1)}</td>
          <td className="px-3 py-1 text-ink-2">{view.note ?? ''}</td>
        </tr>
      ))}
    </DataTable>
  );
}
