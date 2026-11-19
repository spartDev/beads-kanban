import { FolderSearch, Inbox } from 'lucide-react';
import { Link } from 'react-router';
import { ApiError } from '../data/client';
import { useIssues } from '../data/hooks';
import { projectInSentence } from '../data/projectNames';
import { Board } from '../kanban/Board';
import { BoardSkeleton } from '../kanban/BoardSkeleton';
import { useT } from '../i18n';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useRetryFocus } from '../lib/useRetryFocus';
import { paths } from '../paths';
import { ErrorNotice, Notice } from '../ui/states';
import { Page } from './Page';
import { useProject } from './ProjectGate';

/**
 * Le kanban du Projet (bdesk-38k.7). Une carte ouvre `/p/<projet>/t/<id>` ; le panneau de détail est celui de
 * bdesk-38k.9. Un rafraîchissement qui échoue garde le tableau à l'écran : le bandeau du shell le signale, et
 * l'erreur n'a la parole que faute de tickets.
 */
export function KanbanPage() {
  const project = useProject();
  const issues = useIssues(project.id);
  const retry = useRetryFocus(issues);
  const { page } = useT().kanban;
  useDocumentTitle(page.title, project.name);

  return (
    <Page title={page.title} description={page.description(projectInSentence(project))} wide>
      {issues.data ? (
        issues.data.length === 0 ? (
          <Notice icon={Inbox} title={page.empty.title}>
            {page.empty.hint}
          </Notice>
        ) : (
          // `key` : un autre Projet est un autre tableau, qui choisit sa propre colonne d'ouverture sur mobile.
          <Board key={project.id} project={project} issues={issues.data} />
        )
      ) : issues.isError ? (
        issues.error instanceof ApiError && issues.error.status === 404 ? (
          <Notice
            icon={FolderSearch}
            title={page.gone.title}
            action={
              <Link to={paths.global()} className="font-medium text-accent hover:underline">
                {page.gone.link}
              </Link>
            }
          >
            {page.gone.detail}
          </Notice>
        ) : (
          <ErrorNotice error={issues.error} title={page.loadError} onRetry={retry} />
        )
      ) : (
        <BoardSkeleton />
      )}
    </Page>
  );
}
