import { scaleLinear } from '@visx/scale';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { MetricsReadyAges } from '../../shared/api';
import { ticketTitle } from '../data/helpers';
import { useFormat, useLanguage, useT, type DisplayFormat, type Messages } from '../i18n';
import { paths } from '../paths';
import { Button } from '../ui/Button';
import { TypeGlyph } from '../ui/IssueBadges';
import { VISIBLE_AGES } from './AgeChart';
import { EmptyChart } from './CfdChart';
import { ChartCard, DataTable, Legend } from './ChartParts';
import { dayInZone } from './format';
import { outlineOf } from './palette';
import type { Dimension } from './params';
import { formatReadyAge, spokenReadyAge } from './readyAge';
import { legendOf, seriesOf, type SeriesContext } from './series';
import { SpokenText } from './SpokenText';

/** « 3 des 5 le sont depuis plus de 14 j » : combien de Prêts stagnent, accordé comme le dirait un lecteur. */
function stagnation(stagnant: number, total: number, threshold: string, t: Messages, format: DisplayFormat): string {
  const text = t.metrics.readyAgeChart;
  if (stagnant === 0) return text.noneStale(threshold);
  if (stagnant === total) return total === 1 ? text.onlyOneStale(threshold) : text.allStale(threshold);
  if (stagnant === 1) return text.oneStale(format.formatCount(total), threshold);
  return text.someStale(format.formatCount(stagnant), format.formatCount(total), threshold);
}

export interface ReadyAgePanelProps {
  ages: MetricsReadyAges;
  dimension: Dimension;
  ctx: SeriesContext;
  projectOrder: readonly string[];
  /** Les Projets sont plusieurs : leur nom a un sens. */
  showProject: boolean;
  /** Le fuseau des métriques, pour dire à quel jour un ticket est devenu Prêt. */
  timeZone: string;
  /** L'instant où les Prêts sont mesurés, dit comme la tuile du WIP : « à 20:00 » (période en cours), « à la fin de la période ». */
  moment: string;
}

/**
 * Les Prêts qui stagnent : les tickets ouverts dont aucune dépendance bloquante n'est en suspens, du plus ancien au plus récent,
 * avec le temps écoulé depuis qu'ils le sont, en jours et en heures (`formatReadyAge`) pour qu'on lise de quel côté du seuil ils
 * tombent. Au-delà du seuil (14 jours calendaires), un Prêt stagne : la page le dit en toutes lettres et trace le seuil sur les barres. Comme pour l'âge des tickets en cours, une liste plutôt qu'un dessin : chaque ticket garde son
 * titre lisible et mène à sa fiche, y compris sur mobile. Le tableau des données les donne tous, que la liste en replie ou non.
 */
