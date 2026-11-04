import type { IssueDetail } from '../data/types';
import { statusLabel } from '../design/issue-palette';
import { TypeGlyph } from '../ui/IssueBadges';
import { IssueLink } from './IssueLink';
import { type RelationGroup, groupRelations } from './relationGroups';
import { Section } from './Section';

/**
 * Les relations du ticket, par genre : parent et enfants, ce qui le bloque et ce qu'il bloque, ce qui lui est lié, d'où
 * il vient. Chaque ticket lié est un lien vers son panneau, avec son titre et son statut (la fiche les porte : `linked`).
 * Un ticket qui bloque encore l'est dit, tant que le ticket lui-même n'est pas fermé (un ticket fermé n'est plus retenu par
 * personne) ; un ticket hors du Projet n'est pas un lien, il n'y a rien à ouvrir.
 */
export function Relations({ issue, projectId }: { issue: IssueDetail; projectId: string }) {
  const groups = groupRelations(issue);
  if (groups.length === 0) return null;
  return (
    <Section title="Relations">
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <Group key={group.id} group={group} projectId={projectId} held={issue.status !== 'closed'} />
        ))}
      </div>
    </Section>
  );
}

function Group({ group, projectId, held }: { group: RelationGroup; projectId: string; held: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-xs font-medium text-ink-3">{group.label}</h4>
      <ul aria-label={group.label} className="flex flex-col">
        {group.items.map(({ id, ref }) => (
          <li key={id} className="min-w-0">
            {ref ? (
              <IssueLink
                projectId={projectId}
                id={id}
                className="-mx-1.5 flex min-w-0 flex-wrap items-baseline gap-x-2 rounded-md px-1.5 py-1 transition-colors hover:bg-hover"
              >
                <TypeGlyph type={ref.type} className="self-center" />
                <span className="shrink-0 font-mono text-xs text-ink-3">{id}</span>{' '}
                {/* Le titre passe à la ligne, sous l'identifiant, quand la place manque : jamais rogné. */}
                <span className="min-w-0 flex-1 basis-40 wrap-anywhere text-ink">{ref.title}</span>{' '}
                <span className="shrink-0 text-xs text-ink-3">{statusLabel(ref.status)}</span>
                {/* Un ticket « bloqué par » qui n'est pas fermé retient encore celui-ci, s'il n'est pas fermé lui-même. */}
                {held && group.id === 'blocked-by' && ref.status !== 'closed' ? (
                  <>
                    {' '}
                    <span className="shrink-0 rounded-full bg-danger-soft px-1.5 text-xs text-danger">Bloque encore</span>
                  </>
                ) : null}
              </IssueLink>
            ) : (
              <span className="flex min-w-0 items-baseline gap-2 py-1">
                <span className="min-w-0 break-all font-mono text-xs text-ink-2">{id}</span>{' '}
                <span className="shrink-0 text-xs text-ink-3">hors du Projet</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
