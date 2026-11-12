import { AxisBottom, AxisLeft } from '@visx/axis';
import { GridRows } from '@visx/grid';
import { Group } from '@visx/group';
import { scaleLinear, scaleLog } from '@visx/scale';
import { useMemo, type PointerEvent } from 'react';
import { Link } from 'react-router';
import type { MetricsCycleTimePoint } from '../../shared/api';
import { ticketTitle } from '../data/helpers';
import { priorityMeta } from '../design/issue-palette';
import { paths } from '../paths';
import { TypeBadge } from '../ui/IssueBadges';
import { ChartCard, ChartFrame, ChartTooltip, DataTable, Legend, pointerIn, useActive } from './ChartParts';
import { EmptyChart } from './CfdChart';
import { AXIS_TEXT } from './axes';
import { dayInZone, formatDay, formatDuration, formatTime, spokenDuration } from './format';
import { outlineOf } from './palette';
import type { Dimension } from './params';
import { dayTicks, DURATION_STEPS, logDomain, nearestPoint, pickTicks } from './scales';
import { DIMENSION_LABELS, legendOf, seriesOf, type SeriesContext } from './series';
import { DurationText } from './SpokenText';

const MARGIN = { top: 12, right: 12, bottom: 24, left: 46 };
const HIT_RADIUS = 24;

/** La période du graphique : de son début à l'instant où elle est mesurée (ms epoch), et ses jours pour l'axe. */
export interface TimeWindow {
  from: string;
  days: number;
  start: number;
  end: number;
}

interface PlotProps {
  points: readonly MetricsCycleTimePoint[];
  span: TimeWindow;
  dimension: Dimension;
  ctx: SeriesContext;
  timeZone: string;
  median: number | null;
  p85: number | null;
  width: number;
  height: number;
}

/**
 * Le nuage de points du Cycle Time, à la largeur donnée : une Livraison par point, à sa date de Livraison, à la hauteur de
 * son Cycle Time. Les durées s'étalent de quelques minutes à plusieurs semaines : l'échelle est logarithmique, graduée
 * en durées rondes. La médiane et le P85 de la période sont tracés. Le découpage choisi colore les points.
 */
