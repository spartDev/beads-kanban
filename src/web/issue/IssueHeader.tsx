import { ArchiveX, Layers, Lock } from 'lucide-react';
import { Fragment } from 'react';
import { Link } from 'react-router';
import type { IssueDetail } from '../data/types';
import { statusLabel } from '../design/issue-palette';
import { epicName, epicShortName } from '../kanban/epics';
import { paths } from '../paths';
import { AbandonBadge, PriorityBadge, TypeBadge, TypeGlyph } from '../ui/IssueBadges';
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

  return (
    <div className="flex flex-col gap-2">
      <dl className="flex flex-wrap items-center gap-x-4 gap-y-1.5 wrap-anywhere text-ink-2">
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Type</dt>
          <dd>
            <TypeBadge type={issue.type} />
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Priorité</dt>
          <dd>
            <PriorityBadge priority={issue.priority} />
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Statut</dt>
          <dd>
            {statusLabel(issue.status)}
            {/* Fermé sans être une Livraison : la phrase sous la liste dit pourquoi, la pastille n'a pas à le redire aux lecteurs d'écran. */}
            {issue.abandon ? <AbandonBadge abandon={issue.abandon} withReason={false} className="ml-1.5 align-middle" /> : null}
          </dd>
        </div>
        {issue.assignee ? (
          <div className="flex items-center gap-1.5">
            <dt className="shrink-0 text-ink-3">Assigné à</dt>
            <dd>{issue.assignee}</dd>
          </div>
        ) : null}
        {issue.parentId ? (
          <div className="flex min-w-0 max-w-full items-center gap-1.5">
            <dt className="sr-only">Parent</dt>
            <dd className="min-w-0">
              {parent?.type === 'epic' ? (
                <IssueLink
                  projectId={projectId}
                  id={parent.id}
                  title={epicName(parent)}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-well px-1.5 py-px text-xs text-ink-2 transition-colors hover:text-ink"
                >
                  <TypeGlyph type="epic" size={12} />
                  <span className="sr-only">Epic :</span> <span className="min-w-0 truncate">{epicName(parent)}</span>
                </IssueLink>
              ) : (
                <IssueLink projectId={projectId} id={issue.parentId} className="hover:text-ink hover:underline">
                  <span className="text-ink-3">Parent</span> <span className="font-mono text-xs">{issue.parentId}</span>
                  {parent ? ` ${parent.title}` : ''}
                </IssueLink>
              )}
            </dd>
          </div>
        ) : null}
        {pageEpic ? (
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Avancement</dt>
            <dd>
              <Link
                to={paths.epics(projectId, pageEpic.id)}
                title={`Avancement, Enfants, Lead Time et prévision de l’Epic «\u00a0${epicName(pageEpic)}\u00a0»`}
                className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-px text-xs text-ink-2 transition-colors hover:text-ink"
              >
                <Layers size={12} strokeWidth={2} aria-hidden="true" />
                Page Epic : {epicShortName(pageEpic)}
              </Link>
            </dd>
          </div>
        ) : null}
      </dl>
      {issue.abandon ? <Abandoned abandon={issue.abandon} issue={issue} projectId={projectId} /> : null}
      <Blocking issue={issue} projectId={projectId} />
      {issue.labels.length > 0 ? (
        <ul aria-label="Étiquettes" className="flex flex-wrap gap-1.5">
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

/**
 * Un Abandon : de quel ticket il est le doublon, ou par lequel il est remplacé (avec un lien pour l'ouvrir, et son titre,
 * que la fiche porte : `linked`). Une cible hors du Projet (référence externe, ticket supprimé) est nommée sans lien.
 */
function Abandoned({ abandon, issue, projectId }: { abandon: NonNullable<IssueDetail['abandon']>; issue: IssueDetail; projectId: string }) {
  const target = issue.linked[abandon.of];
  return (
    <p className="flex items-start gap-1.5 text-ink-2">
      <ArchiveX size={13} aria-hidden="true" className="mt-1 shrink-0 text-ink-3" />
      <span className="min-w-0 wrap-anywhere">
        {abandon.cause === 'duplicate' ? 'Doublon de' : 'Remplacé par'}{' '}
        {target ? (
          <>
            <IssueLink projectId={projectId} id={abandon.of} className="font-mono text-xs text-ink hover:underline">
              {abandon.of}
            </IssueLink>{' '}
            «&nbsp;{target.title}&nbsp;»
          </>
        ) : (
          <>
            <span className="font-mono text-xs text-ink">{abandon.of}</span> (hors du Projet)
          </>
        )}
        . Fermé sans être une Livraison.
      </span>
    </p>
  );
}

/** Ce qui retient le ticket : les tickets non fermés dont il dépend, ou le seul statut bloqué. Un ticket fermé n'est jamais retenu. */
function Blocking({ issue, projectId }: { issue: IssueDetail; projectId: string }) {
  if (issue.blockedBy.length === 0) {
    return issue.status === 'blocked' ? (
      <p className="flex items-start gap-1.5 text-ink-2">
        <Lock size={13} aria-hidden="true" className="mt-1 shrink-0 text-ink-3" />
        <span>Statut bloqué, sans dépendance en suspens</span>
      </p>
    ) : null;
  }
  return (
    <p className="flex items-start gap-1.5 text-ink-2">
      <Lock size={13} aria-hidden="true" className="mt-1 shrink-0 text-ink-3" />
      <span className="min-w-0 wrap-anywhere">
        Bloqué : attend{' '}
        {issue.blockedBy.map((id, index) => (
          <Fragment key={id}>
            {index > 0 ? ', ' : null}
            <IssueLink projectId={projectId} id={id} title={issue.linked[id]?.title} className="font-mono text-xs text-ink hover:underline">
              {id}
            </IssueLink>
          </Fragment>
        ))}
      </span>
    </p>
  );
}
