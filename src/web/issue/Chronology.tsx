import { CircleAlert, RefreshCw } from 'lucide-react';
import { Fragment, useId, type MouseEvent } from 'react';
import { ApiError, describeError } from '../data/client';
import { useChronology } from '../data/hooks';
import type { IssueBlockage, IssueBlockagePhase, IssueBlockagePhaseKind, IssueChronology, IssueTransition } from '../data/types';
import { statusLabel } from '../design/issue-palette';
import { cx } from '../lib/cx';
import { browserTimeZone, formatInstant } from '../lib/instant';
import { useNow } from '../lib/useNow';
import { formatDuration, spokenDuration } from '../metrics/format';
import { Button } from '../ui/Button';
import { Notice, Skeleton } from '../ui/states';
import { IssueLink } from './IssueLink';
import { focusPanelOf, keepFocusInPanel } from './panelFocus';
import { Section } from './Section';

/** Les intitulés des trois durées, dits par la chronologie et par sa silhouette. */
const LEAD_TIME = 'Lead Time';
const CYCLE_TIME = 'Cycle Time';
const BLOCKED_TIME = 'Temps bloqué en cours de travail';

/**
 * La chronologie du ticket : Lead Time, Cycle Time et temps bloqué, les Transitions avec le temps passé dans chaque
 * statut, et les Blocages. Elle a sa requête : lire l'historique du Projet est plus long que lire la fiche, et sa panne
 * ne prive pas de la fiche. Les durées sont celles des métriques, des Durées écoulées, écrites comme la page Métriques
 * les écrit (`metrics/format`) ; les heures s'écrivent dans le fuseau du navigateur. Un statut qui dure encore se compte
 * jusqu'à maintenant, avec l'horloge du navigateur.
 *
 * Le temps bloqué est celui des métriques : le Blocage pendant le travail, celui du Cycle Time. La liste des Blocages dit
 * davantage (un ticket qui attend une dépendance avant d'être démarré est en Blocage aussi) : chaque Blocage nomme donc les
 * phases qu'il traverse, pour que l'on voie lesquelles le temps bloqué compte.
 */
