import { keyCaps } from '../lib/platform';
import { useShortcutRegistry } from '../shortcuts/ShortcutsProvider';
import { cx } from '../lib/cx';

/** Touche de clavier isolée. */
export function Kbd({ children, className }: { children: string; className?: string }) {
  return <kbd className={cx('kbd', className)}>{children}</kbd>;
}

/**
 * Raccourci affiché en touches : `mod+k` donne ⌘ K (ou Ctrl K), `g k` donne G puis K.
 * Décoratif pour les lecteurs d'écran : la commande porte déjà son nom. Pour le masquer selon le
 * contexte, l'envelopper dans un élément qui porte la classe d'affichage.
 */
export function ShortcutKeys({ keys, className }: { keys: string; className?: string }) {
  const { isMac } = useShortcutRegistry();
  const steps = keys.split(' ');
  return (
    <span className={cx('inline-flex items-center gap-1', className)} aria-hidden="true">
      {steps.map((step, index) => (
        <span key={index} className="inline-flex items-center gap-0.5">
          {keyCaps(step, isMac).map((cap, i) => (
            <Kbd key={i}>{cap}</Kbd>
          ))}
        </span>
      ))}
    </span>
  );
}
