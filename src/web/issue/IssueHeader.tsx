import { ArchiveX, Ban, Layers, Lock } from 'lucide-react';
import { Fragment } from 'react';
import { Link } from 'react-router';
import { isBlankTitle, ticketTitle } from '../data/helpers';
import type { IssueDetail } from '../data/types';
import { statusLabel } from '../design/issue-palette';
import { useLanguage, useT } from '../i18n';
import { epicName, epicShortName } from '../kanban/epics';
import { paths } from '../paths';
import { AbandonBadge, DeclineBadge, PriorityBadge, TypeBadge, TypeGlyph } from '../ui/IssueBadges';
import { IssueLink } from './IssueLink';

/**
 * Sous le titre : type, priorité, statut, assigné, Parent, la page de l'Epic, et ce qui retient le ticket. Tout vient de la fiche, y
 * compris le titre du Parent (`linked`) et l'Epic (`epic`) : la ligne du Parent et le lien de l'Epic sont là dès que le titre l'est,
 * la page ne se recompose pas.
 */
export function IssueHeader({ issue, projectId }: { issue: IssueDetail; projectId: string }) {
  const parent = issue.parentId ? issue.linked[issue.parentId] : undefined;
  // La page Epic (bdesk-38k.10, bdesk-38k.29) : celle du ticket quand il en est une, sinon celle de l'Epic la plus proche au-dessus de lui, à tous
  // les niveaux, que le serveur nomme dans la fiche (`epic` : la règle de la pastille des cartes, `epicOf`). Tout vient de la fiche : le lien
  // est là dès que le titre l'est, comme la ligne du Parent, et il nomme l'Epic comme la pastille (« Epic : … »). Ce nom, comme celui du lien Parent,
  // est celui de `epicName` et `epicShortName` : le titre, ou l'identifiant d'une Epic qui n'en a pas.
  const pageEpic = issue.type === 'epic' ? { id: issue.id, title: issue.title } : issue.epic;
  const { language } = useLanguage();
  const { header } = useT().kanban;

  return (
    <div className="flex flex-col gap-2">
      <dl className="flex flex-wrap items-center gap-x-4 gap-y-1.5 wrap-anywhere text-ink-2">
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">{header.type}</dt>
          <dd>
            <TypeBadge type={issue.type} />
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">{header.priority}</dt>
          <dd>
            <PriorityBadge priority={issue.priority} />
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">{header.status}</dt>
          <dd>
            {statusLabel(issue.status, language)}
            {/* Fermé sans être une Livraison : la phrase sous la liste dit pourquoi, la pastille n'a pas à le redire aux lecteurs d'écran. */}
            {issue.abandon ? <AbandonBadge abandon={issue.abandon} withReason={false} className="ml-1.5 align-middle" /> : null}
            {issue.declined ? <DeclineBadge withReason={false} className="ml-1.5 align-middle" /> : null}
          </dd>
        </div>
        {issue.assignee ? (
          <div className="flex items-center gap-1.5">
            <dt className="shrink-0 text-ink-3">{header.assignee}</dt>
            <dd>{issue.assignee}</dd>
          </div>
        ) : null}
        {issue.parentId ? (
          <div className="flex min-w-0 max-w-full items-center gap-1.5">
            <dt className="sr-only">{header.parent}</dt>
            <dd className="min-w-0">
              {parent?.type === 'epic' ? (
                <IssueLink
                  projectId={projectId}
                  id={parent.id}
                  title={epicName(parent)}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-well px-1.5 py-px text-xs text-ink-2 transition-colors hover:text-ink"
                >
                  <TypeGlyph type="epic" size={12} />
                  <span className="sr-only">{header.epic}</span> <span className="min-w-0 truncate">{epicName(parent)}</span>
                </IssueLink>
              ) : (
                <IssueLink projectId={projectId} id={issue.parentId} className="hover:text-ink hover:underline">
                  <span className="text-ink-3">{header.parent}</span> <span className="font-mono text-xs">{issue.parentId}</span>
                  {parent ? ` ${ticketTitle(parent)}` : ''}
                </IssueLink>
              )}
            </dd>
          </div>
        ) : null}
        {pageEpic ? (
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">{header.progress}</dt>
            <dd>
              <Link
                to={paths.epics(projectId, pageEpic.id)}
                title={header.epicPageTitle(epicName(pageEpic))}
                className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-px text-xs text-ink-2 transition-colors hover:text-ink"
              >
                <Layers size={12} strokeWidth={2} aria-hidden="true" />
                {header.epicPage(epicShortName(pageEpic))}
              </Link>
            </dd>
          </div>
        ) : null}
      </dl>
      {issue.abandon ? <Abandoned abandon={issue.abandon} issue={issue} projectId={projectId} /> : null}
      {issue.declined ? <Declined /> : null}
      <Blocking issue={issue} projectId={projectId} />
      {issue.labels.length > 0 ? (
        <ul aria-label={header.labels} className="flex flex-wrap gap-1.5">
          {issue.labels.map((label) => (
            <li key={label} className="rounded-full border border-line px-2 text-xs leading-5 text-ink-2">
              {label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Un Renoncement (ADR 0008) : l'utilisateur a décidé de ne pas faire le ticket ; fermé, il n'est pas une Livraison. */
function Declined() {
  const { header } = useT().kanban;
  return (
    <p className="flex items-start gap-1.5 text-ink-2">
      <Ban size={13} aria-hidden="true" className="mt-1 shrink-0 text-ink-3" />
      <span className="min-w-0 wrap-anywhere">
        {header.declined}
        {header.notDelivered}
      </span>
    </p>
  );
}

/**
 * Un Abandon : de quel ticket il est le doublon, ou par lequel il est remplacé (avec un lien pour l'ouvrir, et son titre,
 * que la fiche porte : `linked`). Une cible hors du Projet (référence externe, ticket supprimé) est nommée sans lien.
 */
function Abandoned({ abandon, issue, projectId }: { abandon: NonNullable<IssueDetail['abandon']>; issue: IssueDetail; projectId: string }) {
  const { header } = useT().kanban;
  const target = issue.linked[abandon.of];
  return (
    <p className="flex items-start gap-1.5 text-ink-2">
      <ArchiveX size={13} aria-hidden="true" className="mt-1 shrink-0 text-ink-3" />
      <span className="min-w-0 wrap-anywhere">
        {abandon.cause === 'duplicate' ? header.duplicateOf : header.supersededBy}{' '}
        {target ? (
          <>
            <IssueLink projectId={projectId} id={abandon.of} className="font-mono text-xs text-ink hover:underline">
              {abandon.of}
            </IssueLink>{' '}
            {/* Un ticket sans titre n'est pas cité entre guillemets : « Sans titre » entre guillemets ne se distinguerait pas d'un ticket réellement intitulé ainsi. */}
            {isBlankTitle(target.title) ? header.untitled : header.quoted(ticketTitle(target))}
          </>
        ) : (
          <>
            <span className="font-mono text-xs text-ink">{abandon.of}</span> {header.outsideProject}
          </>
        )}
        {header.notDelivered}
      </span>
    </p>
  );
}

/** Ce qui retient le ticket : les tickets non fermés dont il dépend, ou le seul statut bloqué. Un ticket fermé n'est jamais retenu. */
function Blocking({ issue, projectId }: { issue: IssueDetail; projectId: string }) {
  const { header } = useT().kanban;
  if (issue.blockedBy.length === 0) {
    return issue.status === 'blocked' ? (
      <p className="flex items-start gap-1.5 text-ink-2">
        <Lock size={13} aria-hidden="true" className="mt-1 shrink-0 text-ink-3" />
        <span>{header.blockedStatusOnly}</span>
      </p>
    ) : null;
  }
  return (
    <p className="flex items-start gap-1.5 text-ink-2">
      <Lock size={13} aria-hidden="true" className="mt-1 shrink-0 text-ink-3" />
      <span className="min-w-0 wrap-anywhere">
        {header.blockedWaitingOn}{' '}
        {issue.blockedBy.map((id, index) => {
          // Le titre du bloquant, en infobulle : jamais vide (`title=""`), « Sans titre » pour un bloquant qui n'en a pas. Hors du Projet, rien à dire.
          const blocker = issue.linked[id];
          return (
            <Fragment key={id}>
              {index > 0 ? ', ' : null}
              <IssueLink projectId={projectId} id={id} title={blocker ? ticketTitle(blocker) : undefined} className="font-mono text-xs text-ink hover:underline">
                {id}
              </IssueLink>
            </Fragment>
          );
        })}
      </span>
    </p>
  );
}
