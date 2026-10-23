import { cx } from '../lib/cx';
import { THEME_OPTIONS } from '../theme/options';
import { useTheme } from '../theme/ThemeProvider';
import { Tip } from '../ui/Tip';

/** Trois boutons à bascule : suivre le système, forcer le clair ou le sombre. Le choix est mémorisé. */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  return (
    <div
      role="group"
      aria-label="Thème"
      className={cx('inline-flex items-center gap-0.5 rounded-lg border border-line bg-well p-0.5', className)}
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
                'grid size-6 place-items-center rounded-md text-ink-3 transition-colors hover:text-ink',
                active && 'bg-panel text-ink shadow-[0_0_0_1px_var(--line)] hover:text-ink',
              )}
            >
              <Icon size={14} strokeWidth={1.9} aria-hidden="true" />
            </button>
          </Tip>
        );
      })}
    </div>
  );
}
