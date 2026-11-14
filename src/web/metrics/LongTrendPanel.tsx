import { AxisBottom, AxisLeft } from '@visx/axis';
import { GridRows } from '@visx/grid';
import { Group } from '@visx/group';
import { scaleBand, scaleLinear } from '@visx/scale';
import { useId } from 'react';
import type { MetricsLongTrend, MetricsLongTrendWeek } from '../../shared/api';
import { EmptyChart } from './CfdChart';
import { ChartCard, ChartFrame, DataTable, Legend } from './ChartParts';
import { AXIS_TEXT } from './axes';
import { formatCount, formatDay, formatDayRange, formatDuration, formatPercent, spokenDuration } from './format';
import { outlineOf } from './palette';
import { DURATION_STEPS, integerTicks, thinLabels } from './scales';
import { DurationText } from './SpokenText';
import { projectColor } from './series';

const MARGIN = { top: 12, right: 12, bottom: 22, left: 44 };
const PLOT_HEIGHT = 130;
const BARS = 'var(--flow-done)';
/** Deux teintes de la série des Projets, loin du vert du Débit : bleu pour le Lead Time, violet pour la Réouverture. */
const LEAD_TIME = projectColor(258);
const REOPENING = projectColor(320);

const deliveriesText = (count: number) => (count === 0 ? 'aucune Livraison' : `${formatCount(count)} ${count > 1 ? 'Livraisons' : 'Livraison'}`);

/**
 * La carte « Tendance longue » : Débit, Lead Time au P85 et Taux de Réouverture des 12 dernières semaines, l'une sous l'autre sur le même axe des
 * semaines, sans lissage. Une semaine sans Livraison (ou sans clôture) n'a pas de point : la courbe s'interrompt. Un P85 sur moins de 4 Livraisons est
 * tracé en pointillé, et la semaine en cours, comptée jusqu'à maintenant, est hachurée : ni l'un ni l'autre ne se lit comme une semaine ordinaire.
 */
export function LongTrendPanel({ trend }: { trend: MetricsLongTrend }) {
  const { weeks, minDeliveries } = trend;
  const empty = weeks.every((week) => week.throughput === 0 && week.closures === 0);
  const unreliable = `Moins de ${minDeliveries} Livraisons`;

  return (
    <ChartCard
      title="Tendance longue"
      description="Les 12 dernières semaines, du lundi au dimanche, quelle que soit la période choisie : le flux s’améliore-t-il ? Chaque semaine est comptée seule, sans lissage."
      legend={
        <Legend
          label="Légende de la Tendance longue"
          items={[
            { key: 'throughput', label: 'Débit', color: BARS },
            { key: 'lead-time', label: 'Lead Time au P85', color: LEAD_TIME, round: true },
            { key: 'reopening', label: 'Taux de Réouverture', color: REOPENING, round: true },
            { key: 'unreliable', label: unreliable, color: LEAD_TIME, round: true, hatched: true },
            { key: 'partial', label: 'Semaine en cours', color: BARS, hatched: true },
          ]}
        />
      }
      data={<LongTrendTable weeks={weeks} minDeliveries={minDeliveries} />}
    >
      {empty ? (
        <EmptyChart>Aucune Livraison ni clôture sur les 12 dernières semaines.</EmptyChart>
      ) : (
        <div className="flex flex-col gap-2">
          <Plot title="Débit">
            {({ width, height }) => <ThroughputPlot weeks={weeks} width={width} height={height} />}
          </Plot>
          <Plot title="Lead Time au P85">
            {({ width, height }) => (
              <LinePlot
                subject="Lead Time au P85 par semaine"
                weeks={weeks}
                value={(week) => week.leadTimeP85}
                dashed={(week) => !week.reliable}
                ticks={durationTicks}
                format={(ms) => (ms === 0 ? '0' : formatDuration(ms))}
                speak={spokenDuration}
                color={LEAD_TIME}
                width={width}
                height={height}
              />
            )}
          </Plot>
          <Plot title="Taux de Réouverture">
            {({ width, height }) => (
              <LinePlot
                subject="Taux de Réouverture par semaine"
                weeks={weeks}
                value={(week) => week.reopeningRate}
                dashed={() => false}
                ticks={(max) => ({ top: max > 0 ? max : 1, values: [] })}
                format={(ratio) => formatPercent(ratio)}
                speak={(ratio) => formatPercent(ratio)}
                color={REOPENING}
                width={width}
                height={height}
              />
            )}
          </Plot>
        </div>
      )}
    </ChartCard>
  );
}

function Plot({ title, children }: { title: string; children: (size: { width: number; height: number }) => React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p aria-hidden="true" className="text-micro font-medium text-ink-2">
        {title}
      </p>
      <ChartFrame height={PLOT_HEIGHT}>{children}</ChartFrame>
    </div>
  );
}

