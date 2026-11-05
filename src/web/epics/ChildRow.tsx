import { Link } from 'react-router';
import { columnFor } from '../../domain/columns';
import type { EpicProgress } from '../../domain/epics';
import { ticketTitle } from '../data/helpers';
import type { Issue } from '../data/types';
import { typeMeta } from '../design/issue-palette';
import { COLUMN_META } from '../kanban/meta';
import { formatAge, formatDateTime } from '../lib/relativeTime';
import { paths } from '../paths';
import { AbandonBadge, PriorityBadge, TypeGlyph } from '../ui/IssueBadges';

/** Combien d'identifiants bloquants la ligne nomme avant de compter le reste. */
const NAMED_BLOCKERS = 2;

/** La colonne d'un ticket écrite pour une ligne, ou « En pause ». */
export function columnLabel(issue: Pick<Issue, 'status' | 'blockedBy'>): string {
  const column = columnFor(issue.status, issue.blockedBy.length > 0);
  return column === null ? 'En pause' : COLUMN_META[column].label;
}

/** Ce qui retient un ticket qui n'est pas fermé : les tickets dont il dépend, ou le seul statut bloqué ; rien sinon. */
function holdingBack(issue: Issue): string | null {
  if (issue.status === 'closed') return null;
  const ids = issue.blockedBy;
  if (ids.length === 0) return issue.status === 'blocked' ? 'Statut bloqué' : null;
  const named = ids.slice(0, NAMED_BLOCKERS).join(', ');
  return `Attend ${named}${ids.length > NAMED_BLOCKERS ? ` +${ids.length - NAMED_BLOCKERS}` : ''}`;
}

/**
 * Un Enfant, en une ligne qui est un seul lien : son panneau (`/p/<projet>/t/<id>`), d'où « Retour » ramène à la page Epic.
 * Une Epic imbriquée, elle, mène à sa propre page, et dit son avancement (`nested`). `showColumn` : la colonne du ticket est
 * écrite sur la ligne, là où l'arborescence ne les groupe pas. `idChars` : la largeur de l'identifiant, en caractères (celle du
 * plus long de la liste) : les titres d'une colonne commencent alors au même endroit ; dès que l'écran est étroit, la ligne passe
 * à la ligne et cette largeur n'y change rien.
 *
 * À droite, ce qui varie d'une ligne à l'autre (ce qui retient le ticket, l'assigné) vient d'abord, et ce qui a une largeur
 * fixe (colonne, priorité, âge de clôture) en dernier : ces cases s'alignent d'une ligne à l'autre sur les écrans larges.
 */
export function ChildRow({
  issue,
  projectId,
  now,
  showColumn = false,
  idChars,
  nested,
}: {
  issue: Issue;
  projectId: string;
  now: number;
  showColumn?: boolean;
  idChars?: number;
  /** L'avancement de l'Epic imbriquée que la ligne représente. */
  nested?: EpicProgress;
}) {
  const reason = holdingBack(issue);
  const closedAge = issue.status === 'closed' && issue.closedAt ? formatAge(issue.closedAt, now) : '';
  const isEpic = issue.type === 'epic';

  return (
    <Link
      to={isEpic ? paths.epics(projectId, issue.id) : paths.issue(projectId, issue.id)}
      className="-mx-1.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md px-1.5 py-1 transition-colors hover:bg-hover"
    >
      <TypeGlyph type={issue.type} className="self-center" />
      <span className="sr-only">{typeMeta(issue.type).label}</span>
      <span className="shrink-0 font-mono text-xs text-ink-3" style={idChars === undefined ? undefined : { minWidth: `${idChars}ch` }}>
        {issue.id}
      </span>
      {/* Le titre passe à la ligne, sous l'identifiant, quand la place manque : jamais rogné. */}
      <span className="min-w-0 flex-1 basis-40 wrap-anywhere text-ink">{ticketTitle(issue)}</span>
      {issue.abandon ? <AbandonBadge abandon={issue.abandon} className="self-center" /> : null}
      <span className="flex shrink-0 flex-wrap items-baseline gap-x-2 text-xs text-ink-3">
        {nested ? (
          <span className="tnum">
            {nested.total === 0 ? 'Aucun Enfant' : `${nested.delivered} sur ${nested.total}`}
            {nested.total === 0 ? null : <span className="sr-only"> Livraisons</span>}
          </span>
        ) : null}
        {reason ? <span>{reason}</span> : null}
        {issue.assignee ? <span className="wrap-anywhere">{issue.assignee}</span> : null}
        {showColumn && !isEpic ? <span className="sm:w-14">{columnLabel(issue)}</span> : null}
        {isEpic ? null : <PriorityBadge priority={issue.priority} className="text-xs sm:w-8" />}
        {closedAge && issue.closedAt ? (
          <time dateTime={issue.closedAt} title={formatDateTime(issue.closedAt)} className="sm:w-[4.5rem] sm:text-right">
            <span className="sr-only">Fermé </span>
            {closedAge}
          </time>
        ) : showColumn ? (
          // Une ligne qui n'est pas fermée garde la place de l'âge : la priorité reste alignée avec celle des lignes fermées.
          <span aria-hidden="true" className="max-sm:hidden sm:w-[4.5rem]" />
        ) : null}
      </span>
    </Link>
  );
}
