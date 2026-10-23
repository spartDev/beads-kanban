import { useDocumentTitle } from '../lib/useDocumentTitle';
import { IssueFacts } from './IssueFacts';
import { ComingSoon, Page } from './Page';
import { useProject } from './ProjectGate';

export function KanbanPage() {
  const project = useProject();
  useDocumentTitle('Kanban', project.name);

  return (
    <Page title="Kanban" description={`Les tickets de ${project.name}, en colonnes, en lecture seule.`}>
      <ComingSoon ticket="bdesk-38k.7">Le tableau arrive avec « Kanban par Projet (lecture seule) ».</ComingSoon>
      <IssueFacts projectId={project.id} />
    </Page>
  );
}
