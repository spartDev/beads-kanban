import type { EpicGroup, EpicProgress } from '../../domain/epics';
import { EPIC_GROUPS } from '../../domain/epics';
import type { Issue } from '../data/types';
import { useFormat, useT, type DisplayFormat, type Messages } from '../i18n';
import { SectionTitle } from '../pages/Page';
import { useGroupMeta } from './ByColumn';
import { closedUndelivered, closedUndeliveredKind } from './closedUndelivered';
import { ProgressBar } from './ProgressBar';

/** « 2 Livraisons sur 5 Enfants » : la phrase qui dit l'avancement, aux yeux comme aux lecteurs d'écran. */
export function progressSentence(
  { delivered, total }: Pick<EpicProgress, 'delivered' | 'total'>,
  t: Messages,
  { formatCount }: Pick<DisplayFormat, 'formatCount'>,
): string {
  const { counted, progress } = t.epics;
  return progress.sentence(counted.deliveries(delivered, formatCount(delivered)), counted.children(total, formatCount(total)));
}

/**
 * L'avancement de l'Epic : ses Livraisons parmi ses Enfants à livrer, en nombre, sur une barre ; la répartition des Enfants
 * par colonne ; et les Abandons et les Renoncements, qui ne sont ni une Livraison ni du travail à venir. Sans Enfant à livrer, rien
 * n'est mesuré : la section le dit au lieu d'afficher 0 %.
 */
export function ProgressSection({ progress, groups }: { progress: EpicProgress; groups: Record<EpicGroup, Issue[]> }) {
  const t = useT();
  const format = useFormat();
  const groupMeta = useGroupMeta();
  const { counted, progress: words } = t.epics;
  const { delivered, total, ratio, abandoned, declined, children } = progress;
  const closed = abandoned + declined;
  const closedKind = closedUndeliveredKind(progress);
  const sentence = progressSentence(progress, t, format);
  return (
    <section aria-labelledby="epic-progress" className="flex flex-col gap-3">
      <SectionTitle id="epic-progress">{words.title}</SectionTitle>

      {ratio === null ? (
        <p className="text-ink-2">
          {children === 0 || closedKind === null
            ? words.noChildrenSentence
            : words.nothingToDeliver(closed, counted.children(closed, format.formatCount(closed)), closedKind)}
        </p>
      ) : (
        <>
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="tnum text-[1.1875rem] font-bold text-ink">{sentence}</span>
            <span className="tnum text-ink-2">{format.formatPercent(ratio)}</span>
          </p>
          <ProgressBar delivered={delivered} total={total} label={words.bar} valueText={sentence} />
        </>
      )}

      {children > 0 ? (
        <ul aria-label={words.byColumn} className="flex flex-wrap gap-1.5">
          {EPIC_GROUPS.filter((group) => groups[group].length > 0).map((group) => {
            const { label, icon: Icon } = groupMeta(group);
            return (
              <li key={group} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 text-xs leading-5 text-ink-2">
                <Icon size={11} strokeWidth={2} aria-hidden="true" className="shrink-0 text-ink-3" />
                {label} <span className="tnum font-medium text-ink">{format.formatCount(groups[group].length)}</span>
                {/* Les Abandons et les Renoncements sont fermés : tous dans Terminé, où la section des Enfants les compte aussi. */}
                {group === 'done' && closed > 0 ? (
                  <>
                    {' '}
                    <span className="text-ink-3">{words.including(closedUndelivered(progress, t, format))}</span>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {abandoned > 0 ? <p className="text-xs text-ink-3">{words.droppedNote(abandoned, format.formatCount(abandoned))}</p> : null}
      {declined > 0 ? <p className="text-xs text-ink-3">{words.declinedNote(declined, format.formatCount(declined))}</p> : null}
    </section>
  );
}
