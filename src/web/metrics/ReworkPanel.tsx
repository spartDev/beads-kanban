import { useState } from 'react';
import { Link } from 'react-router';
import type { MetricsRework, MetricsReworkTicket } from '../../shared/api';
import { ticketTitle } from '../data/helpers';
import { useFormat, useT } from '../i18n';
import { paths } from '../paths';
import { Button } from '../ui/Button';
import { PriorityBadge, TypeGlyph } from '../ui/IssueBadges';
import { EmptyChart } from './CfdChart';
import { ChartCard } from './ChartParts';
import type { SeriesContext } from './series';

/** Combien de tickets la liste montre avant « Afficher les N autres ». */
const VISIBLE_REWORK = 10;

export interface ReworkPanelProps {
  rework: MetricsRework;
  ctx: SeriesContext;
  /** Les Projets sont plusieurs : leur nom a un sens. */
  showProject: boolean;
}

/**
 * Le Retravail de la période : les tickets qui reviennent, chacun avec ce qui l'y met (Réouvertures, Prises rendues, Bugs d'origine). Le Taux de
 * Réouverture et le Taux d'échec en donnent la proportion ; cette liste dit lesquels. Neutre : sans couleur de découpage, le type et la priorité
 * sont sur chaque ligne.
 */
export function ReworkPanel({ rework, ctx, showProject }: ReworkPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const { tickets } = rework;
  const shown = expanded ? tickets : tickets.slice(0, VISIBLE_REWORK);
  const hidden = tickets.length - shown.length;
  const t = useT();
  const { formatCount } = useFormat();
  const texts = t.metrics.rework;

  return (
    <ChartCard title={texts.title} description={texts.description}>
      {tickets.length === 0 ? (
        <EmptyChart>{texts.empty}</EmptyChart>
      ) : (
        <>
          <ul aria-label={texts.list} className="flex flex-col gap-2">
            {shown.map((ticket) => (
              <li key={`${ticket.project}/${ticket.id}`} data-ticket={ticket.id}>
                <Link to={paths.issue(ticket.project, ticket.id)} className="group/rework -mx-2 flex flex-col gap-1 rounded-md px-2 py-1 transition-colors hover:bg-hover">
                  <span className="flex min-w-0 items-center gap-2">
                    <TypeGlyph type={ticket.type} />
                    <span className="min-w-0 flex-1 truncate font-medium text-ink group-hover/rework:underline">{ticketTitle(ticket)}</span>
                    <PriorityBadge priority={ticket.priority} className="shrink-0 text-xs" />
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 pl-[22px] text-micro text-ink-3">
                    <span className="min-w-0 break-all font-mono">{ticket.id}</span>
                    {showProject ? <span>{ctx.projectName(ticket.project)}</span> : null}
                    <span className="font-medium text-ink-2">
                      <Causes ticket={ticket} />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {hidden > 0 || expanded ? (
            <Button variant="ghost" className="self-start" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
              {expanded ? t.metrics.chartParts.collapse : t.metrics.chartParts.showMore(formatCount(hidden))}
            </Button>
          ) : null}
        </>
      )}
    </ChartCard>
  );
}

/** Ce qui met le ticket en Retravail : « 2 Réouvertures, 1 Prise rendue, Bug d’origine bdesk-b9 ». */
function Causes({ ticket: { reopenings, returns, originBugs } }: { ticket: MetricsReworkTicket }) {
  const t = useT();
  const { formatCount } = useFormat();
  const texts = t.metrics.rework;
  const causes: string[] = [];
  if (reopenings > 0) causes.push(texts.reopens(reopenings, formatCount(reopenings)));
  if (returns > 0) causes.push(texts.handbacks(returns, formatCount(returns)));
  // Les identifiants des bugs sont du contenu de ticket : jamais traduits, joints comme une liste.
  if (originBugs.length > 0) causes.push(texts.escapedBugs(originBugs.length, originBugs.join(texts.separator)));
  return <>{causes.join(texts.separator)}</>;
}
