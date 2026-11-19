import { AxisBottom, AxisLeft } from '@visx/axis';
import { GridRows } from '@visx/grid';
import { Group } from '@visx/group';
import { scaleBand, scaleLinear } from '@visx/scale';
import { useId } from 'react';
import type { MetricsLongTrend, MetricsLongTrendWeek } from '../../shared/api';
import { useFormat, useLanguage, useT, type DisplayFormat, type Messages } from '../i18n';
import { EmptyChart } from './CfdChart';
import { ChartCard, ChartFrame, DataTable, Legend } from './ChartParts';
import { AXIS_TEXT } from './axes';
import { failureRateReason } from './failureReason';
import { outlineOf } from './palette';
import { DURATION_STEPS, integerTicks, thinLabels } from './scales';
import { DurationText } from './SpokenText';
import { projectColor } from './series';

const MARGIN = { top: 12, right: 12, bottom: 22, left: 44 };
const PLOT_HEIGHT = 130;
const BARS = 'var(--flow-done)';
/** Trois teintes de la série des Projets, loin du vert du Débit : bleu pour le Lead Time, violet pour la Réouverture, sarcelle pour le Débit sain. */
const LEAD_TIME = projectColor(258);
const REOPENING = projectColor(320);
const SOUND = projectColor(195);

type LongTrendTexts = Messages['metrics']['longTrend'];

const deliveriesText = (texts: LongTrendTexts, format: DisplayFormat, count: number) => texts.deliveries(count, format.formatCount(count));
const soundText = (texts: LongTrendTexts, format: DisplayFormat, count: number) => texts.soundDeliveries(count, format.formatCount(count));

/**
 * La carte « Tendance longue » : Débit, Débit sain, Lead Time au P85 et Taux de Réouverture des 12 dernières semaines, l'une sous l'autre sur le même axe des
 * semaines, sans lissage. Une semaine sans Livraison (ou sans clôture) n'a pas de point : la courbe s'interrompt. Un P85 sur moins de 4 Livraisons est
 * tracé en pointillé, et la semaine en cours, comptée jusqu'à maintenant, est hachurée : ni l'un ni l'autre ne se lit comme une semaine ordinaire.
 *
 * Le Débit sain est dessiné sous le Débit, à la même échelle : la hauteur de ses barres se compare d'un coup d'œil à celle des Livraisons. Quand la Couverture
 * est faible, il n'est pas significatif : ses barres pâlissent, et le motif est écrit sous son titre, dans son nom et dans la légende du tableau. Celui de la
 * semaine en cours est provisoire, comme la tuile le dit d'une période en cours : l'infobulle de sa barre et la remarque de sa ligne le disent, dès qu'elle a
 * une Livraison qui pourrait revenir.
 */
