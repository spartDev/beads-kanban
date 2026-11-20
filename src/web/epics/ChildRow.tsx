import { Link } from 'react-router';
import { columnFor } from '../../domain/columns';
import type { EpicProgress } from '../../domain/epics';
import { ticketTitle } from '../data/helpers';
import type { DeclaredStatuses, Issue } from '../data/types';
import { typeMeta } from '../design/issue-palette';
import { useFormat, useLanguage, useT, type DisplayFormat, type Language, type Messages } from '../i18n';
import type { ColumnId } from '../kanban/columns';
import { columnMeta } from '../kanban/meta';
import { paths } from '../paths';
import { AbandonBadge, DeclineBadge, PriorityBadge, TypeGlyph } from '../ui/IssueBadges';

/** Combien d'identifiants bloquants la ligne nomme avant de compter le reste. */
const NAMED_BLOCKERS = 2;

type Words = Messages['epics']['children'];

/**
 * La colonne d'un ticket écrite pour une ligne, ou « En pause », avec les statuts que le Projet déclare : un statut qu'il déclare `wip` s'y écrit En
 * cours, comme au tableau et au CFD. Un Statut de relais s'y écrit du nom de sa colonne (En relecture, En intégration, À valider), et Bloqué en Blocage.
 * Dans la langue de l'interface.
 */
function columnLabel(issue: Pick<Issue, 'status' | 'blockedBy'>, words: Words, declared: DeclaredStatuses, language: Language): string {
  const column = columnFor(issue.status, issue.blockedBy.length > 0, declared);
  return column === null ? words.paused : columnMeta(language)[column].label;
}

/** Les largeurs de la case de la colonne d'une ligne, de la plus étroite à la plus large ; la première est celle d'avant les Statuts de relais. */
const CHILD_COLUMN_WIDTHS = ['sm:w-14', 'sm:w-16', 'sm:w-17', 'sm:w-19', 'sm:w-26'] as const;
type ChildColumnWidth = (typeof CHILD_COLUMN_WIDTHS)[number];

/** Celle qu'il faut au nom d'une colonne, dans chaque langue, quand `sm:w-14` ne lui suffit pas ; « En pause » y tient dans les deux. */
const WIDER_LABELS: Readonly<Record<Language, Partial<Record<ColumnId, ChildColumnWidth>>>> = {
  fr: { inReview: 'sm:w-17', inIntegration: 'sm:w-19' },
  en: { inProgress: 'sm:w-16', inReview: 'sm:w-16', inIntegration: 'sm:w-19', awaitingHuman: 'sm:w-26' },
};

/**
 * La largeur de la case de la colonne d'une ligne, à partir de `sm` : une largeur fixe, pour que les noms, la priorité et l'âge qui les suivent
 * s'alignent d'une ligne à l'autre ; celle du plus long nom des colonnes du Projet (`boardColumns`, celles de son tableau) et d'« En pause », dans la
 * langue de l'interface. En français, un Projet sans colonne de relais garde celle d'avant (`sm:w-14`). childColumnWidth.test.ts mesure chaque nom
 * contre elle, pour chaque jeu de colonnes de relais et chaque langue.
 */
export function childColumnWidth(columns: readonly ColumnId[], language: Language): ChildColumnWidth {
  const widest = Math.max(0, ...columns.map((id) => CHILD_COLUMN_WIDTHS.indexOf(WIDER_LABELS[language][id] ?? 'sm:w-14')));
  return CHILD_COLUMN_WIDTHS[widest] as ChildColumnWidth;
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
 * écrite sur la ligne, là où l'arborescence ne les groupe pas ; elle exige alors `declared`, les statuts que le Projet déclare, et `columns`, les
 * colonnes de son tableau, qui donnent la largeur de sa case (`childColumnWidth`). `idChars` : la largeur de l'identifiant, en caractères (celle du
 * plus long de la liste) : les titres d'une colonne commencent alors au même endroit ; dès que l'écran est étroit, la ligne passe
 * à la ligne et cette largeur n'y change rien. Elle est plafonnée à la largeur de la ligne (`min(…ch, 100%)`) : un identifiant de 152 caractères
 * ferait 152ch, que la largeur minimale impose avant toute largeur maximale, et la page défilerait d'un côté. Un identifiant plus long que la
 * ligne se coupe où il le faut ; ce qui retient le ticket (« Attend … ») en cite aussi, et se coupe de même, sans que le groupe de droite
 * dépasse la ligne (bdesk-38k.90).
 *
 * À droite, ce qui varie d'une ligne à l'autre (ce qui retient le ticket, l'assigné) vient d'abord, et ce qui a une largeur
 * fixe (colonne, priorité, âge de clôture) en dernier : ces cases s'alignent d'une ligne à l'autre sur les écrans larges.
 */
export function ChildRow(
  props: {
    issue: Issue;
    projectId: string;
    now: number;
    idChars?: number;
    /** L'avancement de l'Epic imbriquée que la ligne représente. */
    nested?: EpicProgress;
  } & ({ showColumn: true; declared: DeclaredStatuses; columns: readonly ColumnId[] } | { showColumn?: false; declared?: never; columns?: never }),
) {
  const { issue, projectId, now, idChars, nested } = props;
  const t = useT();
  const { language } = useLanguage();
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
        {/* Une largeur fixe, selon les colonnes du Projet : les noms s'alignent d'une ligne à l'autre (`childColumnWidth`). */}
        {props.showColumn && !isEpic ? (
          <span className={childColumnWidth(props.columns, language)}>{columnLabel(issue, words, props.declared, language)}</span>
        ) : null}
        {isEpic ? null : <PriorityBadge priority={issue.priority} className="text-xs sm:w-8" />}
        {closedAge && issue.closedAt ? (
          <time dateTime={issue.closedAt} title={format.formatDateTime(issue.closedAt)} className="sm:w-[4.5rem] sm:text-right">
            <span className="sr-only">{`${words.closed} `}</span>
            {closedAge}
          </time>
        ) : props.showColumn ? (
          // Une ligne qui n'est pas fermée garde la place de l'âge : la priorité reste alignée avec celle des lignes fermées.
          <span aria-hidden="true" className="max-sm:hidden sm:w-[4.5rem]" />
        ) : null}
      </span>
    </Link>
  );
}
