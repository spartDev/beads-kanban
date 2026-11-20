import { Bot, Clock, Hourglass, Lock, Timer } from 'lucide-react';
import { Fragment, type ReactNode, useId } from 'react';
import { Link, useLocation } from 'react-router';
import { ticketTitle } from '../data/helpers';
import type { TicketSignals } from '../data/hooks';
import type { ApiSignal, DeclaredStatuses, Issue } from '../data/types';
import { SIGNAL_KINDS, shownSignals, signalSentence } from '../lib/signals';
import { statusLabel, typeMeta } from '../design/issue-palette';
import { useFormat, useLanguage, useT } from '../i18n';
import { parsePath, paths } from '../paths';
import { AbandonBadge, DeclineBadge, PriorityBadge, TypeGlyph } from '../ui/IssueBadges';
import { openedFromCard } from './boardFocus';
import { cx } from '../lib/cx';
import { showsStatus, type Lane } from './columns';
import { epicName, epicShortName } from './epics';
import type { CardLayout } from './layout';

/** Combien d'identifiants bloquants la carte nomme avant de compter le reste. */
const NAMED_BLOCKERS = 2;

/**
 * Une carte : un ticket, cliquable en entier. Le lien est celui du titre, étiré sur toute la carte (`after:inset-0`) ;
 * ce qui est lui-même un lien (la pastille d'Epic) passe au-dessus (`z-10`). Le focus au clavier entoure la carte. Un ticket sans titre y est
 * « Sans titre » (`ticketTitle`), comme dans son panneau : le lien n'est jamais sans nom (axe `link-name`). Plusieurs cartes peuvent avoir le même nom
 * (« Sans titre », ou le même titre) : le lien est décrit par l'identifiant de sa carte (`aria-describedby`), et un lien focalisé annonce « Sans titre,
 * lien, bdesk-pret ». L'identifiant n'est pas dans le nom : à la lecture continue, où il est lu juste avant, il serait dit deux fois.
 * Compromis connu, non vérifié avec un lecteur d'écran : au curseur de VoiceOver, qui lit la description après le nom, il est quand même dit deux fois (sur sa
 * ligne, puis en description du lien) ; NVDA et JAWS ne lisent pas la description en lecture continue.
 * Aucun glisser-déposer : le kanban est en lecture seule.
 * Elle porte son Projet (`data-card-project`) avec son identifiant (`data-card-id`) : les identifiants de tickets ne sont uniques que dans un Projet (deux copies ou deux clones d'un même
 * dépôt ont les mêmes), et c'est avec les deux qu'on la retrouve quand elle est remontée ailleurs (voir `movedCardLink`).
 * Son lien écrit la carte (son identifiant et son Projet) dans l'entrée d'historique qu'il ouvre : le panneau du ticket y retrouve la carte d'où il vient, même quand le clic n'a pas donné le focus au lien (WebKit : voir `panelOpener`).
 */
