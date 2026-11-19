import { CircleCheck } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { Link } from 'react-router';
import { useProjects, useSignals } from '../data/hooks';
import { projectInSentence } from '../data/projectNames';
import { UnreadableProjects } from '../metrics/Notices';
import type { ApiSignal, Project, SignalsResponse } from '../data/types';
import { useLanguage, useT } from '../i18n';
import { isInvisibleText } from '../lib/invisibleText';
import { signalKinds, signalSentence } from '../lib/signals';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useRetryFocus } from '../lib/useRetryFocus';
import { paths } from '../paths';
import { ErrorNotice, Notice, Skeleton } from '../ui/states';
import { NoProjects } from './GlobalPage';
import { Page } from './Page';
import { type NamedProject, ProjectName, useProjectNamer } from './ProjectName';
import { useProject } from './ProjectGate';
import { SinceLastVisit } from './SinceLastVisit';

/**
 * L'accueil : « À regarder » tous Projets confondus. En tête, « Depuis votre dernière visite » (là seulement : la Dernière visite est unique), puis les
 * Signaux de tous les Projets suivis. Sans aucun Projet suivi, ni l'un ni l'autre : des zéros et « Rien à regarder » tairaient qu'il n'y a rien à suivre,
 * et l'accueil dit plutôt comment en faire suivre (`NoProjects`, l'avis de la Vue globale).
 */
export function GlobalSignalsPage() {
  const t = useT();
  const projects = useProjects();
  useDocumentTitle(t.shell.sections.signals);
  if (projects.data?.projects.length === 0) {
    return (
      <Page title={t.shell.sections.signals} description={t.shell.signalsPage.globalDescription}>
        <NoProjects />
      </Page>
    );
  }
  return <SignalsView description={t.shell.signalsPage.globalDescription} lead={<SinceLastVisit />} />;
}

/** La page « À regarder » d'un Projet : ses seuls Signaux. */
export function ProjectSignalsPage() {
  const project = useProject();
  const { language, t } = useLanguage();
  const text = t.shell.signalsPage;
  useDocumentTitle(t.shell.sections.signals, project.name);
  return (
    <SignalsView
      project={project}
      description={text.projectDescription(projectInSentence(project, language))}
    />
  );
}

/**
 * Les Signaux, groupés par sorte (l'ordre du serveur : Dérive, Blocage long, Prêt qui stagne, WIP inhabituel, le plus en excès d'abord). Un Signal vit tant
 * que sa condition est vraie : il n'y a rien à écarter, la page se relit avec les données.
 */
function SignalsView({ project, description, lead }: { project?: Project; description: string; lead?: ReactNode }) {
  const query = useSignals(project?.id);
  const retry = useRetryFocus(query);
  const t = useT();
  const text = t.shell.signalsPage;

  return (
    <Page title={t.shell.sections.signals} description={description}>
      {lead}
      {query.data ? (
        <SignalGroups response={query.data} />
      ) : query.isError ? (
        <ErrorNotice error={query.error} title={text.loadFailed} onRetry={retry} />
      ) : (
        <div role="status" aria-busy="true" aria-label={text.loading} className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}
    </Page>
  );
}

function SignalGroups({ response }: { response: SignalsResponse }) {
  const named = useProjectNamer();
  const { language, t } = useLanguage();
  const projects = response.projects.map(named);
  const groups = signalKinds(language).map(({ kind, label }) => ({ kind, label, signals: response.signals.filter((signal) => signal.kind === kind) })).filter(
    (group) => group.signals.length > 0,
  );

  return (
    <div className="flex flex-col gap-6">
      {response.unreadable.length > 0 ? <UnreadableProjects projects={response.unreadable.map(named)} /> : null}
      {groups.length === 0 ? (
        <Notice icon={CircleCheck} title={t.shell.signalsPage.nothingTitle}>
          <p>{t.shell.signalsPage.nothing}</p>
        </Notice>
      ) : (
        groups.map((group) => <SignalGroup key={group.kind} label={group.label} signals={group.signals} projects={projects} />)
      )}
    </div>
  );
}

function SignalGroup({ label, signals, projects }: { label: string; signals: ApiSignal[]; projects: NamedProject[] }) {
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

function SignalRow({ signal, projects }: { signal: ApiSignal; projects: NamedProject[] }) {
  const { language, t } = useLanguage();
  if (signal.kind === 'unusualWip') {
    return (
      <p className="wrap-anywhere text-ink-2">
        <Link to={paths.kanban(signal.project)} className="font-medium text-ink hover:underline">
          <ProjectName id={signal.project} projects={projects} />
        </Link>
        {t.shell.signalsPage.separator}
        {signalSentence(signal, language)}
      </p>
    );
  }
  const title = isInvisibleText(signal.ticket.title) ? t.shell.common.untitled : signal.ticket.title;
  return (
    <>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <Link to={paths.issue(signal.project, signal.ticket.id)} className="wrap-anywhere font-medium text-ink hover:underline">
          {title}
        </Link>
        <span className="wrap-anywhere font-mono text-xs text-ink-3">{signal.ticket.id}</span>
      </p>
      <p className="wrap-anywhere text-xs text-ink-2">
        <ProjectName id={signal.project} projects={projects} /> · {signalSentence(signal, language)}
      </p>
    </>
  );
}
