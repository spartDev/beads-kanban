import { AxisBottom, AxisLeft } from '@visx/axis';
import { curveLinear } from '@visx/curve';
import { GridRows } from '@visx/grid';
import { Group } from '@visx/group';
import { scaleLinear } from '@visx/scale';
import { AreaStack, LinePath } from '@visx/shape';
import { useContext, useMemo, useState } from 'react';
import type { MetricsCfdPoint } from '../../shared/api';
import { cx } from '../lib/cx';
import { Button } from '../ui/Button';
import { cfdMax, cfdSummary, FLOW_SERIES, stackKeys, toCfdRows, type CfdRow, type FlowKey } from './cfd';
import { ChartCard, ChartFrame, ChartTitleId, ChartTooltip, DataTable, Legend, pointerIn, Swatch, useActive } from './ChartParts';
import { AXIS_TEXT } from './axes';
import { formatCount, formatDay } from './format';
import { outlineOf } from './palette';
import { indexAt, integerTicks, thinLabels } from './scales';

const DAY = 86_400_000;
const MARGIN = { top: 10, right: 14, bottom: 24, left: 36 };
const COLORS = Object.fromEntries(FLOW_SERIES.map(({ key, color }) => [key, color])) as Record<FlowKey, string>;
const LABELS = Object.fromEntries(FLOW_SERIES.map(({ key, label }) => [key, label])) as Record<FlowKey, string>;

/** Du haut de la pile vers le bas : l'ordre dans lequel l'œil lit les bandes, pour la légende et l'infobulle. */
const TOP_DOWN = [...FLOW_SERIES].reverse();

/**
 * Le diagramme de flux cumulé, à la largeur donnée. Chaque jour, une pile : Terminé en bas, puis le travail en cours
 * (En cours, Bloqué), puis Prêt et Backlog. Survoler (ou toucher) un jour en donne le détail.
 */
export function CfdPlot({ rows, keys, width, height }: { rows: readonly CfdRow[]; keys: readonly FlowKey[]; width: number; height: number }) {
  const { active, frame, show, leave } = useActive<number>();
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);

  const first = rows[0]?.time ?? 0;
  const last = rows.at(-1)?.time ?? first;
  const x = scaleLinear({ domain: first === last ? [first - DAY / 2, last + DAY / 2] : [first, last], range: [0, innerWidth] });
  const yTicks = integerTicks(cfdMax(rows, keys), Math.max(2, Math.floor(innerHeight / 38)));
  const y = scaleLinear({ domain: [0, yTicks.at(-1) ?? 1], range: [innerHeight, 0] });
  const xTicks = thinLabels(rows.length, Math.max(2, Math.floor(innerWidth / 62)));
  const labelAt = new Map(xTicks.map((index) => [rows[index]?.time ?? 0, formatDay(rows[index]?.date ?? '1970-01-01')]));

  const row = active ? rows[active.value] : undefined;

  return (
    <div ref={frame} className="relative">
      <svg width={width} height={height} role="img" aria-label={cfdSummary(rows)} className="block overflow-visible">
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={y} width={innerWidth} tickValues={yTicks} stroke="var(--line)" />
          <AreaStack<CfdRow, FlowKey>
            data={rows as CfdRow[]}
            keys={[...keys]}
            curve={curveLinear}
            x={(point) => x(point.data.time)}
            y0={(point) => y(point[0])}
            y1={(point) => y(point[1])}
          >
            {({ stacks, path }) =>
              stacks.map((stack) => (
                <g key={stack.key}>
                  <path d={path(stack) ?? ''} fill={COLORS[stack.key]} />
                  <LinePath
                    data={stack}
                    x={(point) => x(point.data.time)}
                    y={(point) => y(point[1])}
                    curve={curveLinear}
                    stroke={outlineOf(COLORS[stack.key])}
                    strokeWidth={1.25}
                    strokeLinejoin="round"
                    fill="none"
                  />
                </g>
              ))
            }
          </AreaStack>
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
            tickValues={[...labelAt.keys()]}
            hideTicks
            stroke="var(--line-strong)"
            tickFormat={(value) => labelAt.get(Number(value)) ?? ''}
            tickLabelProps={() => ({ ...AXIS_TEXT, textAnchor: 'middle', dy: '0.5em' })}
          />
          {row ? (
            <line x1={x(row.time)} x2={x(row.time)} y1={0} y2={innerHeight} stroke="var(--ink-3)" strokeDasharray="3 3" pointerEvents="none" />
          ) : null}
          <rect
            data-chart-hit=""
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            style={{ touchAction: 'pan-y' }}
            onPointerMove={(event) => {
              const at = pointerIn(event, event.currentTarget);
              show({ value: indexAt(at.x, innerWidth, rows.length), x: at.x + MARGIN.left, y: at.y + MARGIN.top });
            }}
            onPointerDown={(event) => {
              const at = pointerIn(event, event.currentTarget);
              show({ value: indexAt(at.x, innerWidth, rows.length), x: at.x + MARGIN.left, y: at.y + MARGIN.top });
            }}
            onPointerLeave={leave}
          />
        </Group>
      </svg>
      {active && row ? (
        <ChartTooltip pointer={active} bounds={{ width, height }}>
          <p className="font-medium">{formatDay(row.date, { weekday: true, year: true })}</p>
          <ul className="flex flex-col gap-0.5">
            {TOP_DOWN.filter(({ key }) => keys.includes(key)).map(({ key, label, color }) => (
              <li key={key} className="flex items-center gap-1.5">
                <Swatch color={color} />
                <span className="text-ink-2">{label}</span>
                <span className="tnum ml-auto pl-3 font-medium">{formatCount(row[key])}</span>
              </li>
            ))}
          </ul>
        </ChartTooltip>
      ) : null}
    </div>
  );
}

