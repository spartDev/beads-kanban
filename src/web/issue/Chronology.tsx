import { CircleAlert, RefreshCw } from 'lucide-react';
import { Fragment, useId, type MouseEvent } from 'react';
import { ApiError, describeError } from '../data/client';
import { useChronology, useDeclaredStatuses, useTicketSignals } from '../data/hooks';
import type { IssueBlockage, IssueBlockagePhase, IssueBlockagePhaseKind, IssueChronology, IssueTransition } from '../data/types';
import { statusLabel } from '../design/issue-palette';
import { cx } from '../lib/cx';
import { useFormat, useLanguage, useT, type DisplayFormat, type Language, type Messages } from '../i18n';
import { SIGNAL_KINDS, shownSignals, signalSentence } from '../lib/signals';
import { browserTimeZone } from '../lib/instant';
import { useNow } from '../lib/useNow';
import { Button } from '../ui/Button';
import { Notice, Skeleton } from '../ui/states';
import { IssueLink } from './IssueLink';
import { focusPanelOf, keepFocusInPanel } from './panelFocus';
import { Section } from './Section';

type ChronologyTexts = Messages['kanban']['chronology'];

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
  const { chronology: texts } = useT().kanban;

  return (
    <Section title={texts.title}>
      {/* Une enveloppe par état (`key`) : quand l'état change, elle part avec ce qu'elle contient, et `keepFocusInPanel` rend au panneau le focus qu'elle y avait
          (le bouton « Réessayer » que le squelette remplace). `contents` : elle ne dessine aucune boîte. */}
      <div key={query.data && !gone ? 'body' : query.isError ? 'unavailable' : 'loading'} ref={keepFocusInPanel} className="contents">
        {query.data && !gone ? (
          <ChronologyBody projectId={projectId} issueId={issueId} chronology={query.data} />
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
          <div role="status" aria-busy="true" aria-label={texts.loading} className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2">
              {[texts.leadTime, texts.cycleTime, texts.blockedTime].map((label) => (
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
  const described = describeError(error, useLanguage().language);
  const { chronology: texts } = useT().kanban;
  return (
    <Notice
      tone="danger"
      icon={CircleAlert}
      title={texts.unavailable}
      action={
        <Button onClick={onRetry}>
          <RefreshCw size={14} aria-hidden="true" />
          {texts.retry}
        </Button>
      }
    >
      {described.specific ? null : <p>{described.title}</p>}
      {described.detail ? <p>{described.detail}</p> : null}
    </Notice>
  );
}

/** Le nom d'une sorte de Signal : un texte de la zone shell (`lib/signals.ts`), lu là sans être recopié. */
const signalKind = (kind: 'drift' | 'longBlockage'): string => SIGNAL_KINDS.find((entry) => entry.kind === kind)?.label ?? kind;

/**
 * Les Signaux du ticket (Dérive, Blocage long) : les mêmes que sur sa carte, tirés des Signaux du Projet (une requête que le tableau a souvent déjà faite),
 * avec les statuts que le Projet déclare (ceux du tableau, sous le panneau). Rien tant qu'ils manquent ou qu'ils sont illisibles : la Chronologie se
 * suffit sans eux.
 */
function SignalNotes({ projectId, issueId, status }: { projectId: string; issueId: string; status: string | undefined }) {
  const { drift, longBlockage } = shownSignals(status ?? '', useTicketSignals(projectId).data?.get(issueId), useDeclaredStatuses(projectId));
  const { chronology: texts } = useT().kanban;
  return (
    <>
      {drift ? (
        <p className="text-ink-2">
          <span className="font-medium text-danger">{signalKind('drift')}</span>
          {texts.signalDetail(signalSentence(drift))}
        </p>
      ) : null}
      {longBlockage ? (
        <p className="text-ink-2">
          <span className="font-medium text-danger">{signalKind('longBlockage')}</span>
          {texts.signalDetail(signalSentence(longBlockage))}
        </p>
      ) : null}
    </>
  );
}

function ChronologyBody({ projectId, issueId, chronology }: { projectId: string; issueId: string; chronology: IssueChronology }) {
  const now = useNow();
  const blockagesNote = useId();
  const { language } = useLanguage();
  const { chronology: texts } = useT().kanban;
  const format = useFormat();
  const { transitions, blockages } = chronology;
  const closed = chronology.outcome.kind !== 'open';

  return (
    <div className="flex flex-col gap-3">
      {chronology.source === 'dates' ? (
        <p className="rounded-md border border-dashed border-line-strong px-3 py-2 text-ink-2">
          {texts.datesOnly}
        </p>
      ) : null}

      <dl className="grid grid-cols-3 gap-2">
        <Figure label={texts.leadTime} value={chronology.leadTime} missing={closed ? texts.missing.noHistory : texts.missing.notClosed} />
        <Figure
          label={texts.cycleTime}
          value={chronology.cycleTime}
          missing={!closed ? texts.missing.notClosed : chronology.source === 'dates' ? texts.missing.noHistory : texts.missing.neverStarted}
        />
        <Figure
          label={texts.blockedTime}
          value={chronology.blockedTime}
          zero={texts.none}
          missing={!closed ? texts.missing.notClosed : texts.missing.noHistory}
        />
      </dl>

      <div className="flex flex-col gap-0.5">
        <p className="text-ink-2">{outcomeSentence(chronology, texts, format)}</p>
        <SignalNotes projectId={projectId} issueId={issueId} status={transitions.at(-1)?.status} />
        <p className="text-xs text-ink-3">{texts.timeZone(browserTimeZone())}</p>
      </div>

      <ol aria-label={texts.transitions} className="flex flex-col">
        {transitions.map((transition, index) => (
          <TransitionRow
            key={`${transition.at}-${index}`}
            transition={transition}
            last={index === transitions.length - 1}
            now={now}
            label={transitionLabel(transition, transitions[index - 1], texts, language)}
          />
        ))}
      </ol>

      {blockages.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-xs font-medium text-ink-3">{texts.blockages}</h4>
          <p id={blockagesNote} className="text-xs text-ink-3">
            {texts.blockagesNote}
          </p>
          <ul aria-label={texts.blockages} aria-describedby={blockagesNote} className="flex flex-col gap-1.5">
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
  const t = useT();
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-well px-3 py-2">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="tnum text-base font-bold leading-6 text-ink">
        {value === null ? (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">{t.kanban.chronology.unknownValue}</span>
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
  const format = useFormat();
  return (
    <>
      <span aria-hidden="true">{format.formatDuration(ms)}</span>
      <span className="sr-only">{format.spokenDuration(ms)}</span>
    </>
  );
}

function outcomeSentence({ outcome, reopenings }: IssueChronology, texts: ChronologyTexts, format: DisplayFormat): string {
  const reopened = reopenings > 0 ? texts.outcome.reopened(format.formatCount(reopenings)) : '';
  switch (outcome.kind) {
    case 'open':
      return `${texts.outcome.open}${reopened}`;
    case 'delivered':
      return `${texts.outcome.delivered(format.formatInstant(outcome.at))}${reopened}`;
    case 'abandoned':
      return `${texts.outcome.abandoned(outcome.cause === 'duplicate', format.formatInstant(outcome.at))}${reopened}`;
    case 'declined':
      return `${texts.outcome.declined(format.formatInstant(outcome.at))}${reopened}`;
    case 'closed':
      return `${texts.outcome.closed(format.formatInstant(outcome.at))}${reopened}`;
  }
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Ce que la Transition fait au ticket : il est créé, fermé, rouvert, ou passe dans un autre statut. */
function transitionLabel(transition: IssueTransition, previous: IssueTransition | undefined, texts: ChronologyTexts, language: Language): string {
  const status = statusLabel(transition.status, language);
  const words = texts.transition;
  if (!previous) return transition.status === 'open' ? words.created : words.createdAs(status);
  if (transition.status === 'closed') return words.closed;
  if (previous.status === 'closed') return transition.status === 'open' ? words.reopened : words.reopenedAs(status);
  return capitalize(status);
}

function TransitionRow({
  transition,
  last,
  now,
  label,
}: {
  transition: IssueTransition;
  last: boolean;
  now: number;
  /** Ce que la Transition fait au ticket (`transitionLabel`). */
  label: string;
}) {
  const { chronology: texts } = useT().kanban;
  const format = useFormat();
  const ongoing = transition.duration === null && transition.status !== 'closed';
  return (
    <li className={cx('relative flex gap-3', !last && 'pb-3')}>
      <span aria-hidden="true" className="relative flex w-3 shrink-0 justify-center">
        {last ? null : <span className="absolute -bottom-3 top-3.5 w-px bg-line-strong" />}
        <span className="relative mt-1.5 size-2 rounded-full border-2 border-ink-3 bg-panel" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-ink">{label}</span>
          <time dateTime={transition.at} className="tnum text-ink-2">
            {format.formatInstant(transition.at)}
          </time>
        </p>
        {transition.duration !== null || ongoing ? (
          <p className="text-xs text-ink-3">
            {ongoing ? texts.ongoingFor : texts.lastedFor}
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
  const { chronology: texts } = useT().kanban;
  const format = useFormat();
  return (
    <li className="rounded-md border border-line px-3 py-2">
      <p className="text-ink-2">
        {ongoing ? texts.blockageOngoingSince : ''}
        <time dateTime={blockage.from} className="tnum">
          {format.formatInstant(blockage.from)}
        </time>
        {blockage.to !== null ? (
          <>
            {' → '}
            <time dateTime={blockage.to} className="tnum">
              {format.formatInstant(blockage.to)}
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
            {texts.waitingOn}{' '}
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
        {blockage.statusBlocked ? texts.statusBlocked : null}
      </p>
      <p className="text-xs text-ink-3">
        <Phases phases={blockage.phases} now={now} />
      </p>
    </li>
  );
}

/**
 * Où le ticket en est pendant le Blocage : une phase se dit seule (« avant le premier démarrage »), plusieurs se chiffrent dans
 * l'ordre (« 17 h avant le premier démarrage, puis 3 h en cours de travail »). Seule la phase « en cours de travail » est celle
 * que compte le temps bloqué.
 */
function Phases({ phases, now }: { phases: IssueBlockagePhase[]; now: number }) {
  const labels: Record<IssueBlockagePhaseKind, string> & { then: string } = useT().kanban.chronology.phases;
  const [only] = phases;
  if (phases.length === 1 && only) return labels[only.kind];
  return phases.map((phase, index) => (
    <Fragment key={phase.from}>
      {index > 0 ? labels.then : null}
      <Duration ms={(phase.to === null ? now : Date.parse(phase.to)) - Date.parse(phase.from)} /> {labels[phase.kind]}
    </Fragment>
  ));
}
