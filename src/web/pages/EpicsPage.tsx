import { FolderSearch, SearchX } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { useIssues } from '../data/hooks';
import type { Issue, Project } from '../data/types';
import { typeMeta } from '../design/issue-palette';
import { BackToEpics } from '../epics/BackToEpics';
import { EpicList } from '../epics/EpicList';
import { EpicView } from '../epics/EpicView';
import { EPIC_PARAM } from '../epics/view';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useRetryFocus } from '../lib/useRetryFocus';
import { paths } from '../paths';
import { ErrorNotice, Notice, Skeleton } from '../ui/states';
import { Page } from './Page';
import { useProject } from './ProjectGate';

/**
 * La page Epics du Projet (bdesk-38k.10) : sans paramètre, la liste de ses Epics et de leur avancement ; avec `?epic=<id>`,
 * la page de cette Epic (`EpicView`). C'est l'adresse que la pastille Epic des cartes du kanban, la palette ⌘K et le panneau
 * d'un ticket (`paths.epics`) ouvrent. Un rafraîchissement qui échoue garde la page à l'écran : le bandeau du shell le signale,
 * et l'erreur n'a la parole que faute de tickets.
 */
export function EpicsPage() {
  const project = useProject();
  const [params] = useSearchParams();
  const epicId = params.get(EPIC_PARAM);
  return epicId ? <EpicDetail project={project} epicId={epicId} /> : <EpicsOverview project={project} />;
}

function EpicsOverview({ project }: { project: Project }) {
  const issues = useIssues(project.id);
  const retry = useRetryFocus(issues);
  useDocumentTitle('Epics', project.name);

  return (
    <Page title="Epics" description={`L’avancement de chaque Epic de ${project.name} : les Livraisons parmi ses Enfants.`}>
      {issues.data ? (
        <EpicList projectId={project.id} issues={issues.data} />
      ) : issues.isError ? (
        <ErrorNotice error={issues.error} title="Impossible de charger les tickets" onRetry={retry} />
      ) : (
        <div role="status" aria-busy="true" aria-label="Chargement des Epics" className="flex flex-col gap-2">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}
    </Page>
  );
}

function EpicDetail({ project, epicId }: { project: Project; epicId: string }) {
  const issues = useIssues(project.id);
  const retry = useRetryFocus(issues);

  if (issues.data) {
    const epic = issues.data.find((issue) => issue.id === epicId);
    if (!epic) return <NoSuchEpic project={project} epicId={epicId} />;
    if (epic.type !== 'epic') return <NotAnEpic project={project} ticket={epic} />;
    return <EpicView project={project} epic={epic} issues={issues.data} />;
  }
  if (issues.isError) {
    return (
      <Page title="Epic indisponible">
        <ErrorNotice error={issues.error} title="Impossible de charger les tickets" onRetry={retry} />
      </Page>
    );
  }
  return <EpicSkeleton />;
}

/** La silhouette de la page : un titre, la barre d'avancement, deux cases de chiffres et quelques lignes d'Enfants. */
function EpicSkeleton() {
  return (
    <Page title={<Skeleton className="h-7 w-2/3" />}>
      <div role="status" aria-busy="true" aria-label="Chargement de l’Epic" className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-5 w-72 max-w-full" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Skeleton className="h-[4.5rem]" />
          <Skeleton className="h-[4.5rem]" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
        </div>
      </div>
    </Page>
  );
}

function NoSuchEpic({ project, epicId }: { project: Project; epicId: string }) {
  useDocumentTitle('Epic introuvable', project.name);
  return (
    <Page title="Epic introuvable" eyebrow={<BackToEpics projectId={project.id} />}>
      <Notice
        icon={SearchX}
        title={`Aucune Epic « ${epicId} » dans ${project.name}`}
        action={
          <Link to={paths.epics(project.id)} className="font-medium text-accent hover:underline">
            Voir les Epics du Projet
          </Link>
        }
      >
        L’Epic a peut-être été supprimée, ou le lien vient d’un autre Projet.
      </Notice>
    </Page>
  );
}

/** `?epic=` nomme un ticket qui n'est pas de type epic : on le dit, et on propose de l'ouvrir. */
function NotAnEpic({ project, ticket }: { project: Project; ticket: Issue }) {
  useDocumentTitle(ticket.id, project.name);
  return (
    <Page title="Ce n’est pas une Epic" eyebrow={<BackToEpics projectId={project.id} />}>
      <Notice
        icon={FolderSearch}
        title={`« ${ticket.id} » est de type ${typeMeta(ticket.type).label}`}
        action={
          <Link to={paths.issue(project.id, ticket.id)} className="font-medium text-accent hover:underline">
            Ouvrir le ticket
          </Link>
        }
      >
        <p>{ticket.title}</p>
        <p>Seul un ticket de type epic regroupe des Enfants et a une page d’avancement.</p>
      </Notice>
    </Page>
  );
}
