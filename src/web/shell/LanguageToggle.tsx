import { useLanguage, useT } from '../i18n';
import { languageOptions } from '../i18n/options';
import { cx } from '../lib/cx';
import { Tip } from '../ui/Tip';

/**
 * Trois boutons à bascule, sur le modèle de `ThemeToggle` : suivre la langue du navigateur, forcer le français ou l'anglais. Le choix
 * est mémorisé. Rien tant que le sélecteur n'est pas activé (`LANGUAGE_SWITCH_ENABLED`). Les noms de langue sont écrits dans leur
 * langue, et le bouton comme l'infobulle le disent (`lang`) aux lecteurs d'écran.
 *
 * Sur desktop, il est au pied de la barre latérale (`tone="side"`), au-dessus du thème : la barre du haut est recouverte par le Panneau
 * de ticket à droite, et sur mobile elle n'a pas la place de trois boutons de plus (le nom du Projet disparaîtrait sous 390 px). Sur
 * mobile, la langue se change par la palette (bouton Rechercher), comme partout.
 */
export function LanguageToggle({ className, tone = 'page' }: { className?: string; tone?: 'page' | 'side' }) {
  const side = tone === 'side';
  const { preference, setPreference, switchEnabled } = useLanguage();
  const t = useT();
  if (!switchEnabled) return null;
  return (
    <div
      role="group"
      aria-label={t.shell.language.group}
      className={cx('inline-flex items-center gap-0.5 self-start rounded-lg border p-0.5', side ? 'border-side-line bg-side-hover' : 'border-line bg-well', className)}
    >
      {languageOptions(t).map(({ value, label, labelLanguage, mark }) => {
        const active = preference === value;
        return (
          <Tip key={value} label={label} lang={labelLanguage}>
            <button
              type="button"
              aria-label={label}
              aria-pressed={active}
              lang={labelLanguage}
              onClick={() => setPreference(value)}
              className={cx(
                'grid h-7 min-w-7 place-items-center rounded-md px-1 text-xs font-semibold transition-colors',
                // Couleurs exclusives : deux classes de couleur sur le même bouton, la feuille compilée choisit, pas l'ordre écrit ici
                // (le choix fait, en encre claire sur le jaune, tomberait à 1,3:1).
                active
                  ? side
                    ? 'bg-mark text-mark-ink'
                    : 'bg-panel text-ink shadow-[0_0_0_1px_var(--line)]'
                  : side
                    ? 'text-side-ink-3 hover:text-side-ink'
                    : 'text-ink-3 hover:text-ink',
              )}
            >
              {'icon' in mark ? (
                <mark.icon size={15} strokeWidth={1.9} aria-hidden="true" />
              ) : (
                <span aria-hidden="true">{mark.code}</span>
              )}
            </button>
          </Tip>
        );
      })}
    </div>
  );
}
