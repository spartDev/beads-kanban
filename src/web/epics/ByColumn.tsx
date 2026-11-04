import { CirclePause, Layers, type LucideIcon } from 'lucide-react';
import { EPIC_GROUPS, type EpicGroup, type EpicProgress } from '../../domain/epics';
import type { Issue } from '../data/types';
import { compareClosed, compareIssues } from '../kanban/columns';
import { COLUMN_META, ticketNoun } from '../kanban/meta';
import { cx } from '../lib/cx';
import { ChildRow } from './ChildRow';
import { counted } from './ProgressBar';

/** Le titre et le pictogramme d'un groupe : ceux de la colonne du kanban, plus « En pause ». */
export function groupMeta(group: EpicGroup): { label: string; icon: LucideIcon } {
  return group === 'paused' ? { label: 'En pause', icon: CirclePause } : COLUMN_META[group];
}

const idOf = (group: EpicGroup, part: 'title' | 'count') => `epic-group-${group}-${part}`;

/**
 * Les Enfants rangés par colonne, dans l'ordre du flux, les colonnes vides omises. Chaque colonne est rangée comme sur le
 * tableau : par priorité puis par mise à jour, et Terminé par clôture, la plus récente d'abord. Terminé garde tous les Enfants
 * fermés, sans la fenêtre de jours du tableau (une Epic se lit de bout en bout), et dit combien sont des Abandons.
 */
export function ByColumn({
  groups,
  nestedEpics,
  projectId,
  now,
  progressOf,
}: {
  groups: Record<EpicGroup, Issue[]>;
  nestedEpics: Issue[];
  projectId: string;
  now: number;
  progressOf: (epicId: string) => EpicProgress;
}) {
  // Les titres d'une colonne commencent au même endroit : l'identifiant a la largeur du plus long de la page.
  const idChars = [...EPIC_GROUPS.flatMap((group) => groups[group]), ...nestedEpics].reduce((longest, { id }) => Math.max(longest, id.length), 0);
  return (
    <div className="flex flex-col gap-5">
      {EPIC_GROUPS.map((group) => {
        const issues = [...groups[group]].sort(group === 'done' ? compareClosed : compareIssues);
        if (issues.length === 0) return null;
        const { label, icon: Icon } = groupMeta(group);
        const abandons = issues.filter((issue) => issue.abandon).length;
        return (
          <section
            key={group}
            aria-labelledby={idOf(group, 'title')}
            aria-describedby={idOf(group, 'count')}
            data-epic-group={group}
            className="flex flex-col gap-1"
          >
            <h3 className="flex flex-wrap items-center gap-x-2 text-ui font-semibold text-ink">
              <Icon size={14} strokeWidth={2} aria-hidden="true" className={cx('shrink-0', group === 'blocked' ? 'text-danger' : 'text-ink-3')} />
              <span id={idOf(group, 'title')}>{label}</span>
              <span id={idOf(group, 'count')} className="tnum text-xs font-normal text-ink-2">
                {issues.length}
                <span className="sr-only"> {ticketNoun(issues.length)}</span>
              </span>
              {abandons > 0 ? <span className="text-xs font-normal text-ink-3">dont {counted(abandons, 'Abandon')}</span> : null}
            </h3>
            <ul className="flex flex-col">
              {issues.map((issue) => (
                <li key={issue.id} className="min-w-0">
                  <ChildRow issue={issue} projectId={projectId} now={now} idChars={idChars} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {nestedEpics.length > 0 ? (
        <section aria-labelledby="epic-nested-title" className="flex flex-col gap-1">
          <h3 className="flex items-center gap-2 text-ui font-semibold text-ink">
            <Layers size={14} strokeWidth={2} aria-hidden="true" className="shrink-0 text-ink-3" />
            <span id="epic-nested-title">Epics imbriquées</span>
            <span className="tnum text-xs font-normal text-ink-2">{nestedEpics.length}</span>
          </h3>
          <ul className="flex flex-col">
            {nestedEpics.map((epic) => (
              <li key={epic.id} className="min-w-0">
                <ChildRow issue={epic} projectId={projectId} now={now} idChars={idChars} nested={progressOf(epic.id)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