export function Card({
  issue,
  lane,
  projectId,
  epic,
  now,
  signals,
  declared,
  layout,
}: {
  issue: Issue;
  /** La colonne de la carte, ou `paused` dans le tiroir. */
  lane: Lane;
  projectId: string;
  /** L'Epic de la carte, pour sa pastille. */
  epic: Issue | null;
  now: number;
  /** Les Signaux du ticket : sa Dérive, son Blocage long. */
  signals?: TicketSignals | undefined;
  /**
   * Les statuts que le Projet déclare : un ticket dans un statut qu'il déclare `wip` est en travail, et montre ses Signaux (`shownSignals`) ; sa carte écrit
   * ce statut, que sa colonne ne dit pas (`showsStatus`).
   */
  declared: DeclaredStatuses;
  /** La carte selon la disposition du tableau : allégée dans une colonne étroite (`BoardLayout.card`) ; rien pour le tiroir « En pause ». */
  layout?: CardLayout | undefined;
}) {
  const { language } = useLanguage();
  const t = useT();
  const format = useFormat();
  const dated = lane === 'done' ? (issue.closedAt ?? issue.updatedAt) : issue.updatedAt;
  const age = format.formatAge(dated, now);
  // Le ticket s'ouvre par-dessus ce tableau : son adresse garde les réglages du tableau (`?epic=`, `?done=`, `?col=`), et
  // une carte ouverte pendant qu'un ticket l'est déjà remplace son entrée d'historique (« Retour » ferme le panneau).
  const { pathname, search } = useLocation();
  const panelOpen = parsePath(pathname).section === 'issue';
  const idId = useId();
  const { drift, longBlockage } = shownSignals(issue.status, signals, declared);

  return (
    <li
      data-card-id={issue.id}
      data-card-project={projectId}
      data-column={lane}
      className={cx(
        'relative flex scroll-mb-20 scroll-mt-28 flex-col gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-2 shadow-panel transition-colors hover:border-line-strong has-[a[data-card-link]:focus-visible]:border-accent has-[a[data-card-link]:focus-visible]:ring-2 has-[a[data-card-link]:focus-visible]:ring-accent',
        layout?.item,
      )}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        <span className="mt-0.5 shrink-0">
          <TypeGlyph type={issue.type} />
          <span className="sr-only">{typeMeta(issue.type, language).label} </span>
        </span>
        <span id={idId} className="min-w-0 flex-1 wrap-anywhere font-mono text-xs leading-5 text-ink-3">
          {issue.id}
        </span>
        <PriorityBadge priority={issue.priority} className="shrink-0 text-xs leading-5" glyphClassName={layout?.priorityGlyph} />
      </div>

      <p className={cx('wrap-anywhere text-ui text-ink', layout?.title)}>
        <Link
          to={{ pathname: paths.issue(projectId, issue.id), search }}
          replace={panelOpen}
          state={openedFromCard(issue.id, projectId)}
          data-card-link={issue.id}
          aria-describedby={idId}
          className="block min-h-6 outline-none after:absolute after:inset-0 after:rounded-lg"
        >
          {ticketTitle(issue)}
        </Link>
      </p>

      {issue.status === 'hooked' || epic || issue.abandon || issue.declined || drift || longBlockage ? (
        // Les pastilles passent à la ligne plutôt que de serrer l'identifiant, qui ne doit jamais se couper en deux. Dans une colonne étroite, chacune perd
        // son pictogramme et peut passer elle-même à la ligne entre deux mots (`layout.badges`).
        <div className={cx('flex min-w-0 flex-wrap items-center gap-1', layout?.badges)}>
          {issue.abandon ? <AbandonBadge abandon={issue.abandon} /> : null}
          {issue.declined ? <DeclineBadge /> : null}
          {drift ? <SignalBadge signal={drift} label={signalKind('drift')} icon={Timer} /> : null}
          {longBlockage ? <SignalBadge signal={longBlockage} label={signalKind('longBlockage')} icon={Hourglass} /> : null}
          {issue.status === 'hooked' ? <AgentBadge /> : null}
          {epic ? <EpicPill projectId={projectId} epic={epic} /> : null}
        </div>
      ) : null}
      <Blocking issue={issue} />
      {/* Le statut que la colonne ne dit pas (`showsStatus`) : celui d'un ticket en pause, un Statut de relais dans Bloqué, un autre statut déclaré de travail. */}
      {showsStatus(issue.status, lane, declared) ? (
        // Un statut inconnu peut être un seul long mot : il se coupe plutôt que de déborder de la carte (`wrap-break-word`).
        <p data-card-status className="self-start rounded-full border border-line px-1.5 text-xs leading-5 text-ink-2 wrap-break-word">
          {statusLabel(issue.status, language)}
        </p>
      ) : null}

      {issue.assignee || age ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-ink-3">
          {issue.assignee ? <span className="min-w-0 wrap-anywhere">{issue.assignee}</span> : null}
          {age ? (
            <time
              dateTime={dated}
              title={format.formatDateTime(dated)}
              className="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap"
            >
              <Clock size={11} aria-hidden="true" />
              <span className="sr-only">{lane === 'done' ? t.kanban.card.closed : t.kanban.card.updated} </span>
              {age}
            </time>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** Le nom d'une sorte de Signal : un texte de la zone shell (`lib/signals.ts`), lu là sans être recopié. */
const signalKind = (kind: ApiSignal['kind']): string => SIGNAL_KINDS.find((entry) => entry.kind === kind)?.label ?? kind;

/**
 * Un Signal du ticket (Dérive, Blocage long) : la pastille dit sa sorte, l'infobulle et les lecteurs d'écran disent de combien il dépasse la normale. La
 * phrase n'est pas dans le nom du lien de la carte : elle suit le titre, dans la carte, comme les autres pastilles.
 */
function SignalBadge({ signal, label, icon: Icon }: { signal: ApiSignal; label: string; icon: typeof Timer }) {
  const t = useT();
  const sentence = signalSentence(signal);
  return (
    <span
      data-signal={signal.kind}
      title={sentence}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger-soft px-1.5 text-micro font-medium text-danger"
    >
      <Icon size={11} aria-hidden="true" />
      {label}
      <span className="sr-only">{t.kanban.card.signalDetail(sentence)}</span>
    </span>
  );
}

/** Ticket rattaché à un agent (statut `hooked`). */
function AgentBadge() {
  const t = useT();
  return (
    <span
      title={t.kanban.card.agentTitle}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-1.5 text-micro font-medium text-accent"
    >
      <Bot size={11} aria-hidden="true" />
      {t.kanban.card.agent}
    </span>
  );
}

/** Pastille de l'Epic : son titre court, et un lien vers elle. Le titre entier est en infobulle. Sans titre, son identifiant la nomme (`epicName`). */
function EpicPill({ projectId, epic }: { projectId: string; epic: Issue }) {
  const t = useT();
  return (
    <Link
      to={paths.epics(projectId, epic.id)}
      title={epicName(epic)}
      className="relative z-10 inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-well px-1.5 py-px text-xs text-ink-2 transition-colors hover:text-ink"
    >
      <TypeGlyph type="epic" size={12} />
      <span className="sr-only">{t.kanban.card.epic}</span> <span className="min-w-0 truncate">{epicShortName(epic)}</span>
    </Link>
  );
}

/** Ce qui retient le ticket : les tickets dont il dépend, ou le seul statut bloqué. */
function Blocking({ issue }: { issue: Issue }) {
  const t = useT();
  const ids = issue.blockedBy;
  if (ids.length === 0) return issue.status === 'blocked' ? <Reason>{t.kanban.card.blockedStatus}</Reason> : null;
  const named = ids.slice(0, NAMED_BLOCKERS);
  const rest = ids.length - named.length;
  return (
    <Reason title={`${t.kanban.card.waitingOn} ${ids.join(', ')}`}>
      {t.kanban.card.waitingOn}{' '}
      {named.map((id, index) => (
        <Fragment key={id}>
          {index > 0 ? ', ' : null}
          <span className="font-mono">{id}</span>
        </Fragment>
      ))}
      {rest > 0 ? <span className="text-ink-3"> +{rest}</span> : null}
    </Reason>
  );
}

function Reason({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <p title={title} className="flex items-start gap-1 text-xs leading-5 text-ink-2">
      <Lock size={12} aria-hidden="true" className="mt-1 shrink-0 text-ink-3" />
      <span className="min-w-0 wrap-anywhere">{children}</span>
    </p>
  );
}
