import { FolderSearch, Inbox } from 'lucide-react';
import { Link } from 'react-router';
import { ApiError } from '../data/client';
import { useIssues } from '../data/hooks';
import { Board } from '../kanban/Board';
import { BoardSkeleton } from '../kanban/BoardSkeleton';
import { useDocumentTitle } from '../lib/useDocumentTitle';
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
  useDocumentTitle('Kanban', project.name);

  return (
    <Page title="Kanban" description={`Les tickets de ${project.name}, en colonnes, en lecture seule.`} wide>
      {issues.data ? (
        issues.data.length === 0 ? (
          <Notice icon={Inbox} title="Aucun ticket dans ce Projet">
            Créez-en un avec <code>bd create</code> : il apparaîtra ici au prochain chargement.
          </Notice>
        ) : (
          // `key` : un autre Projet est un autre tableau, qui choisit sa propre colonne d'ouverture sur mobile.
          <Board key={project.id} project={project} issues={issues.data} />
        )
      ) : issues.isError ? (
        issues.error instanceof ApiError && issues.error.status === 404 ? (
          <Notice
            icon={FolderSearch}
            title="Ce Projet n’est plus disponible"
            action={
              <Link to={paths.global()} className="font-medium text-accent hover:underline">
                Voir les Projets suivis
              </Link>
            }
          >
            Il a peut-être été masqué dans la configuration, ou son dossier a été déplacé.
          </Notice>
        ) : (
          <ErrorNotice error={issues.error} title="Impossible de charger les tickets" onRetry={() => void issues.refetch()} />
        )
      ) : (
        <BoardSkeleton />
      )}
    </Page>
  );
}
