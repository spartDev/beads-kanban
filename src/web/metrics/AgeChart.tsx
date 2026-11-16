import { scaleLinear } from '@visx/scale';
import { CircleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { MetricsInProgressTicket } from '../../shared/api';
import { ticketTitle } from '../data/helpers';
import { useFormat, useT } from '../i18n';
import { paths } from '../paths';
import { Button } from '../ui/Button';
import { TypeGlyph } from '../ui/IssueBadges';
import { ChartCard, Legend } from './ChartParts';
import { EmptyChart } from './CfdChart';
import { outlineOf } from './palette';
import type { Dimension } from './params';
import { legendOf, seriesOf, type SeriesContext } from './series';
import { SpokenText } from './SpokenText';

/** Combien de tickets montrer avant « Afficher les autres » : un WIP raisonnable tient en entier. */
export const VISIBLE_AGES = 12;

export interface AgePanelProps {
  tickets: readonly MetricsInProgressTicket[];
  dimension: Dimension;
  ctx: SeriesContext;
  projectOrder: readonly string[];
  /** Médiane et P85 du Cycle Time de la période : repères pour juger l'âge d'un ticket encore en cours. */
  median: number | null;
  p85: number | null;
  showProject: boolean;
}

/**
 * L'âge des tickets en cours : le temps écoulé depuis leur premier passage en statut de travail, du plus ancien au plus
 * récent. Un ticket en cours depuis plus longtemps que le P85 du Cycle Time dure plus que 85 % des Livraisons de la
 * période : ce sont ceux que l'on regarde d'abord. Une liste de barres plutôt qu'un dessin : chaque ticket garde son
 * titre lisible et mène à sa fiche, y compris sur mobile.
 */
export function AgePanel({ tickets, dimension, ctx, projectOrder, median, p85, showProject }: AgePanelProps) {
  const [expanded, setExpanded] = useState(false);
  const t = useT();
  const format = useFormat();
  const text = t.metrics.ageChart;
  const series = useMemo(() => legendOf(dimension, tickets, ctx, projectOrder), [dimension, tickets, ctx, projectOrder]);

  const references = [median, p85].filter((value): value is number => value !== null);
  const longest = Math.max(0, ...tickets.map((ticket) => ticket.age), ...references);
  const scale = scaleLinear({ domain: [0, longest * 1.04 || 1], range: [0, 100] });

  const shown = expanded ? tickets : tickets.slice(0, VISIBLE_AGES);
  const hidden = tickets.length - shown.length;

  return (
    <ChartCard
      title={text.title}
      description={text.description(format.formatCount(tickets.length), tickets.length)}
      legend={
        tickets.length === 0 ? undefined : (
          <div className="flex flex-col gap-1">
            <Legend label={t.metrics.chartSeries.colors(t.metrics.chartSeries.dimensions[dimension].toLowerCase())} items={series} />
            {references.length > 0 ? (
              <ul aria-label={text.markers} className="flex flex-wrap gap-x-4 gap-y-1 text-micro text-ink-2">
                {median !== null ? <Marker label={text.median(format.formatDuration(median))} spoken={text.median(format.spokenDuration(median))} /> : null}
                {p85 !== null ? <Marker label={text.p85(format.formatDuration(p85))} spoken={text.p85(format.spokenDuration(p85))} dotted /> : null}
              </ul>
            ) : null}
          </div>
        )
      }
    >
      {tickets.length === 0 ? (
        <EmptyChart>{text.empty}</EmptyChart>
      ) : (
        <>
          <ol aria-label={text.list} className="flex flex-col gap-3">
            {shown.map((ticket) => {
              const color = seriesOf(dimension, ticket, ctx).color;
              const beyond = p85 !== null && ticket.age > p85;
              return (
                <li key={`${ticket.project}/${ticket.id}`} data-ticket={ticket.id}>
                  <Link
                    to={paths.issue(ticket.project, ticket.id)}
                    className="group/age -mx-2 flex flex-col gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-hover"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <TypeGlyph type={ticket.type} />
                      <span className="min-w-0 flex-1 truncate font-medium text-ink group-hover/age:underline">{ticketTitle(ticket)}</span>
                      <span className="tnum shrink-0 font-semibold text-ink">
                        <SpokenText written={format.formatDuration(ticket.age)} spoken={format.spokenDuration(ticket.age)} spelledOut />
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 pl-[22px] text-micro text-ink-3">
                      <span className="min-w-0 break-all font-mono">{ticket.id}</span>
                      {showProject ? <span>{ctx.projectName(ticket.project)}</span> : null}
                      {ticket.blocked ? (
                        <span className="inline-flex items-center gap-1 text-danger">
                          <CircleAlert size={11} aria-hidden="true" />
                          {text.blocked}
                        </span>
                      ) : null}
                      {ticket.status === 'hooked' ? <span>{text.agent}</span> : null}
                      {beyond ? <span className="text-ink-2">{text.beyondP85}</span> : null}
                    </span>
                    <span aria-hidden="true" className="relative block h-2 rounded-full bg-press">
                      <span
                        data-age-bar=""
                        className="absolute inset-y-0 left-0 min-w-0.5 rounded-full border"
                        style={{ width: `${scale(ticket.age)}%`, background: color, borderColor: outlineOf(color) }}
                      />
                      {median !== null ? <span data-age-marker="median" className="absolute -inset-y-0.5 w-0 border-l border-dashed border-ink-2" style={{ left: `${scale(median)}%` }} /> : null}
                      {p85 !== null ? <span data-age-marker="p85" className="absolute -inset-y-0.5 w-0 border-l-2 border-dotted border-ink-2" style={{ left: `${scale(p85)}%` }} /> : null}
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

/**
 * Un repère : son trait, puis son étiquette (`label` s'écrit, `spoken` se dit : « < 1 min » ne se lit pas tel quel). L'étiquette est
 * dite en UNE phrase, pas en morceaux : le <li> est un conteneur flex, qui sépare chaque enfant du suivant par l'écart.
 */
function Marker({ label, spoken, dotted = false }: { label: string; spoken: string; dotted?: boolean }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={dotted ? 'h-3 w-0 border-l-2 border-dotted border-ink-2' : 'h-3 w-0 border-l border-dashed border-ink-2'} />
      <SpokenText written={label} spoken={spoken} />
    </li>
  );
}