export function Chronology({ projectId, issueId }: { projectId: string; issueId: string }) {
  const query = useChronology(projectId, issueId);
  // Un 404 à un rafraîchissement : le ticket n'existe plus pour le serveur. La requête s'en déclare juge (`HANDLES_NOT_FOUND`) :
  // le bandeau d'actualisation raté s'en abstient, c'est donc cette section qui le dit, au lieu de garder une chronologie périmée.
  const gone = query.error instanceof ApiError && query.error.status === 404;

  return (
    <Section title="Chronologie">
      {/* Une enveloppe par état (`key`) : quand l'état change, elle part avec ce qu'elle contient, et `keepFocusInPanel` rend au panneau le focus qu'elle y avait
          (le bouton « Réessayer » que le squelette remplace). `contents` : elle ne dessine aucune boîte. */}
      <div key={query.data && !gone ? 'body' : query.isError ? 'unavailable' : 'loading'} ref={keepFocusInPanel} className="contents">
        {query.data && !gone ? (
          <ChronologyBody projectId={projectId} chronology={query.data} />
        ) : query.isError ? (
          <Unavailable
            error={query.error}
            onRetry={(event) => {
              // Le panneau prend le focus aussi quand le bouton ne l'a pas pris (un toucher, un lecteur d'écran, Safari) ; quand le bouton l'a, c'est
              // `keepFocusInPanel` qui le rend au panneau, dès que le squelette remplace l'avis, quelle que soit la cause du rechargement.
              focusPanelOf(event.currentTarget);
              void query.refetch();
            }}
          />
        ) : (
          // La silhouette a la forme et à peu près la hauteur de ce qui va arriver (trois durées, la phrase et trois Transitions) :
          // le texte qui suit la chronologie ne saute pas quand elle s'affiche. Les cases portent leurs intitulés, qui sont connus :
          // un intitulé long passe à la ligne sur un écran étroit, et la case a alors la hauteur qu'elle aura.
          <div role="status" aria-busy="true" aria-label="Chargement de la chronologie" className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2">
              {[LEAD_TIME, CYCLE_TIME, BLOCKED_TIME].map((label) => (
                <div key={label} className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-well px-3 py-2">
                  <span className="text-xs text-ink-3">{label}</span>
                  <Skeleton className="my-0.5 h-4 w-3/5" />
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
            </div>
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex gap-3">
                  <Skeleton className="mx-0.5 mt-1.5 size-2 shrink-0 rounded-full" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

/**
 * La chronologie n'a pas pu être lue. La fiche, elle, l'a été : le Projet n'est pas « illisible », c'est son historique
 * qui l'est (trop long, base verrouillée). Le titre dit donc ce qui manque, et la cause suit.
 */
function Unavailable({ error, onRetry }: { error: unknown; onRetry: (event: MouseEvent<HTMLButtonElement>) => void }) {
  const described = describeError(error);
  return (
    <Notice
      tone="danger"
      icon={CircleAlert}
      title="Chronologie indisponible"
      action={
        <Button onClick={onRetry}>
          <RefreshCw size={14} aria-hidden="true" />
          Réessayer
        </Button>
      }
    >
      {described.specific ? null : <p>{described.title}</p>}
      {described.detail ? <p>{described.detail}</p> : null}
    </Notice>
  );
}

function ChronologyBody({ projectId, chronology }: { projectId: string; chronology: IssueChronology }) {
  const now = useNow();
  const blockagesNote = useId();
  const { transitions, blockages } = chronology;
  const closed = chronology.outcome.kind !== 'open';

  return (
    <div className="flex flex-col gap-3">
      {chronology.source === 'dates' ? (
        <p className="rounded-md border border-dashed border-line-strong px-3 py-2 text-ink-2">
          Historique indisponible pour ce ticket : seules ses dates de création et de clôture sont connues, sans Cycle Time ni
          Blocage.
        </p>
      ) : null}

      <dl className="grid grid-cols-3 gap-2">
        <Figure label={LEAD_TIME} value={chronology.leadTime} missing={closed ? 'sans historique' : 'ticket non fermé'} />
        <Figure
          label={CYCLE_TIME}
          value={chronology.cycleTime}
          missing={!closed ? 'ticket non fermé' : chronology.source === 'dates' ? 'sans historique' : 'jamais démarré'}
        />
        <Figure
          label={BLOCKED_TIME}
          value={chronology.blockedTime}
          zero="Aucun"
          missing={!closed ? 'ticket non fermé' : 'sans historique'}
        />
      </dl>

      <div className="flex flex-col gap-0.5">
        <p className="text-ink-2">{outcomeSentence(chronology)}</p>
        <p className="text-xs text-ink-3">Heures du fuseau {browserTimeZone()}</p>
      </div>

      <ol aria-label="Transitions" className="flex flex-col">
        {transitions.map((transition, index) => (
          <TransitionRow
            key={`${transition.at}-${index}`}
            transition={transition}
            previous={transitions[index - 1]}
            last={index === transitions.length - 1}
            now={now}
          />
        ))}
      </ol>

      {blockages.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-xs font-medium text-ink-3">Blocages</h4>
          <p id={blockagesNote} className="text-xs text-ink-3">
            Seul le Blocage en cours de travail compte dans le temps bloqué.
          </p>
          <ul aria-label="Blocages" aria-describedby={blockagesNote} className="flex flex-col gap-1.5">
            {blockages.map((blockage) => (
              <BlockageRow key={blockage.from} blockage={blockage} projectId={projectId} now={now} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Une durée du ticket : sa valeur en grand (et en toutes lettres pour les lecteurs d'écran), ou pourquoi elle manque. */
function Figure({ label, value, missing, zero }: { label: string; value: number | null; missing: string; zero?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-well px-3 py-2">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="tnum text-[15px] font-semibold leading-5 text-ink">
        {value === null ? (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">Indéfini</span>
          </>
        ) : value === 0 && zero ? (
          zero
        ) : (
          <Duration ms={value} />
        )}
      </dd>
      {value === null ? <dd className="text-micro leading-4 text-ink-3">{missing}</dd> : null}
    </div>
  );
}

/** Une durée, courte pour les yeux (« 3 j 4 h ») et en toutes lettres pour les lecteurs d'écran (« 3 jours 4 heures »). */
function Duration({ ms }: { ms: number }) {
  return (
    <>
      <span aria-hidden="true">{formatDuration(ms)}</span>
      <span className="sr-only">{spokenDuration(ms)}</span>
    </>
  );
}

function outcomeSentence({ outcome, reopenings }: IssueChronology): string {
  const reopened = reopenings > 0 ? ` · Rouvert ${reopenings} fois` : '';
  switch (outcome.kind) {
    case 'open':
      return `Pas encore fermé${reopened}`;
    case 'delivered':
      return `Livraison le ${formatInstant(outcome.at)}${reopened}`;
    case 'abandoned':
      return `Abandon (${outcome.cause === 'duplicate' ? 'doublon' : 'remplacé'}) le ${formatInstant(outcome.at)}${reopened}`;
    case 'closed':
      return `Fermé le ${formatInstant(outcome.at)}${reopened}`;
  }
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Ce que la Transition fait au ticket : il est créé, fermé, rouvert, ou passe dans un autre statut. */
function transitionLabel(transition: IssueTransition, previous: IssueTransition | undefined): string {
  const status = statusLabel(transition.status);
  if (!previous) return transition.status === 'open' ? 'Créé' : `Créé · ${status}`;
  if (transition.status === 'closed') return 'Fermé';
  if (previous.status === 'closed') return transition.status === 'open' ? 'Rouvert' : `Rouvert · ${status}`;
  return capitalize(status);
}

function TransitionRow({
  transition,
  previous,
  last,
  now,
}: {
  transition: IssueTransition;
  previous: IssueTransition | undefined;
  last: boolean;
  now: number;
}) {
  const ongoing = transition.duration === null && transition.status !== 'closed';
  return (
    <li className={cx('relative flex gap-3', !last && 'pb-3')}>
      <span aria-hidden="true" className="relative flex w-3 shrink-0 justify-center">
        {last ? null : <span className="absolute -bottom-3 top-3.5 w-px bg-line-strong" />}
        <span className="relative mt-1.5 size-2 rounded-full border-2 border-ink-3 bg-panel" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-ink">{transitionLabel(transition, previous)}</span>
          <time dateTime={transition.at} className="tnum text-ink-2">
            {formatInstant(transition.at)}
          </time>
        </p>
        {transition.duration !== null || ongoing ? (
          <p className="text-xs text-ink-3">
            {ongoing ? 'depuis ' : 'pendant '}
            <Duration ms={ongoing ? now - Date.parse(transition.at) : (transition.duration ?? 0)} />
          </p>
        ) : null}
      </div>
    </li>
  );
}

function BlockageRow({ blockage, projectId, now }: { blockage: IssueBlockage; projectId: string; now: number }) {
  const ongoing = blockage.to === null;
  const duration = (blockage.to === null ? now : Date.parse(blockage.to)) - Date.parse(blockage.from);
  return (
    <li className="rounded-md border border-line px-3 py-2">
      <p className="text-ink-2">
        {ongoing ? 'En cours depuis le ' : ''}
        <time dateTime={blockage.from} className="tnum">
          {formatInstant(blockage.from)}
        </time>
        {blockage.to !== null ? (
          <>
            {' → '}
            <time dateTime={blockage.to} className="tnum">
              {formatInstant(blockage.to)}
            </time>
          </>
        ) : null}
        {' · '}
        <Duration ms={duration} />
      </p>
      {/* Les tickets attendus s'écrivent par leur identifiant, qui peut n'avoir aucun endroit où passer à la ligne : il se coupe où il le faut au lieu de déborder du Blocage (bdesk-38k.90). */}
      <p className="wrap-anywhere text-xs text-ink-3">
        {blockage.blockedBy.length > 0 ? (
          <>
            attend{' '}
            {blockage.blockedBy.map((id, index) => (
              <Fragment key={id}>
                {index > 0 ? ', ' : null}
                <IssueLink projectId={projectId} id={id} className="font-mono text-ink-2 hover:underline">
                  {id}
                </IssueLink>
              </Fragment>
            ))}
          </>
        ) : null}
        {blockage.blockedBy.length > 0 && blockage.statusBlocked ? ' · ' : null}
        {blockage.statusBlocked ? 'statut bloqué' : null}
      </p>
      <p className="text-xs text-ink-3">
        <Phases phases={blockage.phases} now={now} />
      </p>
    </li>
  );
}

const PHASE_LABELS: Record<IssueBlockagePhaseKind, string> = {
  dependencyWait: 'avant le premier démarrage',
  work: 'en cours de travail',
  otherWait: 'hors du travail',
};

/**
 * Où le ticket en est pendant le Blocage : une phase se dit seule (« avant le premier démarrage »), plusieurs se chiffrent dans
 * l'ordre (« 17 h avant le premier démarrage, puis 3 h en cours de travail »). Seule la phase « en cours de travail » est celle
 * que compte le temps bloqué.
 */
function Phases({ phases, now }: { phases: IssueBlockagePhase[]; now: number }) {
  const [only] = phases;
  if (phases.length === 1 && only) return PHASE_LABELS[only.kind];
  return phases.map((phase, index) => (
    <Fragment key={phase.from}>
      {index > 0 ? ', puis ' : null}
      <Duration ms={(phase.to === null ? now : Date.parse(phase.to)) - Date.parse(phase.from)} /> {PHASE_LABELS[phase.kind]}
    </Fragment>
  ));
}