export function ReadyAgePanel({ ages, dimension, ctx, projectOrder, showProject, timeZone, moment }: ReadyAgePanelProps) {
  const [expanded, setExpanded] = useState(false);
  const t = useT();
  const format = useFormat();
  const { language } = useLanguage();
  const text = t.metrics.readyAgeChart;
  const { tickets, stagnant, stagnantAfter } = ages;
  const series = useMemo(() => legendOf(dimension, tickets, ctx, projectOrder), [dimension, tickets, ctx, projectOrder]);

  const longest = Math.max(0, stagnantAfter, ...tickets.map((ticket) => ticket.age));
  const scale = scaleLinear({ domain: [0, longest * 1.04 || 1], range: [0, 100] });
  const shown = expanded ? tickets : tickets.slice(0, VISIBLE_AGES);
  const hidden = tickets.length - shown.length;
  const threshold = format.formatDuration(stagnantAfter);

  return (
    <ChartCard
      title={text.title}
      description={text.description(moment) + (tickets.length === 0 ? '' : ` ${stagnation(stagnant, tickets.length, threshold, t, format)}`)}
      legend={
        tickets.length === 0 ? undefined : (
          <div className="flex flex-col gap-1">
            <Legend label={t.metrics.chartSeries.colors(t.metrics.chartSeries.dimensions[dimension].toLowerCase())} items={series} />
            <ul aria-label={text.marker} className="flex flex-wrap gap-x-4 gap-y-1 text-micro text-ink-2">
              <li className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-3 w-0 border-l-2 border-dotted border-ink-2" />
                {text.threshold(threshold)}
              </li>
            </ul>
          </div>
        )
      }
      data={tickets.length === 0 ? undefined : <ReadyTable ages={ages} ctx={ctx} showProject={showProject} timeZone={timeZone} moment={moment} />}
    >
      {tickets.length === 0 ? (
        <EmptyChart>{text.empty}</EmptyChart>
      ) : (
        <>
          <ol aria-label={text.list} className="flex flex-col gap-3">
            {shown.map((ticket) => {
              const color = seriesOf(dimension, ticket, ctx).color;
              return (
                <li key={`${ticket.project}/${ticket.id}`} data-ticket={ticket.id} data-stagnant={ticket.stagnant ? '' : undefined}>
                  <Link to={paths.issue(ticket.project, ticket.id)} className="group/age -mx-2 flex flex-col gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-hover">
                    <span className="flex min-w-0 items-center gap-2">
                      <TypeGlyph type={ticket.type} />
                      <span className="min-w-0 flex-1 truncate font-medium text-ink group-hover/age:underline">{ticketTitle(ticket)}</span>
                      <span className="tnum shrink-0 font-semibold text-ink">
                        <SpokenText written={formatReadyAge(ticket.age, stagnantAfter, language)} spoken={spokenReadyAge(ticket.age, stagnantAfter, language)} spelledOut />
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 pl-[22px] text-micro text-ink-3">
                      <span className="min-w-0 break-all font-mono">{ticket.id}</span>
                      {showProject ? <span>{ctx.projectName(ticket.project)}</span> : null}
                      {ticket.stagnant ? <span className="font-medium text-ink-2">{text.stale}</span> : null}
                    </span>
                    <span aria-hidden="true" className="relative block h-2 rounded-full bg-press">
                      <span
                        data-age-bar=""
                        className="absolute inset-y-0 left-0 min-w-0.5 rounded-full border"
                        style={{ width: `${scale(ticket.age)}%`, background: color, borderColor: outlineOf(color) }}
                      />
                      <span data-age-marker="stagnant" className="absolute -inset-y-0.5 w-0 border-l-2 border-dotted border-ink-2" style={{ left: `${scale(stagnantAfter)}%` }} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
          {tickets.length > VISIBLE_AGES ? (
            <Button variant="ghost" className="self-start" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
              {expanded ? t.metrics.chartParts.collapse : t.metrics.chartParts.showMore(format.formatCount(hidden))}
            </Button>
          ) : null}
        </>
      )}
    </ChartCard>
  );
}

function ReadyTable({ ages, ctx, showProject, timeZone, moment }: { ages: MetricsReadyAges; ctx: SeriesContext; showProject: boolean; timeZone: string; moment: string }) {
  const t = useT();
  const format = useFormat();
  const { language } = useLanguage();
  const text = t.metrics.readyAgeChart;
  const columns = t.metrics.chartParts;
  return (
    <DataTable
      caption={text.caption(moment)}
      head={
        <tr>
          <th scope="col" className="px-3 py-1.5 font-medium">
            {columns.ticketColumn}
          </th>
          {showProject ? (
            <th scope="col" className="px-3 py-1.5 font-medium">
              {columns.projectColumn}
            </th>
          ) : null}
          <th scope="col" className="px-3 py-1.5 font-medium">
            {text.sinceColumn}
          </th>
          <th scope="col" className="px-3 py-1.5 text-right font-medium">
            {text.ageColumn}
          </th>
          <th scope="col" className="px-3 py-1.5 font-medium">
            {text.staleColumn}
          </th>
        </tr>
      }
    >
      {ages.tickets.map((ticket) => (
        <tr key={`${ticket.project}/${ticket.id}`}>
          <th scope="row" className="px-3 py-1 text-left font-normal">
            <Link to={paths.issue(ticket.project, ticket.id)} className="flex flex-col text-accent hover:underline">
              {/* Plafonné et coupé comme dans le tableau du Cycle Time (CycleTimeChart.tsx) : bdesk-38k.90. */}
              <span className="max-w-[40ch] wrap-break-word font-mono">{ticket.id}</span>
              <span className="max-w-[28ch] truncate text-ink-2">{ticketTitle(ticket)}</span>
            </Link>
          </th>
          {showProject ? <td className="whitespace-nowrap px-3 py-1">{ctx.projectName(ticket.project)}</td> : null}
          <td className="whitespace-nowrap px-3 py-1 text-ink-2">{format.formatDay(dayInZone(ticket.since, timeZone), { year: true })}</td>
          <td className="whitespace-nowrap px-3 py-1 text-right font-medium">
            <SpokenText written={formatReadyAge(ticket.age, ages.stagnantAfter, language)} spoken={spokenReadyAge(ticket.age, ages.stagnantAfter, language)} />
          </td>
          <td className="whitespace-nowrap px-3 py-1">{ticket.stagnant ? text.yes : text.no}</td>
        </tr>
      ))}
    </DataTable>
  );
}