export function LongTrendPanel({ trend }: { trend: MetricsLongTrend }) {
  const { weeks, minDeliveries, soundSignificance } = trend;
  const empty = weeks.every((week) => week.throughput === 0 && week.closures === 0);
  const t = useT();
  const format = useFormat();
  const { language } = useLanguage();
  const { formatCount, formatDuration, formatPercent, spokenDuration } = format;
  const texts = t.metrics.longTrend;
  const unreliable = texts.unreliable(formatCount(minDeliveries));
  // Le motif du Débit sain non significatif, null quand il l'est (aucun motif) : celui du Taux d'échec, écrit dans la langue de l'interface.
  const reason = failureRateReason(soundSignificance, language);
  const soundNote = reason === null ? undefined : texts.notSignificant(reason);
  const top = Math.max(0, ...weeks.map((week) => week.throughput));
  const totalOf = (value: (week: MetricsLongTrendWeek) => number) => weeks.reduce((sum, week) => sum + value(week), 0);
  const weekCount = formatCount(weeks.length);

  return (
    <ChartCard
      title={texts.title}
      description={texts.description}
      legend={
        <Legend
          label={texts.legend}
          items={[
            { key: 'throughput', label: texts.throughput, color: BARS },
            { key: 'sound', label: texts.soundThroughput, color: SOUND },
            { key: 'lead-time', label: texts.leadTime, color: LEAD_TIME, round: true },
            { key: 'reopening', label: texts.reopening, color: REOPENING, round: true },
            { key: 'unreliable', label: unreliable, color: LEAD_TIME, round: true, hatched: true },
            { key: 'partial', label: texts.partial, color: BARS, hatched: true },
          ]}
        />
      }
      data={<LongTrendTable weeks={weeks} unreliable={unreliable} soundNote={reason ?? undefined} />}
    >
      {empty ? (
        <EmptyChart>{texts.empty}</EmptyChart>
      ) : (
        <div className="flex flex-col gap-2">
          <Plot title={texts.throughput}>
            {({ width, height }) => (
              <BarPlot
                weeks={weeks}
                value={(week) => week.throughput}
                top={top}
                color={BARS}
                label={texts.throughputLabel(deliveriesText(texts, format, totalOf((week) => week.throughput)), weekCount)}
                describe={(count) => deliveriesText(texts, format, count)}
                width={width}
                height={height}
              />
            )}
          </Plot>
          <Plot title={texts.soundThroughput} note={soundNote}>
            {({ width, height }) => (
              <BarPlot
                weeks={weeks}
                value={(week) => week.soundThroughput}
                top={top}
                color={SOUND}
                label={[texts.soundThroughputLabel(soundText(texts, format, totalOf((week) => week.soundThroughput)), weekCount), soundNote].filter(Boolean).join(' ')}
                describe={(count, week) => (week.partial ? texts.provisionalPoint(soundText(texts, format, count)) : soundText(texts, format, count))}
                faint={soundNote !== undefined}
                width={width}
                height={height}
              />
            )}
          </Plot>
          <Plot title={texts.leadTime}>
            {({ width, height }) => (
              <LinePlot
                subject={texts.leadTimeSubject}
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
          <Plot title={texts.reopening}>
            {({ width, height }) => (
              <LinePlot
                subject={texts.reopeningSubject}
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

/** Un tracé et son titre ; `note`, une remarque sous le titre. Les deux sont cachés aux lecteurs d'écran : le nom du dessin les dit. */
function Plot({ title, note, children }: { title: string; note?: string; children: (size: { width: number; height: number }) => React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p aria-hidden="true" className="text-micro font-medium text-ink-2">
        {title}
      </p>
      {note ? (
        <p aria-hidden="true" data-note="" className="text-micro leading-4 text-ink-2">
          {note}
        </p>
      ) : null}
      <ChartFrame height={PLOT_HEIGHT}>{children}</ChartFrame>
    </div>
  );
}

/** L'axe des semaines, partagé par les quatre tracés : une bande par semaine, nommée de son lundi. */
function weekScale(weeks: readonly MetricsLongTrendWeek[], innerWidth: number) {
  return scaleBand<number>({ domain: weeks.map((_, index) => index), range: [0, innerWidth], padding: 0.25 });
}

function WeekAxis({ weeks, x, top, innerWidth }: { weeks: readonly MetricsLongTrendWeek[]; x: ReturnType<typeof weekScale>; top: number; innerWidth: number }) {
  const { formatDay } = useFormat();
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

/**
 * Un nombre de Livraisons par semaine, en barres (Débit, Débit sain). `top` est la plus grande valeur que l'axe doit couvrir : le Débit sain prend celle du
 * Débit, pour que leurs barres se comparent à la même échelle. `faint` : une mesure non significative, dont les barres pâlissent (le contour, lui, garde son
 * contraste). La semaine en cours est hachurée.
 */
function BarPlot({
  weeks,
  value,
  top: max,
  color,
  label,
  describe,
  faint = false,
  width,
  height,
}: {
  weeks: readonly MetricsLongTrendWeek[];
  value: (week: MetricsLongTrendWeek) => number;
  top: number;
  color: string;
  /** Le nom du dessin, pour les lecteurs d'écran. */
  label: string;
  /** Le nombre d'une semaine, en mots, pour l'infobulle de sa barre. */
  describe: (count: number, week: MetricsLongTrendWeek) => string;
  faint?: boolean;
  width: number;
  height: number;
}) {
  const hatch = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);
  const x = weekScale(weeks, innerWidth);
  const yTicks = integerTicks(max, 3);
  const y = scaleLinear({ domain: [0, yTicks.at(-1) ?? 1], range: [innerHeight, 0] });
  const t = useT();
  const format = useFormat();
  const texts = t.metrics.longTrend;

  return (
    <svg width={width} height={height} role="img" aria-label={label} data-faint={faint ? '' : undefined} className="block overflow-visible">
      <defs>
        <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill={color} fillOpacity="0.35" />
          <line x1="0" y1="0" x2="0" y2="5" stroke={outlineOf(color)} strokeWidth="2" />
        </pattern>
      </defs>
      <Group left={MARGIN.left} top={MARGIN.top}>
        <GridRows scale={y} width={innerWidth} tickValues={yTicks} stroke="var(--line)" />
        {weeks.map((week, index) => {
          const count = value(week);
          if (count === 0) return null;
          const top = y(count);
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
              fill={week.partial ? `url(#${hatch})` : color}
              fillOpacity={faint && !week.partial ? 0.35 : undefined}
              stroke={outlineOf(color)}
              strokeWidth={1.25}
              strokeDasharray={week.partial ? '3 2' : undefined}
            >
              <title>{texts.point(weekTitle(texts, format, week), describe(count, week))}</title>
            </rect>
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
  const t = useT();
  const display = useFormat();
  const texts = t.metrics.longTrend;

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={texts.lineLabel(subject, measured, display.formatCount(measured), display.formatCount(weeks.length))}
      className="block overflow-visible"
    >
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
              <title>{texts.point(weekTitle(texts, display, week), speak(v))}</title>
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

const weekTitle = (texts: LongTrendTexts, format: DisplayFormat, week: MetricsLongTrendWeek) => texts.week(format.formatDayRange(week.from, week.to));

/**
 * `unreliable` : « Moins de 4 Livraisons », la remarque d'une semaine dont le P85 n'est pas digne de foi (la même que la légende). `soundNote` : le motif du
 * Débit sain non significatif, que la légende du tableau donne à la suite.
 */
function LongTrendTable({ weeks, unreliable, soundNote }: { weeks: readonly MetricsLongTrendWeek[]; unreliable: string; soundNote?: string }) {
  const t = useT();
  const { formatCount, formatDayRange, formatPercent } = useFormat();
  const texts = t.metrics.longTrend;
  return (
    <DataTable
      caption={soundNote === undefined ? texts.caption : texts.captionNotSignificant(texts.caption, soundNote)}
      head={
        <tr>
          <th scope="col" className="px-3 py-1.5 font-medium">
            {texts.weekColumn}
          </th>
          <th scope="col" className="px-3 py-1.5 text-right font-medium">
            {texts.deliveriesColumn}
          </th>
          <th scope="col" className="px-3 py-1.5 text-right font-medium">
            {texts.soundColumn}
          </th>
          <th scope="col" className="px-3 py-1.5 text-right font-medium">
            {texts.leadTimeColumn}
          </th>
          <th scope="col" className="px-3 py-1.5 text-right font-medium">
            {texts.reopeningColumn}
          </th>
          <th scope="col" className="px-3 py-1.5 font-medium">
            {texts.remarkColumn}
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
          <td data-sound="" className="px-3 py-1 text-right">
            {formatCount(week.soundThroughput)}
          </td>
          <td className="px-3 py-1 text-right">{week.leadTimeP85 === null ? '—' : <DurationText ms={week.leadTimeP85} />}</td>
          <td className="px-3 py-1 text-right">
            {week.reopeningRate === null ? '—' : texts.reopeningCell(formatPercent(week.reopeningRate), formatCount(week.reopened), formatCount(week.closures))}
          </td>
          <td className="px-3 py-1 text-ink-2">
            {[week.partial ? texts.inProgress : '', week.partial && week.throughput > 0 ? texts.soundProvisional : '', week.throughput > 0 && !week.reliable ? unreliable : '']
              .filter(Boolean)
              .join(texts.remarkSeparator)}
          </td>
        </tr>
      ))}
    </DataTable>
  );
}