export function CycleTimePlot({ points, span, dimension, ctx, timeZone, median, p85, width, height }: PlotProps) {
  const { active, frame, show, clear } = useActive<number>();
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);

  const references = [median, p85].filter((value): value is number => value !== null);
  const domain = logDomain([...points.map((point) => point.cycleTime), ...references]);
  const y = scaleLog({ domain, range: [innerHeight, 0], clamp: true });
  const x = scaleLinear({ domain: [span.start, Math.max(span.end, span.start + 1)], range: [0, innerWidth] });
  const yTicks = pickTicks(DURATION_STEPS, domain, y, 30);
  const xTicks = dayTicks({ from: span.from, days: span.days, timeZone }, Math.max(2, Math.floor(innerWidth / 62)));

  const pixels = points.map((point) => ({ x: x(Date.parse(point.deliveredAt)), y: y(Math.max(point.cycleTime, domain[0])) }));
  const point = active ? points[active.value] : undefined;
  const pixel = active ? pixels[active.value] : undefined;

  const pick = (event: PointerEvent<SVGRectElement>) => {
    const at = pointerIn(event, event.currentTarget);
    const index = nearestPoint(pixels, at, HIT_RADIUS);
    if (index < 0) clear();
    else show({ value: index, x: (pixels[index]?.x ?? 0) + MARGIN.left, y: (pixels[index]?.y ?? 0) + MARGIN.top });
  };

  return (
    <div ref={frame} className="relative">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={
          `Nuage de points du Cycle Time : ${points.length} ${points.length > 1 ? 'Livraisons' : 'Livraison'}` +
          `${median !== null ? `, médiane ${spokenDuration(median)}` : ''}${p85 !== null ? `, P85 ${spokenDuration(p85)}` : ''}, échelle logarithmique.`
        }
        className="block overflow-visible"
      >
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={y} width={innerWidth} tickValues={yTicks} stroke="var(--line)" />
          {median !== null ? <ReferenceLine y={y(median)} width={innerWidth} dash="5 4" /> : null}
          {p85 !== null ? <ReferenceLine y={y(p85)} width={innerWidth} dash="1.5 3.5" /> : null}
          <AxisLeft
            scale={y}
            tickValues={yTicks}
            hideAxisLine
            hideTicks
            tickFormat={(value) => formatDuration(Number(value))}
            tickLabelProps={() => ({ ...AXIS_TEXT, textAnchor: 'end', dx: '-0.5em', dy: '0.33em' })}
          />
          <AxisBottom
            top={innerHeight}
            scale={x}
            tickValues={xTicks.map((tick) => tick.time)}
            hideTicks
            stroke="var(--line-strong)"
            tickFormat={(value) => xTicks.find((tick) => tick.time === Number(value))?.label ?? ''}
            tickLabelProps={() => ({ ...AXIS_TEXT, textAnchor: 'middle', dy: '0.5em' })}
          />
          {points.map((entry, index) => {
            const color = seriesOf(dimension, entry, ctx).color;
            return (
              <circle
                key={`${entry.project}/${entry.id}`}
                data-dot=""
                cx={pixels[index]?.x}
                cy={pixels[index]?.y}
                r={4.5}
                fill={color}
                fillOpacity={0.85}
                stroke={outlineOf(color)}
                strokeWidth={1.25}
                pointerEvents="none"
              />
            );
          })}
          {/* Les étiquettes après les points : dans un SVG, ce qui est dessiné plus tard recouvre ce qui l'est avant. */}
          {median !== null ? <ReferenceLabel y={y(median)} width={innerWidth} label={`Médiane ${formatDuration(median)}`} below /> : null}
          {p85 !== null ? <ReferenceLabel y={y(p85)} width={innerWidth} label={`P85 ${formatDuration(p85)}`} /> : null}
          {pixel ? <circle cx={pixel.x} cy={pixel.y} r={8} fill="none" stroke="var(--ink)" strokeWidth={1.5} pointerEvents="none" /> : null}
          <rect
            data-chart-hit=""
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            style={{ touchAction: 'pan-y' }}
            onPointerMove={(event) => {
              if (event.pointerType !== 'touch') pick(event);
            }}
            onPointerDown={pick}
            onPointerLeave={(event) => {
              if (event.pointerType !== 'touch') clear();
            }}
          />
        </Group>
      </svg>
      {active && point ? (
        <ChartTooltip pointer={active} bounds={{ width, height }}>
          {/* L'infobulle fait 15 rem au plus : l'identifiant, qui peut n'avoir aucun endroit où passer à la ligne, s'y coupe où il le faut (bdesk-38k.90). */}
          <p className="wrap-anywhere font-mono text-[11px] text-ink-2">{point.id}</p>
          <p className="line-clamp-3 font-medium">{ticketTitle(point)}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-ink-2">
            <TypeBadge type={point.type} />
            <span>{priorityMeta(point.priority).code}</span>
            {dimension === 'project' ? <span>{ctx.projectName(point.project)}</span> : null}
          </p>
          <p className="tnum">
            Cycle Time <strong className="font-semibold">{formatDuration(point.cycleTime)}</strong>
          </p>
          <p className="tnum text-ink-2">Livré {deliveredLabel(point.deliveredAt, timeZone)}</p>
        </ChartTooltip>
      ) : null}
    </div>
  );
}

/** « lun. 2 nov. à 11:00 » : le jour et l'heure de la Livraison, dans le fuseau des métriques. */
function deliveredLabel(instant: string, timeZone: string): string {
  return `${formatDay(dayInZone(instant, timeZone), { weekday: true })} à ${formatTime(instant, timeZone)}`;
}

/** Une ligne de repère (médiane, P85) : tiretée, sous les points. Son étiquette est dessinée à part, par-dessus eux. */
function ReferenceLine({ y, width, dash }: { y: number; width: number; dash: string }) {
  return <line x1={0} x2={width} y1={y} y2={y} stroke="var(--ink-2)" strokeWidth={1.25} strokeDasharray={dash} pointerEvents="none" />;
}

/**
 * L'étiquette d'une ligne de repère, posée à droite contre elle et cernée du fond du panneau pour rester lisible sur un point. Elle
 * répète le nom du dessin (« médiane moins d'une minute ») et s'écrit « Médiane < 1 min » sous 30 s : cachée aux lecteurs d'écran,
 * car Chromium expose le texte d'un SVG nommé et le chevron y serait lu tel quel.
 */
function ReferenceLabel({ y, width, label, below = false }: { y: number; width: number; label: string; below?: boolean }) {
  return (
    <text
      x={width - 2}
      y={y + (below ? 12 : -4)}
      textAnchor="end"
      {...AXIS_TEXT}
      fill="var(--ink-2)"
      stroke="var(--panel)"
      strokeWidth={3}
      paintOrder="stroke"
      pointerEvents="none"
      aria-hidden="true"
    >
      {label}
    </text>
  );
}

