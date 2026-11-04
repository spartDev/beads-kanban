import { AxisBottom, AxisLeft } from '@visx/axis';
import { GridRows } from '@visx/grid';
import { Group } from '@visx/group';
import { scaleLinear } from '@visx/scale';
import { LinePath } from '@visx/shape';
import { useMemo, type PointerEvent } from 'react';
import type { MetricsBucket, MetricsBucketUnit } from '../../shared/api';
import { type BalanceRow, describeBalance } from './balance';
import { ChartCard, ChartFrame, ChartTooltip, DataTable, pointerIn, useActive } from './ChartParts';
import { EmptyChart } from './CfdChart';
import { AXIS_TEXT } from './axes';
import { formatCount, formatSigned } from './format';
import { outlineOf } from './palette';
import { bandIndexAt, integerTicks, thinLabels } from './scales';
import { plural } from './Tiles';

const MARGIN = { top: 12, right: 14, bottom: 24, left: 34 };
const ARRIVALS = 'var(--flow-ready)';
const DELIVERIES = 'var(--flow-done)';
const ARRIVALS_DASH = '6 4';
/** Au-delà de ce nombre de tranches, seule la fin des courbes est marquée (et la tranche survolée) : 31 marques par courbe font du bruit. */
const MAX_MARKED_BUCKETS = 16;

const totalsOf = (rows: readonly BalanceRow[]) => {
  const last = rows.at(-1);
  const [arrivals, deliveries] = [last?.cumulativeArrivals ?? 0, last?.cumulativeDeliveries ?? 0];
  return { arrivals, deliveries, net: arrivals - deliveries };
};

/**
 * Les courbes cumulées, à la largeur donnée. L'axe horizontal compte les bornes des tranches : de 0, au début de la période,
 * aux totaux, à la fin de la dernière tranche (maintenant, si la période court encore). Les Arrivées sont en tirets et
 * les Livraisons en trait plein, pour qu'on les distingue sans la couleur ; l'écart entre les deux courbes est l'écart
 * Arrivées–Débit. Survoler (ou toucher) une tranche en donne les comptes et le cumul.
 */
