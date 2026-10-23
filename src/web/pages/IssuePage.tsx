import { SearchX } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../data/client';
import { useIssue } from '../data/hooks';
import { statusLabel } from '../design/issue-palette';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { paths } from '../paths';
import { PriorityBadge, TypeBadge } from '../ui/IssueBadges';
import { ErrorNotice, Notice, Skeleton } from '../ui/states';
import { ComingSoon, Page } from './Page';
import { useProject } from './ProjectGate';

export function IssuePage() {
  const project = useProject();
  const { issueId = '' } = useParams();
  const query = useIssue(project.id, issueId);
  const issue = query.data;
  // La fiche du parent donne son titre, et son type : une Epic s'ouvre sur la page Epics.
  const parent = useIssue(project.id, issue?.parentId ?? undefined).data;
  useDocumentTitle(issueId, project.name);

  // Sans fiche : chargement, ticket inconnu (404), ou erreur. Avec une fiche, un rafraîchissement raté la garde à l'écran.
  if (!issue) {
    if (query.isPending) {
      return (
        <Page title={<Skeleton className="h-7 w-2/3" />}>
          <div role="status" aria-busy="true" aria-label="Chargement du ticket" className="flex flex-col gap-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </Page>
      );
    }

    if (query.error instanceof ApiError && query.error.status === 404) {
      return (
        <Page title="Ticket introuvable">
          <Notice
            icon={SearchX}
            title={`Aucun ticket « ${issueId} » dans ${project.name}`}
            action={
              <Link to={paths.kanban(project.id)} className="font-medium text-accent hover:underline">
                Retour au kanban
              </Link>
            }
          >
            L’identifiant est peut-être celui d’un autre Projet : la palette (⌘K) peut chercher dans tous les Projets.
          </Notice>
        </Page>
      );
    }

    return (
      <Page title={issueId}>
        <ErrorNotice error={query.error} title="Impossible de charger le ticket" onRetry={() => void query.refetch()} />
      </Page>
    );
  }

  return (
    <Page
      title={
        <>
          <span className="mb-1 block font-mono text-xs font-medium text-ink-3">{issue.id}</span>
          {issue.title}
        </>
      }
    >
      <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 wrap-anywhere text-ink-2">
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Type</dt>
          <dd>
            <TypeBadge type={issue.type} />
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Priorité</dt>
          <dd>
            <PriorityBadge priority={issue.priority} />
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Statut</dt>
          <dd>{statusLabel(issue.status)}</dd>
        </div>
        {issue.assignee ? (
          <div className="flex items-center gap-1.5">
            <dt className="shrink-0 text-ink-3">Assigné à</dt>
            <dd>{issue.assignee}</dd>
          </div>
        ) : null}
        {parent ? (
          <div className="flex min-w-0 items-center gap-1.5">
            <dt className="shrink-0 text-ink-3">Parent</dt>
            <dd className="min-w-0 truncate">
              <Link
                to={parent.type === 'epic' ? paths.epics(project.id, parent.id) : paths.issue(project.id, parent.id)}
                className="hover:text-ink hover:underline"
              >
                <span className="font-mono text-xs">{parent.id}</span> {parent.title}
              </Link>
            </dd>
          </div>
        ) : null}
      </dl>

      <ComingSoon ticket="bdesk-38k.9">
        Le panneau de détail arrive avec « Détail de ticket : panneau latéral, URL partageable, chronologie des Transitions ».
      </ComingSoon>
    </Page>
  );
}
