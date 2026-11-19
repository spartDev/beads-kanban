import { Link } from 'react-router';
import { baseColumnOf, columnFor } from '../../domain/columns';
import type { EpicProgress } from '../../domain/epics';
import { ticketTitle } from '../data/helpers';
import type { Issue } from '../data/types';
import { typeMeta } from '../design/issue-palette';
import { useFormat, useT, type DisplayFormat, type Messages } from '../i18n';
import { COLUMN_META } from '../kanban/meta';
import { paths } from '../paths';
import { AbandonBadge, DeclineBadge, PriorityBadge, TypeGlyph } from '../ui/IssueBadges';

/** Combien d'identifiants bloquants la ligne nomme avant de compter le reste. */
const NAMED_BLOCKERS = 2;

type Words = Messages['epics']['children'];

/** La colonne d'un ticket écrite pour une ligne, ou « En pause ». Un Statut de relais s'y écrit En cours, comme au tableau (`baseColumnOf`, provisoire). */
function columnLabel(issue: Pick<Issue, 'status' | 'blockedBy'>, words: Words): string {
  const column = columnFor(issue.status, issue.blockedBy.length > 0);
  return column === null ? words.paused : COLUMN_META[baseColumnOf(column)].label;
}

/** Ce qui retient un ticket qui n'est pas fermé : les tickets dont il dépend, ou le seul statut bloqué ; rien sinon. */
function holdingBack(issue: Issue, words: Words, { formatCount }: Pick<DisplayFormat, 'formatCount'>): string | null {
  if (issue.status === 'closed') return null;
  const ids = issue.blockedBy;
  if (ids.length === 0) return issue.status === 'blocked' ? words.statusBlocked : null;
  const named = ids.slice(0, NAMED_BLOCKERS).join(', ');
  return `${words.waitingFor(named)}${ids.length > NAMED_BLOCKERS ? ` +${formatCount(ids.length - NAMED_BLOCKERS)}` : ''}`;
}

/**
 * Un Enfant, en une ligne qui est un seul lien : son panneau (`/p/<projet>/t/<id>`), d'où « Retour » ramène à la page Epic.
 * Une Epic imbriquée, elle, mène à sa propre page, et dit son avancement (`nested`). `showColumn` : la colonne du ticket est
 * écrite sur la ligne, là où l'arborescence ne les groupe pas. `idChars` : la largeur de l'identifiant, en caractères (celle du
 * plus long de la liste) : les titres d'une colonne commencent alors au même endroit ; dès que l'écran est étroit, la ligne passe
 * à la ligne et cette largeur n'y change rien. Elle est plafonnée à la largeur de la ligne (`min(…ch, 100%)`) : un identifiant de 152 caractères
 * ferait 152ch, que la largeur minimale impose avant toute largeur maximale, et la page défilerait d'un côté. Un identifiant plus long que la
 * ligne se coupe où il le faut ; ce qui retient le ticket (« Attend … ») en cite aussi, et se coupe de même, sans que le groupe de droite
 * dépasse la ligne (bdesk-38k.90).
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
  const t = useT();
  const format = useFormat();
  const words = t.epics.children;
  const reason = holdingBack(issue, words, format);
  const closedAge = issue.status === 'closed' && issue.closedAt ? format.formatAge(issue.closedAt, now) : '';
  const isEpic = issue.type === 'epic';

  return (
    <Link
      to={isEpic ? paths.epics(projectId, issue.id) : paths.issue(projectId, issue.id)}
      className="-mx-1.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md px-1.5 py-1 transition-colors hover:bg-hover"
    >
      <TypeGlyph type={issue.type} className="self-center" />
      <span className="sr-only">{typeMeta(issue.type).label}</span>
      <span className="max-w-full shrink-0 wrap-anywhere font-mono text-xs text-ink-3" style={idChars === undefined ? undefined : { minWidth: `min(${idChars}ch, 100%)` }}>
        {issue.id}
      </span>
      {/* Le titre passe à la ligne, sous l'identifiant, quand la place manque : jamais rogné. */}
      <span className="min-w-0 flex-1 basis-40 wrap-anywhere text-ink">{ticketTitle(issue)}</span>
      {issue.abandon ? <AbandonBadge abandon={issue.abandon} className="self-center" /> : null}
      {issue.declined ? <DeclineBadge className="self-center" /> : null}
      <span className="flex max-w-full shrink-0 flex-wrap items-baseline gap-x-2 text-xs text-ink-3">
        {nested ? (
          <span className="tnum">
            {nested.total === 0
              ? t.epics.progress.noChildren
              : t.epics.progress.deliveredOf(format.formatCount(nested.delivered), format.formatCount(nested.total))}
            {nested.total === 0 ? null : <span className="sr-only"> {t.epics.progress.deliveriesSpoken}</span>}
          </span>
        ) : null}
        {reason ? <span className="wrap-anywhere">{reason}</span> : null}
        {issue.assignee ? <span className="wrap-anywhere">{issue.assignee}</span> : null}
        {showColumn && !isEpic ? <span className="sm:w-14">{columnLabel(issue, words)}</span> : null}
        {isEpic ? null : <PriorityBadge priority={issue.priority} className="text-xs sm:w-8" />}
        {closedAge && issue.closedAt ? (
          <time dateTime={issue.closedAt} title={format.formatDateTime(issue.closedAt)} className="sm:w-[4.5rem] sm:text-right">
            <span className="sr-only">{`${words.closed} `}</span>
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
