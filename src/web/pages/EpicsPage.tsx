import { Zap } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useIssues } from '../data/hooks';
import { isEpic } from '../data/helpers';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { TypeGlyph } from '../ui/IssueBadges';
import { ErrorNotice, Notice, Skeleton } from '../ui/states';
import { ComingSoon, Page, SectionTitle } from './Page';
import { useProject } from './ProjectGate';

export function EpicsPage() {
  const project = useProject();
  const [params] = useSearchParams();
  const issues = useIssues(project.id);
  useDocumentTitle('Epics', project.name);

  const epics = issues.data?.filter(isEpic) ?? [];
  const children = issues.data?.filter((issue) => issue.parentId && epics.some((epic) => epic.id === issue.parentId)) ?? [];
  // La palette ⌘K ouvre une Epic avec `?epic=<id>` ; la page Epic reprendra ce paramètre.
  const target = epics.find((epic) => epic.id === params.get('epic'));

  return (
    <Page
      title="Epics"
      description={`L’avancement de chaque Epic de ${project.name} : les Livraisons parmi ses Enfants.`}
    >
      <ComingSoon ticket="bdesk-38k.10">Les Epics arrivent avec « Page Epic : avancement, Enfants, Lead Time et prévision ».</ComingSoon>

      {target ? (
        <section aria-labelledby="target-epic" className="flex flex-col gap-1.5 rounded-lg border border-line p-4">
          <SectionTitle id="target-epic">Epic ouverte depuis la palette</SectionTitle>
          <p className="flex min-w-0 items-center gap-2">
            <TypeGlyph type="epic" />
            <span className="max-w-[50%] shrink-0 truncate font-mono text-xs text-ink-3">{target.id}</span>
            <span className="truncate font-medium text-ink">{target.title}</span>
          </p>
        </section>
      ) : null}

      <section aria-labelledby="epics-facts" className="flex flex-col gap-3">
        <SectionTitle id="epics-facts">Dans ce Projet</SectionTitle>
        {/* Un rafraîchissement raté garde le décompte affiché : l'erreur n'a la parole que faute de données. */}
        {issues.data ? (
          epics.length === 0 ? (
            <Notice icon={Zap} title="Aucune Epic dans ce Projet">
              Une Epic est un ticket de type epic : <code>bd create --type epic</code>.
            </Notice>
          ) : (
            <p className="tnum text-ink-2">
              <strong className="font-semibold text-ink">{epics.length}</strong> Epics regroupant{' '}
              <strong className="font-semibold text-ink">{children.length}</strong> Enfants
            </p>
          )
        ) : issues.isError ? (
          <ErrorNotice error={issues.error} title="Impossible de charger les tickets" onRetry={() => void issues.refetch()} />
        ) : (
          <Skeleton className="h-4 w-56" />
        )}
      </section>
    </Page>
  );
}
