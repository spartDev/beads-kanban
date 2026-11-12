import { Zap } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { epicChildren, epicOf, epicProgress, type EpicProgress } from '../../domain/epics';
import type { Issue } from '../data/types';
import { isEpic, ticketTitle } from '../data/helpers';
import { epicChoices, epicName, indexById } from '../kanban/epics';
import { formatPercent } from '../metrics/format';
import { paths } from '../paths';
import { TypeGlyph } from '../ui/IssueBadges';
import { Notice } from '../ui/states';
import { progressSentence } from './ProgressSection';
import { counted, ProgressBar } from './ProgressBar';

/** Une Epic de la liste : son titre, son identifiant et son avancement, le tout un lien vers sa page. */
function EpicItem({ projectId, epic, progress }: { projectId: string; epic: Issue; progress: EpicProgress }) {
  return (
    <Link
      to={paths.epics(projectId, epic.id)}
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-line p-3 transition-colors hover:border-line-strong hover:bg-hover"
    >
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <TypeGlyph type="epic" className="self-center" />
        <span className="sr-only">Epic</span>
        {/* Entier tant que la ligne le porte, coupé où il le faut au-delà, plafonné à sa largeur : voir Relations.tsx (bdesk-38k.90). */}
        <span className="max-w-full shrink-0 wrap-anywhere font-mono text-xs text-ink-3">{epic.id}</span>
        <span className="min-w-0 flex-1 basis-40 wrap-anywhere font-medium text-ink">{ticketTitle(epic)}</span>
        {epic.status === 'closed' ? <span className="shrink-0 text-xs text-ink-3">fermée</span> : null}
      </span>
      {progress.total === 0 ? (
        <span className="text-xs text-ink-3">{progress.children === 0 ? 'Aucun Enfant' : `Aucun Enfant à livrer (${counted(progress.abandoned, 'Abandon')})`}</span>
      ) : (
        <span className="flex items-center gap-3">
          <ProgressBar delivered={progress.delivered} total={progress.total} label={`Avancement de ${epicName(epic)}`} valueText={progressSentence(progress)} className="flex-1" />
          <span className="tnum shrink-0 text-xs text-ink-2">
            {progress.delivered} sur {progress.total}
            <span className="sr-only"> Livraisons</span>
            <span className="text-ink-3"> · {formatPercent(progress.ratio)}</span>
          </span>
        </span>
      )}
    </Link>
  );
}

/**
 * La liste des Epics du Projet : chacune avec son avancement, les ouvertes avant les fermées. Une Epic mène à sa page.
 * Le décompte compte les tickets qui ont une Epic parmi leurs ancêtres, une fois chacun, comme la pastille du kanban.
 */
export function EpicList({ projectId, issues }: { projectId: string; issues: readonly Issue[] }) {
  const choices = useMemo(() => epicChoices(issues), [issues]);
  const progressById = useMemo(
    () => new Map([...choices.open, ...choices.closed].map((epic) => [epic.id, epicProgress(epicChildren(epic.id, issues).children)])),
    [choices, issues],
  );
  const grouped = useMemo(() => {
    const byId = indexById(issues);
    return issues.filter((issue) => !isEpic(issue) && epicOf(issue, byId) !== null).length;
  }, [issues]);
  const epics = choices.open.length + choices.closed.length;

  if (epics === 0) {
    return (
      <Notice icon={Zap} title="Aucune Epic dans ce Projet">
        Une Epic est un ticket de type epic : <code>bd create --type epic</code>.
      </Notice>
    );
  }

  const list = (label: string, items: Issue[]) =>
    items.length === 0 ? null : (
      <ul aria-label={label} className="flex flex-col gap-2">
        {items.map((epic) => (
          <li key={epic.id} className="min-w-0">
            <EpicItem projectId={projectId} epic={epic} progress={progressById.get(epic.id) ?? epicProgress([])} />
          </li>
        ))}
      </ul>
    );

  return (
    <div className="flex flex-col gap-4">
      <p className="tnum text-ink-2">
        {`${counted(epics, 'Epic')} regroupant ${counted(grouped, 'Enfant')}`}
      </p>
      {list('Epics ouvertes', choices.open)}
      {list('Epics fermées', choices.closed)}
    </div>
  );
}
