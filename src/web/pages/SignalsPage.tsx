import { CircleCheck } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router';
import { useProjects, useSignals } from '../data/hooks';
import { projectInSentence, projectLabel } from '../data/projectNames';
import { UnreadableProjects } from '../metrics/Notices';
import type { ApiSignal, Project, SignalsResponse } from '../data/types';
import { isInvisibleText } from '../lib/invisibleText';
import { SIGNAL_KINDS, signalSentence } from '../lib/signals';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useRetryFocus } from '../lib/useRetryFocus';
import { paths } from '../paths';
import { ErrorNotice, Notice, Skeleton } from '../ui/states';
import { Page } from './Page';
import { useProject } from './ProjectGate';

const TITLE = 'À regarder';

/** La page « À regarder » de la Vue globale : les Signaux de tous les Projets suivis. */
export function GlobalSignalsPage() {
  useDocumentTitle(TITLE);
  return <SignalsView description="Ce qui mérite d’être regardé maintenant, dans tous les Projets : Dérives, Blocages longs, Prêts qui stagnent, WIP inhabituel." />;
}

/** La page « À regarder » d'un Projet : ses seuls Signaux. */
export function ProjectSignalsPage() {
  const project = useProject();
  useDocumentTitle(TITLE, project.name);
  return (
    <SignalsView
      project={project}
      description={`Ce qui mérite d’être regardé maintenant dans ${projectInSentence(project)} : Dérives, Blocages longs, Prêts qui stagnent, WIP inhabituel.`}
    />
  );
}

/**
 * Les Signaux, groupés par sorte (l'ordre du serveur : Dérive, Blocage long, Prêt qui stagne, WIP inhabituel, le plus en excès d'abord). Un Signal vit tant
 * que sa condition est vraie : il n'y a rien à écarter, la page se relit avec les données.
 */
function SignalsView({ project, description }: { project?: Project; description: string }) {
  const query = useSignals(project?.id);
  const retry = useRetryFocus(query);

  return (
    <Page title={TITLE} description={description}>
      {query.data ? (
        <SignalGroups response={query.data} />
      ) : query.isError ? (
        <ErrorNotice error={query.error} title="Impossible de lire les Signaux" onRetry={retry} />
      ) : (
        <div role="status" aria-busy="true" aria-label="Chargement des Signaux" className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}
    </Page>
  );
}

function SignalGroups({ response }: { response: SignalsResponse }) {
  // Les Projets tels que les phrases les nomment : ceux de la liste des Projets (`namedProjects`), à défaut ceux de la réponse.
  const known = useProjects().data?.projects ?? [];
  const named = <T extends { id: string; name: string }>(project: T): T & { unnamed?: true } => {
    const listed = known.find((candidate) => candidate.id === project.id);
    return listed ? { ...project, name: listed.name, ...(listed.unnamed ? { unnamed: true as const } : {}) } : project;
  };
  const projects = response.projects.map(named);
  const groups = SIGNAL_KINDS.map(({ kind, label }) => ({ kind, label, signals: response.signals.filter((signal) => signal.kind === kind) })).filter(
    (group) => group.signals.length > 0,
  );

  return (
    <div className="flex flex-col gap-6">
      {response.unreadable.length > 0 ? <UnreadableProjects projects={response.unreadable.map(named)} /> : null}
      {groups.length === 0 ? (
        <Notice icon={CircleCheck} title="Rien à regarder">
          <p>Aucune Dérive, aucun Blocage long, aucun Prêt qui stagne ni aucun WIP inhabituel en ce moment.</p>
        </Notice>
      ) : (
        groups.map((group) => <SignalGroup key={group.kind} label={group.label} signals={group.signals} projects={projects} />)
      )}
    </div>
  );
}

type Named = { id: string; name: string; unnamed?: true };

function SignalGroup({ label, signals, projects }: { label: string; signals: ApiSignal[]; projects: Named[] }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-signal-group className="flex flex-col gap-2">
      <h2 id={headingId} className="text-ui font-semibold text-ink">
        {label}
      </h2>
      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-panel">
        {signals.map((signal) => (
          <li key={'ticket' in signal ? `${signal.project}/${signal.ticket.id}` : signal.project} className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
            <SignalRow signal={signal} projects={projects} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Le Projet d'un Signal, comme une ligne de liste le nomme : un libellé, que ce qui le qualifie suit. */
function ProjectName({ id, projects }: { id: string; projects: Named[] }) {
  const project = projects.find((candidate) => candidate.id === id) ?? { id, name: id };
  return <>{projectLabel(project, projects)}</>;
}

function SignalRow({ signal, projects }: { signal: ApiSignal; projects: Named[] }) {
  if (signal.kind === 'unusualWip') {
    return (
      <p className="wrap-anywhere text-ink-2">
        <Link to={paths.kanban(signal.project)} className="font-medium text-ink hover:underline">
          <ProjectName id={signal.project} projects={projects} />
        </Link>{' '}
        : {signalSentence(signal)}
      </p>
    );
  }
  const title = isInvisibleText(signal.ticket.title) ? 'Sans titre' : signal.ticket.title;
  return (
    <>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <Link to={paths.issue(signal.project, signal.ticket.id)} className="wrap-anywhere font-medium text-ink hover:underline">
          {title}
        </Link>
        <span className="wrap-anywhere font-mono text-xs text-ink-3">{signal.ticket.id}</span>
      </p>
      <p className="wrap-anywhere text-xs text-ink-2">
        <ProjectName id={signal.project} projects={projects} /> · {signalSentence(signal)}
      </p>
    </>
  );
}
