import { Inbox } from 'lucide-react';
import { useMemo } from 'react';
import { useIssues } from '../data/hooks';
import { isEpic } from '../data/helpers';
import type { Issue } from '../data/types';
import { ISSUE_TYPES, PRIORITIES, PRIORITY_META, typeMeta } from '../design/issue-palette';
import { DistributionBar, type Segment } from '../ui/DistributionBar';
import { PriorityGlyph, TypeGlyph } from '../ui/IssueBadges';
import { ErrorNotice, Notice, Skeleton } from '../ui/states';
import { SectionTitle } from './Page';

/** Répartition par type : un segment par type connu, puis les types personnalisés de beads. */
export function typeSegments(issues: readonly Issue[]): Segment[] {
  const counts = new Map<string, number>();
  for (const issue of issues) counts.set(issue.type, (counts.get(issue.type) ?? 0) + 1);
  const known = new Set<string>(ISSUE_TYPES);
  const others = [...counts.keys()].filter((type) => !known.has(type)).sort();
  return [...ISSUE_TYPES, ...others].map((type) => ({
    key: type,
    label: typeMeta(type).label,
    count: counts.get(type) ?? 0,
    color: typeMeta(type).color,
    icon: <TypeGlyph type={type} size={13} />,
  }));
}

export function prioritySegments(issues: readonly Issue[]): Segment[] {
  return PRIORITIES.map((priority) => ({
    key: String(priority),
    label: `${PRIORITY_META[priority].code} ${PRIORITY_META[priority].label.toLowerCase()}`,
    count: issues.filter((issue) => issue.priority === priority).length,
    color: PRIORITY_META[priority].color,
    icon: <PriorityGlyph priority={priority} size={13} />,
  }));
}

/**
 * Ce que le Projet contient déjà, lu depuis l'API : prouve la chaîne de données et montre le code
 * couleur des types et des priorités en situation. Gère chargement, erreur et Projet sans ticket.
 */
export function IssueFacts({ projectId }: { projectId: string }) {
  const issues = useIssues(projectId);
  const data = issues.data;
  const epicCount = useMemo(() => data?.filter(isEpic).length ?? 0, [data]);

  return (
    <section aria-labelledby="facts-title" className="flex flex-col gap-4">
      <SectionTitle id="facts-title">Dans ce Projet</SectionTitle>

      {/* Un rafraîchissement raté garde les chiffres affichés : l'erreur n'a la parole que faute de données. */}
      {data ? (
        data.length === 0 ? (
          <Notice icon={Inbox} title="Aucun ticket dans ce Projet">
            Créez-en un avec <code>bd create</code> : il apparaîtra ici au prochain chargement.
          </Notice>
        ) : (
          <>
            <p className="tnum text-ink-2">
              <strong className="font-semibold text-ink">{data.length}</strong> tickets, dont{' '}
              <strong className="font-semibold text-ink">{epicCount}</strong> Epics
            </p>
            <div className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-ink-3">Par type</h3>
              <DistributionBar label="Tickets par type" segments={typeSegments(data)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-ink-3">Par priorité</h3>
              <DistributionBar label="Tickets par priorité" segments={prioritySegments(data)} />
            </div>
          </>
        )
      ) : issues.isError ? (
        <ErrorNotice error={issues.error} title="Impossible de charger les tickets" onRetry={() => void issues.refetch()} />
      ) : (
        <div role="status" aria-busy="true" aria-label="Chargement des tickets" className="flex flex-col gap-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-1.5 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}
    </section>
  );
}

