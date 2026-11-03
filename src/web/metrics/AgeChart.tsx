import { scaleLinear } from '@visx/scale';
import { CircleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { MetricsInProgressTicket } from '../../shared/api';
import { paths } from '../paths';
import { Button } from '../ui/Button';
import { TypeGlyph } from '../ui/IssueBadges';
import { ChartCard, Legend } from './ChartParts';
import { EmptyChart } from './CfdChart';
import { formatCount, formatDuration, spokenDuration } from './format';
import { outlineOf } from './palette';
import type { Dimension } from './params';
import { DIMENSION_LABELS, legendOf, seriesOf, type SeriesContext } from './series';

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
  const series = useMemo(() => legendOf(dimension, tickets, ctx, projectOrder), [dimension, tickets, ctx, projectOrder]);

  const references = [median, p85].filter((value): value is number => value !== null);
  const longest = Math.max(0, ...tickets.map((ticket) => ticket.age), ...references);
  const scale = scaleLinear({ domain: [0, longest * 1.04 || 1], range: [0, 100] });

  const shown = expanded ? tickets : tickets.slice(0, VISIBLE_AGES);
  const hidden = tickets.length - shown.length;

  return (
    <ChartCard
      title="Âge des tickets en cours"
      description={`Depuis leur premier passage en statut de travail, du plus ancien au plus récent. ${formatCount(tickets.length)} ${tickets.length > 1 ? 'tickets' : 'ticket'} en cours.`}
      legend={
        tickets.length === 0 ? undefined : (
          <div className="flex flex-col gap-1">
            <Legend label={`Couleurs : ${DIMENSION_LABELS[dimension].toLowerCase()}`} items={series} />
            {references.length > 0 ? (
              <ul aria-label="Repères" className="flex flex-wrap gap-x-4 gap-y-1 text-micro text-ink-2">
                {median !== null ? <Marker label={`Médiane du Cycle Time ${formatDuration(median)}`} /> : null}
                {p85 !== null ? <Marker label={`P85 ${formatDuration(p85)}`} dotted /> : null}
              </ul>
            ) : null}
          </div>
        )
      }
    >
      {tickets.length === 0 ? (
        <EmptyChart>Aucun ticket en cours.</EmptyChart>
      ) : (
        <>
          <ol aria-label="Tickets en cours, du plus ancien au plus récent" className="flex flex-col gap-3">
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
                      <span className="min-w-0 flex-1 truncate font-medium text-ink group-hover/age:underline">{ticket.title}</span>
                      <span className="tnum shrink-0 font-semibold text-ink">
                        {formatDuration(ticket.age)}
                        <span className="sr-only"> ({spokenDuration(ticket.age)})</span>
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 pl-[22px] text-micro text-ink-3">
                      <span className="min-w-0 break-all font-mono">{ticket.id}</span>
                      {showProject ? <span>{ctx.projectName(ticket.project)}</span> : null}
                      {ticket.blocked ? (
                        <span className="inline-flex items-center gap-1 text-danger">
                          <CircleAlert size={11} aria-hidden="true" />
                          Bloqué
                        </span>
                      ) : null}
                      {ticket.status === 'hooked' ? <span>Agent</span> : null}
                      {beyond ? <span className="text-ink-2">au-delà du P85</span> : null}
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
              {expanded ? 'Réduire la liste' : `Afficher les ${hidden} autres`}
            </Button>
          ) : null}
        </>
      )}
    </ChartCard>
  );
}

function Marker({ label, dotted = false }: { label: string; dotted?: boolean }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={dotted ? 'h-3 w-0 border-l-2 border-dotted border-ink-2' : 'h-3 w-0 border-l border-dashed border-ink-2'} />
      {label}
    </li>
  );
}