/** La carte « Flux cumulé » : le dessin, sa légende, le bouton qui masque Terminé, et les valeurs en tableau. */
export function CfdPanel({ points }: { points: readonly MetricsCfdPoint[] }) {
  // Terminé domine l'échelle (il ne fait que monter) : le masquer agrandit les bandes du travail en cours.
  const [hideDone, setHideDone] = useState(false);
  const rows = useMemo(() => toCfdRows(points), [points]);
  const keys = stackKeys(hideDone);
  const empty = rows.every((row) => row.total === 0);

  return (
    <ChartCard
      title="Flux cumulé"
      description="Tickets dans chaque colonne du kanban à la fin de chaque jour. L’épaisseur des bandes En cours et Bloqué est le travail en cours."
      actions={
        <Button aria-pressed={hideDone} onClick={() => setHideDone((hidden) => !hidden)} className={cx('h-7 shrink-0 px-2.5 text-xs', hideDone && 'bg-press')}>
          Masquer Terminé
        </Button>
      }
      legend={<Legend label="Colonnes du flux" items={TOP_DOWN.filter(({ key }) => keys.includes(key))} />}
      data={<CfdTable rows={rows} />}
    >
      {empty ? (
        <EmptyChart>Aucun ticket sur cette période.</EmptyChart>
      ) : (
        <ChartFrame height={260}>{({ width, height }) => <CfdPlot rows={rows} keys={keys} width={width} height={height} />}</ChartFrame>
      )}
    </ChartCard>
  );
}

function CfdTable({ rows }: { rows: readonly CfdRow[] }) {
  // Les colonnes du kanban, de gauche à droite.
  const columns: FlowKey[] = ['backlog', 'ready', 'inProgress', 'blocked', 'done'];
  return (
    <DataTable
      caption="Tickets par colonne du kanban à la fin de chaque jour"
      head={
        <tr>
          <th scope="col" className="px-3 py-1.5 font-medium">
            Jour
          </th>
          {columns.map((key) => (
            <th key={key} scope="col" className="px-3 py-1.5 text-right font-medium">
              {LABELS[key]}
            </th>
          ))}
          <th scope="col" className="px-3 py-1.5 text-right font-medium">
            Total
          </th>
        </tr>
      }
    >
      {rows.map((row) => (
        <tr key={row.date}>
          <th scope="row" className="whitespace-nowrap px-3 py-1 text-left font-normal text-ink-2">
            {formatDay(row.date, { year: true })}
          </th>
          {columns.map((key) => (
            <td key={key} className="px-3 py-1 text-right">
              {formatCount(row[key])}
            </td>
          ))}
          <td className="px-3 py-1 text-right font-medium">{formatCount(row.total)}</td>
        </tr>
      ))}
    </DataTable>
  );
}

/**
 * Un graphique sans rien à montrer : une phrase à la place du dessin, à la hauteur d'un petit encart. C'est une région de statut, nommée du titre de la carte du graphique (`ChartTitleId`) : la phrase
 * (« Aucun ticket Prêt. ») ne dit pas de quoi elle parle.
 */
export function EmptyChart({ children }: { children: string }) {
  const titleId = useContext(ChartTitleId);
  return (
    <p role="status" aria-labelledby={titleId} className="grid min-h-24 place-items-center rounded-md border border-dashed border-line-strong px-4 py-6 text-center text-ui text-ink-2">
      {children}
    </p>
  );
}
