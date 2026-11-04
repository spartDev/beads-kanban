import { cx } from '../lib/cx';

/** Le nom d'un nombre accordé : « 1 Livraison », « 2 Livraisons » (zéro est singulier en français). */
export const counted = (count: number, singular: string, plural = `${singular}s`): string => `${count} ${count > 1 ? plural : singular}`;

/**
 * La barre d'avancement d'une Epic : ses Livraisons parmi les Enfants à livrer, en nombre. `total` n'est jamais nul (sans Enfant
 * à livrer il n'y a rien à mesurer, et les pages le disent au lieu de dessiner une barre vide). La valeur dite aux lecteurs d'écran
 * (`valueText`) est la phrase, pas le seul nombre.
 */
export function ProgressBar({
  delivered,
  total,
  label,
  valueText,
  className,
}: {
  delivered: number;
  total: number;
  label: string;
  valueText: string;
  className?: string;
}) {
  const share = Math.min(1, Math.max(0, delivered / total));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={delivered}
      aria-valuetext={valueText}
      className={cx('h-2 w-full overflow-hidden rounded-full bg-press', className)}
    >
      <div className="h-full rounded-full bg-accent" style={{ width: `${share * 100}%` }} />
    </div>
  );
}
