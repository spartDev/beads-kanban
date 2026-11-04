import { Bot, Clock, Lock } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import type { Issue } from '../data/types';
import { statusLabel, typeMeta } from '../design/issue-palette';
import { formatAge, formatDateTime } from '../lib/relativeTime';
import { parsePath, paths } from '../paths';
import { PriorityBadge, TypeGlyph } from '../ui/IssueBadges';
import type { Lane } from './columns';
import { shortTitle } from './epics';

/** Combien d'identifiants bloquants la carte nomme avant de compter le reste. */
const NAMED_BLOCKERS = 2;

/**
 * Une carte : un ticket, cliquable en entier. Le lien est celui du titre, étiré sur toute la carte (`after:inset-0`) ;
 * ce qui est lui-même un lien (la pastille d'Epic) passe au-dessus (`z-10`). Le focus au clavier entoure la carte.
 * Aucun glisser-déposer : le kanban est en lecture seule.
 */
export function Card({
  issue,
  lane,
  projectId,
  epic,
  now,
}: {
  issue: Issue;
  /** La colonne de la carte, ou `paused` dans le tiroir. */
  lane: Lane;
  projectId: string;
  /** L'Epic de la carte, pour sa pastille. */
  epic: Issue | null;
  now: number;
}) {
  const dated = lane === 'done' ? (issue.closedAt ?? issue.updatedAt) : issue.updatedAt;
  const age = formatAge(dated, now);
  // Le ticket s'ouvre par-dessus ce tableau : son adresse garde les réglages du tableau (`?epic=`, `?done=`, `?col=`), et
  // une carte ouverte pendant qu'un ticket l'est déjà remplace son entrée d'historique (« Retour » ferme le panneau).
  const { pathname, search } = useLocation();
  const panelOpen = parsePath(pathname).section === 'issue';

  return (
    <li
      data-card-id={issue.id}
      data-column={lane}
      className="relative flex scroll-mb-20 scroll-mt-28 flex-col gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-2 shadow-panel transition-colors hover:border-line-strong has-[a[data-card-link]:focus-visible]:border-accent has-[a[data-card-link]:focus-visible]:ring-2 has-[a[data-card-link]:focus-visible]:ring-accent"
    >
      <div className="flex min-w-0 items-start gap-1.5">
        <span className="mt-0.5 shrink-0">
          <TypeGlyph type={issue.type} />
          <span className="sr-only">{typeMeta(issue.type).label} </span>
        </span>
        <span className="min-w-0 flex-1 wrap-anywhere font-mono text-xs leading-5 text-ink-3">{issue.id}</span>
        <PriorityBadge priority={issue.priority} className="shrink-0 text-xs leading-5" />
      </div>

      <p className="wrap-anywhere text-ui text-ink">
        <Link
          to={{ pathname: paths.issue(projectId, issue.id), search }}
          replace={panelOpen}
          data-card-link={issue.id}
          className="outline-none after:absolute after:inset-0 after:rounded-lg"
        >
          {issue.title}
        </Link>
      </p>

      {issue.status === 'hooked' || epic ? (
        // Les pastilles passent à la ligne plutôt que de serrer l'identifiant, qui ne doit jamais se couper en deux.
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {issue.status === 'hooked' ? <AgentBadge /> : null}
          {epic ? <EpicPill projectId={projectId} epic={epic} /> : null}
        </div>
      ) : null}
      <Blocking issue={issue} />
      {lane === 'paused' ? (
        <p className="self-start rounded-full border border-line px-1.5 text-xs leading-5 text-ink-2">{statusLabel(issue.status)}</p>
      ) : null}

      {issue.assignee || age ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-ink-3">
          {issue.assignee ? <span className="min-w-0 wrap-anywhere">{issue.assignee}</span> : null}
          {age ? (
            <time
              dateTime={dated}
              title={formatDateTime(dated)}
              className="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap"
            >
              <Clock size={11} aria-hidden="true" />
              <span className="sr-only">{lane === 'done' ? 'Fermé' : 'Mis à jour'} </span>
              {age}
            </time>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** Ticket rattaché à un agent (statut `hooked`). */
function AgentBadge() {
  return (
    <span
      title="Rattaché à un agent"
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-1.5 text-micro font-medium text-accent"
    >
      <Bot size={11} aria-hidden="true" />
      agent
    </span>
  );
}

/** Pastille de l'Epic : son titre court, et un lien vers elle. Le titre entier est en infobulle. */
function EpicPill({ projectId, epic }: { projectId: string; epic: Issue }) {
  return (
    <Link
      to={paths.epics(projectId, epic.id)}
      title={epic.title}
      className="relative z-10 inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-well px-1.5 py-px text-xs text-ink-2 transition-colors hover:text-ink"
    >
      <TypeGlyph type="epic" size={12} />
      <span className="sr-only">Epic :</span> <span className="min-w-0 truncate">{shortTitle(epic.title)}</span>
    </Link>
  );
}

/** Ce qui retient le ticket : les tickets dont il dépend, ou le seul statut bloqué. */
function Blocking({ issue }: { issue: Issue }) {
  const ids = issue.blockedBy;
  if (ids.length === 0) return issue.status === 'blocked' ? <Reason>Statut bloqué</Reason> : null;
  const named = ids.slice(0, NAMED_BLOCKERS);
  const rest = ids.length - named.length;
  return (
    <Reason title={`Attend ${ids.join(', ')}`}>
      Attend{' '}
      {named.map((id, index) => (
        <Fragment key={id}>
          {index > 0 ? ', ' : null}
          <span className="font-mono">{id}</span>
        </Fragment>
      ))}
      {rest > 0 ? <span className="text-ink-3"> +{rest}</span> : null}
    </Reason>
  );
}

function Reason({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <p title={title} className="flex items-start gap-1 text-xs leading-5 text-ink-2">
      <Lock size={12} aria-hidden="true" className="mt-1 shrink-0 text-ink-3" />
      <span className="min-w-0 wrap-anywhere">{children}</span>
    </p>
  );
}