export interface CycleTimePanelProps {
  points: readonly MetricsCycleTimePoint[];
  span: TimeWindow;
  dimension: Dimension;
  ctx: SeriesContext;
  projectOrder: readonly string[];
  timeZone: string;
  median: number | null;
  p85: number | null;
  /** Les Projets sont plusieurs : la colonne « Projet » du tableau a un sens. */
  showProject: boolean;
}

/** La carte « Cycle Time » : le nuage, sa légende (le découpage ; la médiane et le P85 sont nommés sur le tracé), et les valeurs en tableau. */
export function CycleTimePanel({ points, span, dimension, ctx, projectOrder, timeZone, median, p85, showProject }: CycleTimePanelProps) {
  const series = useMemo(() => legendOf(dimension, points, ctx, projectOrder), [dimension, points, ctx, projectOrder]);

  return (
    <ChartCard
      title="Cycle Time"
      description={`Une Livraison par point : sa date de Livraison, et le temps passé en travail. Échelle logarithmique, colorée par ${DIMENSION_LABELS[dimension].toLowerCase()}.`}
      legend={<Legend label={`Couleurs : ${DIMENSION_LABELS[dimension].toLowerCase()}`} items={series.map((entry) => ({ ...entry, round: true }))} />}
      data={<CycleTimeTable points={points} ctx={ctx} timeZone={timeZone} showProject={showProject} />}
    >
      {points.length === 0 ? (
        <EmptyChart>Aucune Livraison démarrée sur cette période : le Cycle Time n’est défini que pour un ticket qui a été démarré.</EmptyChart>
      ) : (
        <ChartFrame height={260}>
          {({ width, height }) => (
            <CycleTimePlot points={points} span={span} dimension={dimension} ctx={ctx} timeZone={timeZone} median={median} p85={p85} width={width} height={height} />
          )}
        </ChartFrame>
      )}
    </ChartCard>
  );
}

function CycleTimeTable({
  points,
  ctx,
  timeZone,
  showProject,
}: {
  points: readonly MetricsCycleTimePoint[];
  ctx: SeriesContext;
  timeZone: string;
  showProject: boolean;
}) {
  return (
    <DataTable
      caption="Livraisons de la période et leur Cycle Time"
      head={
        <tr>
          <th scope="col" className="px-3 py-1.5 font-medium">
            Ticket
          </th>
          <th scope="col" className="px-3 py-1.5 font-medium">
            Type
          </th>
          <th scope="col" className="px-3 py-1.5 font-medium">
            Priorité
          </th>
          {showProject ? (
            <th scope="col" className="px-3 py-1.5 font-medium">
              Projet
            </th>
          ) : null}
          <th scope="col" className="px-3 py-1.5 font-medium">
            Livré
          </th>
          <th scope="col" className="px-3 py-1.5 text-right font-medium">
            Cycle Time
          </th>
        </tr>
      }
    >
      {points.map((point) => (
        <tr key={`${point.project}/${point.id}`}>
          <th scope="row" className="px-3 py-1 text-left font-normal">
            <Link to={paths.issue(point.project, point.id)} className="flex flex-col text-accent hover:underline">
              {/* Plafonné à 40 caractères, coupé là où il dépasse : une cellule prend la largeur de son contenu, et la région de données défilait de plus de 1 000 px pour un identifiant de 152 caractères. Coupé par `break-word` et non
                  `anywhere` : celui-ci réduit la plus petite largeur de la colonne, et un identifiant court passerait à la ligne (bdesk-38k.90). */}
              <span className="max-w-[40ch] wrap-break-word font-mono">{point.id}</span>
              <span className="max-w-[28ch] truncate text-ink-2">{ticketTitle(point)}</span>
            </Link>
          </th>
          <td className="whitespace-nowrap px-3 py-1">
            <TypeBadge type={point.type} />
          </td>
          <td className="whitespace-nowrap px-3 py-1">{priorityMeta(point.priority).code}</td>
          {showProject ? <td className="whitespace-nowrap px-3 py-1">{ctx.projectName(point.project)}</td> : null}
          <td className="whitespace-nowrap px-3 py-1 text-ink-2">{deliveredLabel(point.deliveredAt, timeZone)}</td>
          <td className="whitespace-nowrap px-3 py-1 text-right font-medium">
            <DurationText ms={point.cycleTime} />
          </td>
        </tr>
      ))}
    </DataTable>
  );
}