/** L'axe des semaines, partagé par les trois tracés : une bande par semaine, nommée de son lundi. */
function weekScale(weeks: readonly MetricsLongTrendWeek[], innerWidth: number) {
  return scaleBand<number>({ domain: weeks.map((_, index) => index), range: [0, innerWidth], padding: 0.25 });
}

function WeekAxis({ weeks, x, top, innerWidth }: { weeks: readonly MetricsLongTrendWeek[]; x: ReturnType<typeof weekScale>; top: number; innerWidth: number }) {
  return (
    <AxisBottom
      top={top}
      scale={x}
      tickValues={thinLabels(weeks.length, Math.max(2, Math.floor(innerWidth / 56)))}
      hideTicks
      stroke="var(--line-strong)"
      tickFormat={(index) => (weeks[index] ? formatDay(weeks[index].from) : '')}
      tickLabelProps={() => ({ ...AXIS_TEXT, textAnchor: 'middle', dy: '0.5em' })}
    />
  );
}

function ThroughputPlot({ weeks, width, height }: { weeks: readonly MetricsLongTrendWeek[]; width: number; height: number }) {
  const hatch = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);
  const x = weekScale(weeks, innerWidth);
  const yTicks = integerTicks(Math.max(0, ...weeks.map((week) => week.throughput)), 3);
  const y = scaleLinear({ domain: [0, yTicks.at(-1) ?? 1], range: [innerHeight, 0] });
  const total = weeks.reduce((sum, week) => sum + week.throughput, 0);

  return (
    <svg width={width} height={height} role="img" aria-label={`Débit par semaine : ${deliveriesText(total)} sur ${weeks.length} semaines.`} className="block overflow-visible">
      <defs>
        <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill={BARS} fillOpacity="0.35" />
          <line x1="0" y1="0" x2="0" y2="5" stroke={outlineOf(BARS)} strokeWidth="2" />
        </pattern>
      </defs>
      <Group left={MARGIN.left} top={MARGIN.top}>
        <GridRows scale={y} width={innerWidth} tickValues={yTicks} stroke="var(--line)" />
        {weeks.map((week, index) => {
          if (week.throughput === 0) return null;
          const top = y(week.throughput);
          return (
            <rect
              key={week.from}
              data-bar=""
              data-partial={week.partial ? '' : undefined}
              x={x(index) ?? 0}
              y={top}
              width={x.bandwidth()}
              height={innerHeight - top}
              rx={2}
              fill={week.partial ? `url(#${hatch})` : BARS}
              stroke={outlineOf(BARS)}
              strokeWidth={1.25}
              strokeDasharray={week.partial ? '3 2' : undefined}
            >
              <title>{`${weekTitle(week)} : ${deliveriesText(week.throughput)}`}</title>
            </rect>
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
        <WeekAxis weeks={weeks} x={x} top={innerHeight} innerWidth={innerWidth} />
      </Group>
    </svg>
  );
}

/**
 * Une courbe par semaine, sans lissage : un trait droit entre deux semaines voisines qui ont chacune une valeur, aucun par-dessus une semaine qui n'en a
 * pas. Un trait qui touche une semaine `dashed` (ou la semaine en cours) est en pointillé, et le point de cette semaine est creux.
 */
function LinePlot({
  subject,
  weeks,
  value,
  dashed,
  ticks,
  format,
  speak,
  color,
  width,
  height,
}: {
  subject: string;
  weeks: readonly MetricsLongTrendWeek[];
  value: (week: MetricsLongTrendWeek) => number | null;
  dashed: (week: MetricsLongTrendWeek) => boolean;
  /** Le haut de l'axe et ses graduations, pour la plus grande valeur ; sans graduations données, celles de l'échelle. */
  ticks: (max: number) => { top: number; values: number[] };
  /** Une graduation écrite : jamais de chevron, que l'axe ne cache pas aux lecteurs d'écran. */
  format: (value: number) => string;
  /** Une valeur telle qu'on la dit, pour l'infobulle d'un point. */
  speak: (value: number) => string;
  color: string;
  width: number;
  height: number;
}) {
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);
  const x = weekScale(weeks, innerWidth);
  const values = weeks.map(value);
  const axis = ticks(Math.max(0, ...values.map((v) => v ?? 0)));
  const y = scaleLinear({ domain: [0, axis.top], range: [innerHeight, 0], nice: axis.values.length === 0 });
  const yTicks = axis.values.length > 0 ? axis.values : y.ticks(3);
  const cx = (index: number) => (x(index) ?? 0) + x.bandwidth() / 2;
  const faint = (week: MetricsLongTrendWeek) => dashed(week) || week.partial;
  const measured = values.filter((v) => v !== null).length;

  return (
    <svg width={width} height={height} role="img" aria-label={`${subject} : ${measured} ${measured > 1 ? 'semaines mesurées' : 'semaine mesurée'} sur ${weeks.length}.`} className="block overflow-visible">
      <Group left={MARGIN.left} top={MARGIN.top}>
        <GridRows scale={y} width={innerWidth} tickValues={yTicks} stroke="var(--line)" />
        {weeks.slice(1).map((week, offset) => {
          const previous = weeks[offset] as MetricsLongTrendWeek;
          const [from, to] = [values[offset], values[offset + 1]];
          if (from === null || from === undefined || to === null || to === undefined) return null;
          return (
            <line
              key={week.from}
              data-segment=""
              data-to={week.from}
              x1={cx(offset)}
              y1={y(from)}
              x2={cx(offset + 1)}
              y2={y(to)}
              stroke={color}
              strokeWidth={1.75}
              strokeDasharray={faint(previous) || faint(week) ? '4 3' : undefined}
            />
          );
        })}
        {weeks.map((week, index) => {
          const v = values[index];
          if (v === null || v === undefined) return null;
          return (
            <circle
              key={week.from}
              data-point=""
              data-week={week.from}
              data-unreliable={dashed(week) ? '' : undefined}
              cx={cx(index)}
              cy={y(v)}
              r={3.5}
              fill={faint(week) ? 'var(--panel)' : color}
              stroke={outlineOf(color)}
              strokeWidth={1.5}
            >
              <title>{`${weekTitle(week)} : ${speak(v)}`}</title>
            </circle>
          );
        })}
        <AxisLeft
          scale={y}
          tickValues={yTicks}
          hideAxisLine
          hideTicks
          tickFormat={(tick) => format(Number(tick))}
          tickLabelProps={() => ({ ...AXIS_TEXT, textAnchor: 'end', dx: '-0.5em', dy: '0.33em' })}
        />
        <WeekAxis weeks={weeks} x={x} top={innerHeight} innerWidth={innerWidth} />
      </Group>
    </svg>
  );
}

/**
 * L'axe des durées : de 0 à la première durée ronde (`DURATION_STEPS`) qui couvre la plus grande, et deux ou trois durées rondes entre les deux. Jamais
 * « < 1 min » : 0 s'écrit « 0 ».
 */
function durationTicks(max: number): { top: number; values: number[] } {
  const top = DURATION_STEPS.find((step) => step >= max) ?? max;
  const steps = DURATION_STEPS.filter((step) => step <= top);
  // De haut en bas, chaque graduation au moins à un quart de la précédente : sur un axe linéaire, les petites durées se tasseraient près de 0.
  const values: number[] = [];
  for (let index = steps.length - 1; index >= 0 && values.length < 3; index--) {
    const step = steps[index] as number;
    const previous = values.at(-1) ?? Number.POSITIVE_INFINITY;
    if (step <= previous - top / 4 && step >= top / 4) values.push(step);
  }
  return { top, values: [0, ...values.reverse()] };
}

const weekTitle = (week: MetricsLongTrendWeek) => `Semaine du ${formatDayRange(week.from, week.to)}`;

function LongTrendTable({ weeks, minDeliveries }: { weeks: readonly MetricsLongTrendWeek[]; minDeliveries: number }) {
  return (
    <DataTable
      caption="Débit, Lead Time au P85 et Taux de Réouverture de chacune des 12 dernières semaines"
      head={
        <tr>
          <th scope="col" className="px-3 py-1.5 font-medium">
            Semaine
          </th>
          <th scope="col" className="px-3 py-1.5 text-right font-medium">
            Livraisons
          </th>
          <th scope="col" className="px-3 py-1.5 text-right font-medium">
            Lead Time P85
          </th>
          <th scope="col" className="px-3 py-1.5 text-right font-medium">
            Réouverture
          </th>
          <th scope="col" className="px-3 py-1.5 font-medium">
            Remarque
          </th>
        </tr>
      }
    >
      {weeks.map((week) => (
        <tr key={week.from}>
          <th scope="row" className="whitespace-nowrap px-3 py-1 text-left font-normal text-ink-2">
            {formatDayRange(week.from, week.to)}
          </th>
          <td className="px-3 py-1 text-right font-medium">{formatCount(week.throughput)}</td>
          <td className="px-3 py-1 text-right">{week.leadTimeP85 === null ? '—' : <DurationText ms={week.leadTimeP85} />}</td>
          <td className="px-3 py-1 text-right">
            {week.reopeningRate === null ? '—' : `${formatPercent(week.reopeningRate)} (${week.reopened} sur ${week.closures})`}
          </td>
          <td className="px-3 py-1 text-ink-2">
            {[week.partial ? 'En cours' : '', week.throughput > 0 && !week.reliable ? `Moins de ${minDeliveries} Livraisons` : ''].filter(Boolean).join(', ')}
          </td>
        </tr>
      ))}
    </DataTable>
  );
}
