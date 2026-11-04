import {
  ArchiveX,
  BookOpen,
  Bug,
  CircleDot,
  Flag,
  FlaskConical,
  GitFork,
  Sparkles,
  SquareCheckBig,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { IssueAbandon } from '../data/types';
import { isIssueType, priorityMeta, typeMeta, type IssueType } from '../design/issue-palette';
import { cx } from '../lib/cx';

/** Un pictogramme par type : la forme porte l'information autant que la couleur. */
const TYPE_ICONS: Record<IssueType, LucideIcon> = {
  bug: Bug,
  feature: Sparkles,
  task: SquareCheckBig,
  chore: Wrench,
  epic: Zap,
  decision: GitFork,
  spike: FlaskConical,
  story: BookOpen,
  milestone: Flag,
};

export function TypeGlyph({
  type,
  size = 14,
  className,
}: {
  type: string;
  size?: number;
  className?: string;
}) {
  const Icon = isIssueType(type) ? TYPE_ICONS[type] : CircleDot;
  return (
    <Icon
      size={size}
      strokeWidth={2}
      aria-hidden="true"
      className={cx('shrink-0', className)}
      style={{ color: typeMeta(type).color }}
    />
  );
}

/** Type en toutes lettres : pictogramme coloré et libellé. */
export function TypeBadge({ type, className }: { type: string; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-ink-2', className)}>
      <TypeGlyph type={type} />
      {typeMeta(type).label}
    </span>
  );
}

/**
 * Priorité en barres (3 barres pour P1, 0 pour P4, comme un signal) ; P0 est un carré plein,
 * le seul élément plein de l'interface : une urgence se repère sans lire.
 */
export function PriorityGlyph({
  priority,
  size = 14,
  className,
}: {
  priority: number;
  size?: number;
  className?: string;
}) {
  const meta = priorityMeta(priority);
  return (
    <svg
      viewBox="0 0 14 14"
      width={size}
      height={size}
      aria-hidden="true"
      className={cx('shrink-0', className)}
    >
      {meta.priority === 0 ? (
        <>
          <rect x="1" y="1" width="12" height="12" rx="3.2" fill={meta.color} />
          <path d="M7 4.2v3.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="7" cy="10" r="1" fill="#fff" />
        </>
      ) : (
        [0, 1, 2].map((i) => (
          <rect
            key={i}
            x={1.6 + i * 4.2}
            y={12 - (4 + i * 3)}
            width="3"
            height={4 + i * 3}
            rx="0.9"
            fill={i < 4 - meta.priority ? meta.color : 'var(--line-strong)'}
          />
        ))
      )}
    </svg>
  );
}

/** Priorité : barres et code (`P1`) ; le libellé complet reste en infobulle et pour les lecteurs d'écran. */
export function PriorityBadge({ priority, className }: { priority: number; className?: string }) {
  const meta = priorityMeta(priority);
  return (
    <span
      className={cx('inline-flex items-center gap-1.5 text-ink-2', className)}
      title={`Priorité ${meta.label}`}
    >
      <PriorityGlyph priority={priority} />
      <span className="tnum">{meta.code}</span>
      <span className="sr-only">{meta.label}</span>
    </span>
  );
}

/** Le motif d'un Abandon, dit comme la fin d'une phrase : « doublon de bdesk-12 », « remplacé par bdesk-12 ». */
export function abandonReason({ cause, of }: IssueAbandon): string {
  return cause === 'duplicate' ? `doublon de ${of}` : `remplacé par ${of}`;
}

/**
 * Pastille « Abandon » : le ticket est fermé parce qu'il double un autre ou qu'un autre le remplace. Rangé dans Terminé avec
 * les Livraisons, il n'en est pas une : la pastille le dit sur la carte, dans le détail et dans l'avancement d'une Epic. Le
 * motif et le ticket concerné se lisent à l'infobulle et aux lecteurs d'écran ; le détail du ticket les écrit en toutes lettres.
 * Contour en pointillés et gris : ce n'est pas un travail livré, sans que ce soit une alerte.
 */
export function AbandonBadge({
  abandon,
  className,
  withReason = true,
}: {
  abandon: IssueAbandon;
  className?: string;
  /** Dire le motif aux lecteurs d'écran (par défaut) ; faux quand une phrase voisine le dit déjà. */
  withReason?: boolean;
}) {
  const reason = abandonReason(abandon);
  return (
    <span
      title={`Abandon : ${reason}`}
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-line-strong bg-well px-1.5 text-micro font-medium text-ink-2',
        className,
      )}
    >
      <ArchiveX size={11} aria-hidden="true" />
      Abandon
      {withReason ? <span className="sr-only"> : {reason}</span> : null}
    </span>
  );
}
