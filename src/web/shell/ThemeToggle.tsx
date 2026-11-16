import { cx } from '../lib/cx';
import { THEME_OPTIONS } from '../theme/options';
import { useTheme } from '../theme/ThemeProvider';
import { Tip } from '../ui/Tip';

/**
 * Trois boutons à bascule : suivre le système, forcer le clair ou le sombre. Le choix est mémorisé.
 * `tone="side"` : sur la barre latérale marine, avec ses encres et ses voiles clairs ; le choix fait y porte la marque.
 */
export function ThemeToggle({ className, tone = 'page' }: { className?: string; tone?: 'page' | 'side' }) {
  const side = tone === 'side';
  const { preference, setPreference } = useTheme();
  return (
    <div
      role="group"
      aria-label="Thème"
      className={cx('inline-flex items-center gap-0.5 rounded-lg border p-0.5', side ? 'border-side-line bg-side-hover' : 'border-line bg-well', className)}
    >
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = preference === value;
        return (
          <Tip key={value} label={label}>
            <button
              type="button"
              aria-label={label}
              aria-pressed={active}
              onClick={() => setPreference(value)}
              className={cx(
                'grid size-7 place-items-center rounded-md transition-colors',
                side ? 'text-side-ink-3 hover:text-side-ink' : 'text-ink-3 hover:text-ink',
                active && (side ? 'bg-mark text-mark-ink hover:text-mark-ink' : 'bg-panel text-ink shadow-[0_0_0_1px_var(--line)] hover:text-ink'),
              )}
            >
              <Icon size={15} strokeWidth={1.9} aria-hidden="true" />
            </button>
          </Tip>
        );
      })}
    </div>
  );
}
