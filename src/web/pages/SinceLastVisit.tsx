import { CheckCheck, ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { ticketTitle } from '../data/helpers';
import { useSinceLastVisit } from '../data/hooks';
import type { SinceLastVisitGroup, SinceLastVisitResponse } from '../data/types';
import { useFormat, useLanguage } from '../i18n';
import { cx } from '../lib/cx';
import { useLastVisit } from '../lib/lastVisit';
import { useRetryFocus } from '../lib/useRetryFocus';
import { paths } from '../paths';
import { Button } from '../ui/Button';
import { ErrorNotice, Skeleton } from '../ui/states';
import { SectionTitle } from './Page';
import { type NamedProject, ProjectName, useProjectNamer } from './ProjectName';

/**
 * « Depuis votre dernière visite », en tête de l'accueil : ce qui s'est passé dans tous les Projets depuis la Dernière visite (24 heures sans elle), genre par
 * genre, les mauvaises nouvelles d'abord. Chaque genre dit son compte et se déplie en liste de tickets. Les genres sont ceux que le serveur rend, dans son
 * ordre : un genre indisponible n'apparaît pas, un genre vide dit zéro.
 *
 * « Tout vu » prend pour Dernière visite l'instant des données affichées (`asOf`), pas l'heure du clic : un événement commité entre l'affichage et le clic
 * reste à voir. Rien d'autre ne la déplace : ni l'ouverture de la page, ni un rechargement.
 */
export function SinceLastVisit() {
  const { lastVisit, markSeen } = useLastVisit();
  const query = useSinceLastVisit(lastVisit);
  const retry = useRetryFocus(query);
  const { t } = useLanguage();
  const format = useFormat();
  const text = t.shell.sinceLastVisit;
  const titleId = useId();
  const hintId = useId();
  // Ce que le lecteur d'écran entend une fois la visite notée : la liste, elle, repart en chargement.
  const [announced, setAnnounced] = useState('');
  const shown = query.data;

  const seeAll = () => {
    if (!shown) return;
    markSeen(shown.asOf);
    setAnnounced(text.markedSeen(format.formatInstant(shown.asOf)));
  };

  return (
    // Une zone de focus : « Réessayer » ne perd pas le focus quand le squelette remplace l'avis d'erreur (voir `ErrorNotice`). Sans contour : le focus y est transitoire.
    <section aria-labelledby={titleId} data-focus-zone="" className="flex flex-col gap-3 outline-none">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-60">
          <SectionTitle id={titleId}>{text.title}</SectionTitle>
          <p className="mt-1 wrap-anywhere text-ink-2">
            {lastVisit === null ? text.withoutLastVisit : text.since(format.formatInstant(lastVisit))}
          </p>
        </div>
        {/* Toujours là, pour que le focus ne tombe pas quand la liste repart en chargement après un clic : inerte tant que rien n'est affiché. */}
        <Button
          onClick={seeAll}
          aria-disabled={shown ? undefined : true}
          aria-describedby={shown ? hintId : undefined}
          className="aria-disabled:cursor-default aria-disabled:opacity-50"
        >
          <CheckCheck size={15} aria-hidden="true" />
          {text.markSeen}
        </Button>
        {shown ? (
          <span id={hintId} hidden>
            {text.markSeenHint(format.formatInstant(shown.asOf))}
          </span>
        ) : null}
      </div>

      {shown ? (
        <KindList response={shown} />
      ) : query.isError ? (
        <ErrorNotice error={query.error} title={text.loadFailed} onRetry={retry} />
      ) : (
        <div role="status" aria-busy="true" aria-label={text.loading} className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      <p role="status" aria-label={text.lastVisit} className="sr-only">
        {announced}
      </p>
    </section>
  );
}

function KindList({ response }: { response: SinceLastVisitResponse }) {
  const named = useProjectNamer();
  const projects = response.projects.map(named);
  return (
    <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
      {response.groups.map((group) => (
        <li key={group.kind}>
          <KindRow group={group} asOf={Date.parse(response.asOf)} projects={projects} />
        </li>
      ))}
    </ul>
  );
}

/** Un genre : son nom et son compte ; s'il a des tickets, un bouton qui déplie leur liste (motif « disclosure »). */
function KindRow({ group, asOf, projects }: { group: SinceLastVisitGroup; asOf: number; projects: NamedProject[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const { t } = useLanguage();
  const format = useFormat();
  const text = t.shell.sinceLastVisit;
  const count = group.tickets.length;
  const label = text.kinds[group.kind];
  // Le nom et le nombre se voient ; le lecteur d'écran entend une phrase (« Livraisons : 2 tickets »), d'un seul tenant pour que rien n'en tombe.
  const content = (
    <>
      <ChevronRight
        size={14}
        aria-hidden="true"
        className={cx('shrink-0 text-ink-3 transition-transform motion-reduce:transition-none', open && 'rotate-90', count === 0 && 'invisible')}
      />
      <span aria-hidden="true" className="min-w-0 flex-1 wrap-anywhere">
        {label}
      </span>
      <span aria-hidden="true" className="tnum font-semibold">
        {format.formatCount(count)}
      </span>
      <span className="sr-only">{text.spokenKind(label, format.formatCount(count), count)}</span>
    </>
  );

  if (count === 0) return <div className="flex min-h-10 items-center gap-2 px-3 py-2 text-ink-2">{content}</div>;

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((was) => !was)}
        className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left font-medium text-ink transition-colors hover:bg-hover focus-visible:-outline-offset-2"
      >
        {content}
      </button>
      <ul id={listId} hidden={!open} className="flex flex-col divide-y divide-line border-t border-line">
        {group.tickets.map((ticket) => (
          <li key={`${ticket.project}/${ticket.id}`} className="flex min-w-0 flex-col gap-0.5 py-2 pl-9 pr-3">
            <TicketRow ticket={ticket} asOf={asOf} projects={projects} />
          </li>
        ))}
      </ul>
    </>
  );
}

function TicketRow({
  ticket,
  asOf,
  projects,
}: {
  ticket: SinceLastVisitGroup['tickets'][number];
  asOf: number;
  projects: NamedProject[];
}) {
  const { language, t } = useLanguage();
  const format = useFormat();
  return (
    <>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <Link to={paths.issue(ticket.project, ticket.id)} className="wrap-anywhere font-medium text-ink hover:underline">
          {ticketTitle(ticket, language)}
        </Link>
        <span className="wrap-anywhere font-mono text-xs text-ink-3">{ticket.id}</span>
      </p>
      <p className="wrap-anywhere text-xs text-ink-2">
        <ProjectName id={ticket.project} projects={projects} /> ·{' '}
        <time dateTime={ticket.at} title={format.formatDateTime(ticket.at)}>
          {format.formatAge(ticket.at, asOf)}
        </time>
        {'deliveries' in ticket ? <> · {t.shell.sinceLastVisit.failedDeliveries(ticket.deliveries.join(', '), ticket.deliveries.length)}</> : null}
      </p>
    </>
  );
}
