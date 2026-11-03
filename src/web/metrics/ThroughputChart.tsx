import { AxisBottom, AxisLeft } from '@visx/axis';
import { GridRows } from '@visx/grid';
import { Group } from '@visx/group';
import { scaleBand, scaleLinear } from '@visx/scale';
import { useId, useMemo } from 'react';
import type { MetricsBucket, MetricsBucketUnit } from '../../shared/api';
import { normalizeBuckets, totalDeliveries, type BucketView } from './buckets';
import { ChartCard, ChartFrame, ChartTooltip, DataTable, Legend, pointerIn, useActive } from './ChartParts';
import { EmptyChart } from './CfdChart';
import { AXIS_TEXT } from './axes';
import { formatCount, formatDecimal } from './format';
import { outlineOf } from './palette';
import { bandIndexAt, integerTicks, thinLabels } from './scales';

const MARGIN = { top: 16, right: 8, bottom: 24, left: 30 };
const FILL = 'var(--flow-done)';

const deliveriesText = (count: number) => (count === 0 ? 'Aucune Livraison' : `${formatCount(count)} ${count > 1 ? 'Livraisons' : 'Livraison'}`);

/**
 * L'histogramme du Débit, à la largeur donnée : une barre par jour (période de 31 jours au plus) ou par semaine. Les
 * barres montrent les Livraisons brutes, dont la somme est celle de la tuile ; une tranche incomplète (semaine tronquée
 * aux bords de la période, jour ou semaine en cours) est hachurée, car la lire comme une tranche pleine ferait croire à
 * un recul.
 */
export function ThroughputPlot({ views, width, height }: { views: readonly BucketView[]; width: number; height: number }) {
  const { active, frame, show, leave } = useActive<number>();
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
      <svg width={width} height={height} role="img" aria-label={`Débit : ${deliveriesText(totalDeliveries(views))} sur ${views.length} ${views.length > 1 ? 'tranches' : 'tranche'}.`} className="block overflow-visible">
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
                    {bucket.deliveries}
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
            tickFormat={(value) => formatCount(Number(value))}
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
          <p className="tnum">{deliveriesText(view.deliveries)}</p>
          {view.days > 1 ? <p className="tnum text-ink-2">{formatDecimal(view.perDay, 1)} par jour sur {view.days} jours</p> : null}
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
  const views = useMemo(() => normalizeBuckets(buckets, { unit, running, asOfTime }), [buckets, unit, running, asOfTime]);
  const total = totalDeliveries(views);
  // La légende ne parle d'une tranche incomplète que si une barre hachurée est dessinée.
  const anyPartial = views.some((view) => view.partial && view.deliveries > 0);

  return (
    <ChartCard
      title="Débit"
      description={`${deliveriesText(total)} sur la période, comptées par ${unit === 'day' ? 'jour' : 'semaine (du lundi au dimanche)'}.`}
      legend={
        <Legend
          label="Légende du Débit"
          items={[
            { key: 'full', label: 'Livraisons', color: FILL },
            ...(anyPartial ? [{ key: 'partial', label: unit === 'day' ? 'Jour en cours' : 'Semaine incomplète ou en cours', color: FILL, hatched: true }] : []),
          ]}
        />
      }
      data={<ThroughputTable views={views} />}
    >
      {total === 0 ? (
        <EmptyChart>Aucune Livraison sur cette période.</EmptyChart>
      ) : (
        <ChartFrame height={260}>{({ width, height }) => <ThroughputPlot views={views} width={width} height={height} />}</ChartFrame>
      )}
    </ChartCard>
  );
}

function ThroughputTable({ views }: { views: readonly BucketView[] }) {
  return (
    <DataTable
      caption="Livraisons de chaque tranche de la période"
      head={
        <tr>
          <th scope="col" className="px-3 py-1.5 font-medium">
            Tranche
          </th>
          <th scope="col" className="px-3 py-1.5 text-right font-medium">
            Jours
          </th>
          <th scope="col" className="px-3 py-1.5 text-right font-medium">
            Livraisons
          </th>
          <th scope="col" className="px-3 py-1.5 text-right font-medium">
            Par jour
          </th>
          <th scope="col" className="px-3 py-1.5 font-medium">
            Remarque
          </th>
        </tr>
      }
    >
      {views.map((view) => (
        <tr key={view.from}>
          <th scope="row" className="whitespace-nowrap px-3 py-1 text-left font-normal text-ink-2">
            {view.title}
          </th>
          <td className="px-3 py-1 text-right">{view.days}</td>
          <td className="px-3 py-1 text-right font-medium">{formatCount(view.deliveries)}</td>
          <td className="px-3 py-1 text-right">{formatDecimal(view.perDay, 1)}</td>
          <td className="px-3 py-1 text-ink-2">{view.note ?? ''}</td>
        </tr>
      ))}
    </DataTable>
  );
}
