import type { EpicGroup, EpicProgress } from '../../domain/epics';
import { EPIC_GROUPS } from '../../domain/epics';
import type { Issue } from '../data/types';
import { formatPercent } from '../metrics/format';
import { SectionTitle } from '../pages/Page';
import { groupMeta } from './ByColumn';
import { counted, ProgressBar } from './ProgressBar';

/** « 2 Livraisons sur 5 Enfants » : la phrase qui dit l'avancement, aux yeux comme aux lecteurs d'écran. */
export function progressSentence({ delivered, total }: Pick<EpicProgress, 'delivered' | 'total'>): string {
  return `${counted(delivered, 'Livraison')} sur ${counted(total, 'Enfant')}`;
}

/**
 * L'avancement de l'Epic : ses Livraisons parmi ses Enfants à livrer, en nombre, sur une barre ; la répartition des Enfants
 * par colonne ; et les Abandons, qui ne sont ni une Livraison ni du travail à venir. Sans Enfant à livrer, rien n'est mesuré :
 * la section le dit au lieu d'afficher 0 %.
 */
export function ProgressSection({ progress, groups }: { progress: EpicProgress; groups: Record<EpicGroup, Issue[]> }) {
  const { delivered, total, ratio, abandoned, children } = progress;
  return (
    <section aria-labelledby="epic-progress" className="flex flex-col gap-3">
      <SectionTitle id="epic-progress">Avancement</SectionTitle>

      {ratio === null ? (
        <p className="text-ink-2">
          {children === 0
            ? 'Aucun Enfant : cette Epic ne regroupe encore aucun ticket.'
            : `Aucun Enfant à livrer : ${counted(abandoned, 'Enfant')} ${abandoned > 1 ? 'sont des Abandons' : 'est un Abandon'}.`}
        </p>
      ) : (
        <>
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="tnum text-[17px] font-semibold text-ink">{progressSentence(progress)}</span>
            <span className="tnum text-ink-2">{formatPercent(ratio)}</span>
          </p>
          <ProgressBar delivered={delivered} total={total} label="Avancement de l’Epic" valueText={progressSentence(progress)} />
        </>
      )}

      {children > 0 ? (
        <ul aria-label="Enfants par colonne" className="flex flex-wrap gap-1.5">
          {EPIC_GROUPS.filter((group) => groups[group].length > 0).map((group) => {
            const { label, icon: Icon } = groupMeta(group);
            return (
              <li key={group} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 text-xs leading-5 text-ink-2">
                <Icon size={11} strokeWidth={2} aria-hidden="true" className="shrink-0 text-ink-3" />
                {label} <span className="tnum font-medium text-ink">{groups[group].length}</span>
                {/* Les Abandons sont fermés : tous dans Terminé, où la section des Enfants les compte aussi. */}
                {group === 'done' && abandoned > 0 ? (
                  <>
                    {' '}
                    <span className="text-ink-3">dont {counted(abandoned, 'Abandon')}</span>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {abandoned > 0 ? (
        <p className="text-xs text-ink-3">
          {abandoned > 1
            ? `${abandoned} Abandons (doublons ou remplacés) ne sont comptés ni parmi les Livraisons ni parmi les Enfants à livrer.`
            : `${abandoned} Abandon (doublon ou remplacé) n’est compté ni parmi les Livraisons ni parmi les Enfants à livrer.`}
        </p>
      ) : null}
    </section>
  );
}