export function BalancePlot({ rows, width, height }: { rows: readonly BalanceRow[]; width: number; height: number }) {
  const { active, frame, show, leave } = useActive<number>();
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);
  const count = rows.length;
  const totals = totalsOf(rows);

  const x = scaleLinear({ domain: [0, Math.max(1, count)], range: [0, innerWidth] });
  const yTicks = integerTicks(Math.max(totals.arrivals, totals.deliveries, ...rows.map((row) => Math.max(row.cumulativeArrivals, row.cumulativeDeliveries))), Math.max(2, Math.floor(innerHeight / 38)));
  const y = scaleLinear({ domain: [0, yTicks.at(-1) ?? 1], range: [innerHeight, 0] });
  const labelled = thinLabels(count, Math.max(2, Math.floor(innerWidth / 62)));

  // Une valeur par borne : 0 au début de la période, puis le cumul à la fin de chaque tranche.
  const series: { key: 'arrivals' | 'deliveries'; color: string; values: number[] }[] = [
    { key: 'arrivals', color: ARRIVALS, values: [0, ...rows.map((row) => row.cumulativeArrivals)] },
    { key: 'deliveries', color: DELIVERIES, values: [0, ...rows.map((row) => row.cumulativeDeliveries)] },
  ];

  const row = active ? rows[active.value] : undefined;
  // Les bornes marquées : toutes jusqu'à seize tranches ; au-delà, la dernière et la fin de la tranche survolée.
  const marked = (boundary: number) => count <= MAX_MARKED_BUCKETS || boundary === count || (active !== null && boundary === active.value + 1);
  const pick = (event: PointerEvent<SVGRectElement>) => {
    const at = pointerIn(event, event.currentTarget);
    show({ value: bandIndexAt(at.x, innerWidth, count), x: at.x + MARGIN.left, y: at.y + MARGIN.top });
  };

  return (
    <div ref={frame} className="relative">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Arrivées et Débit cumulés : ${plural(totals.arrivals, 'Arrivée')} et ${plural(totals.deliveries, 'Livraison')} sur ${count} ${count > 1 ? 'tranches' : 'tranche'}, écart ${formatSigned(totals.net)}.`}
        className="block overflow-visible"
      >
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={y} width={innerWidth} tickValues={yTicks} stroke="var(--line)" />
          {active && row ? <rect x={x(active.value)} y={0} width={Math.max(0, x(active.value + 1) - x(active.value))} height={innerHeight} fill="var(--hover)" pointerEvents="none" /> : null}
          {series.map(({ key, color, values }) => (
            <LinePath
              key={key}
              data-series={key}
              data={values}
              x={(_, index) => x(index)}
              y={(value) => y(value)}
              stroke={outlineOf(color)}
              strokeWidth={2}
              strokeDasharray={key === 'arrivals' ? ARRIVALS_DASH : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="none"
            />
          ))}
          {series.map(({ key, color, values }) =>
            values.map((value, index) =>
              !marked(index) ? null : key === 'arrivals' ? (
                <circle key={`${key}-${index}`} data-point={key} data-value={value} cx={x(index)} cy={y(value)} r={3} fill={color} stroke={outlineOf(color)} strokeWidth={1.25} pointerEvents="none" />
              ) : (
                <rect key={`${key}-${index}`} data-point={key} data-value={value} x={x(index) - 2.75} y={y(value) - 2.75} width={5.5} height={5.5} rx={1} fill={color} stroke={outlineOf(color)} strokeWidth={1.25} pointerEvents="none" />
              ),
            ),
          )}
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
            tickFormat={(index) => rows[Number(index)]?.label ?? ''}
            tickLabelProps={() => ({ ...AXIS_TEXT, textAnchor: 'middle', dy: '0.5em' })}
          />
          <rect
            data-chart-hit=""
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            style={{ touchAction: 'pan-y' }}
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={leave}
          />
        </Group>
      </svg>
      {active && row ? (
        <ChartTooltip pointer={active} bounds={{ width, height }}>
          <p className="font-medium">{row.title}</p>
          <p className="tnum">
            Arrivées {formatCount(row.arrivals)} · Livraisons {formatCount(row.deliveries)}
          </p>
          <p className="tnum text-ink-2">
            Cumul : {plural(row.cumulativeArrivals, 'Arrivée')}, {plural(row.cumulativeDeliveries, 'Livraison')}
          </p>
          {row.note ? <p className="text-ink-2">{row.note}</p> : null}
        </ChartTooltip>
      ) : null}
    </div>
  );
}

/** Un échantillon de ligne pour la légende : tirets ou trait plein, comme sur le dessin. */
function LineSample({ color, dashed = false, round = false }: { color: string; dashed?: boolean; round?: boolean }) {
  return (
    <svg aria-hidden="true" width="26" height="10" className="shrink-0">
      <line x1="1" x2="25" y1="5" y2="5" stroke={outlineOf(color)} strokeWidth="2" strokeDasharray={dashed ? ARRIVALS_DASH : undefined} strokeLinecap="round" />
      {round ? (
        <circle cx="13" cy="5" r="3" fill={color} stroke={outlineOf(color)} strokeWidth="1.25" />
      ) : (
        <rect x="10.25" y="2.25" width="5.5" height="5.5" rx="1" fill={color} stroke={outlineOf(color)} strokeWidth="1.25" />
      )}
    </svg>
  );
}

/** La carte « Arrivées et Débit cumulés » : les deux courbes, leur légende, et les valeurs de chaque tranche en tableau. */
export function BalancePanel({
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
  const rows = useMemo(() => describeBalance(buckets, { unit, running, asOfTime }), [buckets, unit, running, asOfTime]);
  const totals = totalsOf(rows);
  const empty = totals.arrivals === 0 && totals.deliveries === 0;

  return (
    <ChartCard
      className="h-full"
      title="Arrivées et Débit cumulés"
      description={`${plural(totals.arrivals, 'Arrivée')} et ${plural(totals.deliveries, 'Livraison')} sur la période, cumulées par ${unit === 'day' ? 'jour' : 'semaine (du lundi au dimanche)'}. L’écart est de ${formatSigned(totals.net)}.`}
      legend={
        <ul aria-label="Légende des Arrivées et du Débit" className="flex flex-wrap gap-x-4 gap-y-1 text-micro text-ink-2">
          <li className="inline-flex items-center gap-1.5">
            <LineSample color={ARRIVALS} dashed round />
            Arrivées
          </li>
          <li className="inline-flex items-center gap-1.5">
            <LineSample color={DELIVERIES} />
            Livraisons
          </li>
        </ul>
      }
      data={<BalanceTable rows={rows} />}
    >
      {empty ? (
        <EmptyChart>Aucune Arrivée ni Livraison sur cette période.</EmptyChart>
      ) : (
        <ChartFrame height={260}>{({ width, height }) => <BalancePlot rows={rows} width={width} height={height} />}</ChartFrame>
      )}
    </ChartCard>
  );
}

function BalanceTable({ rows }: { rows: readonly BalanceRow[] }) {
  const numeric = ['Arrivées', 'Livraisons', 'Écart', 'Arrivées cumulées', 'Livraisons cumulées', 'Écart cumulé'];
  return (
    <DataTable
      caption="Arrivées et Livraisons de chaque tranche, et leur cumul"
      head={
        <tr>
          <th scope="col" className="px-3 py-1.5 font-medium">
            Tranche
          </th>
          {numeric.map((label) => (
            <th key={label} scope="col" className="px-3 py-1.5 text-right font-medium">
              {label}
            </th>
          ))}
          <th scope="col" className="px-3 py-1.5 font-medium">
            Remarque
          </th>
        </tr>
      }
    >
      {rows.map((row) => (
        <tr key={row.from}>
          <th scope="row" className="whitespace-nowrap px-3 py-1 text-left font-normal text-ink-2">
            {row.title}
          </th>
          <td className="px-3 py-1 text-right">{formatCount(row.arrivals)}</td>
          <td className="px-3 py-1 text-right">{formatCount(row.deliveries)}</td>
          <td className="px-3 py-1 text-right font-medium">{formatSigned(row.net)}</td>
          <td className="px-3 py-1 text-right">{formatCount(row.cumulativeArrivals)}</td>
          <td className="px-3 py-1 text-right">{formatCount(row.cumulativeDeliveries)}</td>
          <td className="px-3 py-1 text-right font-medium">{formatSigned(row.cumulativeNet)}</td>
          <td className="px-3 py-1 text-ink-2">{row.note ?? ''}</td>
        </tr>
      ))}
    </DataTable>
  );
}
