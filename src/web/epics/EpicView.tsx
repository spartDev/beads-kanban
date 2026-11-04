import { useCallback, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { epicChildren, epicProgress, epicTree, groupByColumn } from '../../domain/epics';
import type { Issue, Project } from '../data/types';
import { statusLabel } from '../design/issue-palette';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useNow } from '../lib/useNow';
import { Page, SectionTitle } from '../pages/Page';
import { paths } from '../paths';
import { PriorityBadge, TypeBadge } from '../ui/IssueBadges';
import { BackToEpics } from './BackToEpics';
import { ByColumn } from './ByColumn';
import { ProgressSection } from './ProgressSection';
import { TimeSection } from './TimeSection';
import { Tree } from './Tree';
import { parseView, VIEW_PARAM, type EpicView } from './view';
import { ViewSwitch } from './ViewSwitch';

const LINK = 'font-medium text-accent hover:underline';

/**
 * La page d'une Epic (`/p/<projet>/epics?epic=<id>`) : son avancement (les Livraisons parmi ses Enfants, en nombre), son Lead
 * Time et la prévision de sa fin, puis ses Enfants, par colonne ou en arbre. Tout se calcule des tickets du Projet, ceux que
 * le kanban a déjà : rien de plus à lire, et les mises à jour en direct la tiennent à jour comme lui.
 *
 * Les Enfants sont les mêmes que ceux du filtre Epic du kanban (`epicChildren`), rangés par la même règle de colonne
 * (`columnFor`). L'affichage choisi vit dans l'adresse (`?view=tree`), pour qu'un lien le partage.
 */
export function EpicView({ project, epic, issues }: { project: Project; epic: Issue; issues: readonly Issue[] }) {
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const view = parseView(params.get(VIEW_PARAM));
  useDocumentTitle(epic.title, project.name);

  // D'une Epic à l'autre (le lien d'une Epic imbriquée), la page est la même et le panneau de contenu du shell garde son
  // défilement : on repart du haut, comme pour une nouvelle page. Changer seulement d'affichage ne touche à rien.
  useEffect(() => {
    const content = document.getElementById('contenu');
    if (content) content.scrollTop = 0;
  }, [epic.id]);

  const { children, epics: nestedEpics } = useMemo(() => epicChildren(epic.id, issues), [epic.id, issues]);
  const progress = useMemo(() => epicProgress(children), [children]);
  const groups = useMemo(() => groupByColumn(children), [children]);
  const tree = useMemo(() => epicTree(epic.id, issues), [epic.id, issues]);
  const progressOf = useCallback((epicId: string) => epicProgress(epicChildren(epicId, issues).children), [issues]);

  // Chaque changement remplace l'entrée de l'historique : « Retour » quitte la page, il ne rejoue pas les bascules.
  const setView = (next: EpicView) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        if (next === 'tree') updated.set(VIEW_PARAM, 'tree');
        else updated.delete(VIEW_PARAM);
        return updated;
      },
      { replace: true },
    );

  return (
    <Page title={epic.title} eyebrow={<BackToEpics projectId={project.id} />}>
      <div className="flex flex-col gap-2">
        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-ink-2">
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Type</dt>
            <dd>
              <TypeBadge type="epic" />
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Identifiant</dt>
            <dd className="wrap-anywhere font-mono text-xs text-ink-3">{epic.id}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Priorité</dt>
            <dd>
              <PriorityBadge priority={epic.priority} />
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Statut</dt>
            <dd>{statusLabel(epic.status)}</dd>
          </div>
        </dl>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <Link to={paths.issue(project.id, epic.id)} className={LINK}>
            Ouvrir le ticket
          </Link>
          <Link to={paths.kanban(project.id, epic.id)} className={LINK}>
            Voir au kanban
          </Link>
        </p>
      </div>

      <ProgressSection progress={progress} groups={groups} />
      <TimeSection epic={epic} kids={children} now={now} />

      {children.length + nestedEpics.length > 0 ? (
        <section aria-labelledby="epic-children" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionTitle id="epic-children">Enfants</SectionTitle>
            <ViewSwitch value={view} onChange={setView} />
          </div>
          {view === 'tree' ? (
            <Tree nodes={tree} projectId={project.id} now={now} progressOf={progressOf} />
          ) : (
            <ByColumn groups={groups} nestedEpics={nestedEpics} projectId={project.id} now={now} progressOf={progressOf} />
          )}
        </section>
      ) : null}
    </Page>
  );
}
