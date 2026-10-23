import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Fragment } from 'react';
import type { Shortcut } from '../shortcuts/registry';
import { useShortcutList } from '../shortcuts/ShortcutsProvider';
import { dialogOverlay, dialogSurface } from '../ui/dialog';
import { ShortcutKeys } from '../ui/Kbd';
import { useShortcutsHelp } from './OverlayProvider';

/** Liste des raccourcis enregistrés, par rubrique : elle s'enrichit toute seule des raccourcis des pages. */
export function ShortcutsHelp() {
  const { open, show, close } = useShortcutsHelp();
  const shortcuts = useShortcutList();
  const groups = new Map<string, Shortcut[]>();
  for (const shortcut of shortcuts) {
    groups.set(shortcut.group, [...(groups.get(shortcut.group) ?? []), shortcut]);
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? show() : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={dialogSurface} aria-describedby="shortcuts-help-description">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <Dialog.Title className="text-[15px] font-semibold text-ink">Raccourcis clavier</Dialog.Title>
              <Dialog.Description id="shortcuts-help-description" className="mt-0.5 text-ink-2">
                Ils sont ignorés quand le curseur est dans un champ de saisie.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Fermer"
              className="-mr-1.5 -mt-1 grid size-8 place-items-center rounded-md text-ink-3 transition-colors hover:bg-hover hover:text-ink"
            >
              <X size={16} aria-hidden="true" />
            </Dialog.Close>
          </div>

          <div className="max-h-[min(60dvh,28rem)] overflow-y-auto px-5 py-3">
            {[...groups].map(([group, items]) => (
              <section key={group} aria-label={group} className="py-2">
                <h3 className="pb-1 text-xs font-medium text-ink-3">{group}</h3>
                <ul>
                  {items.map((shortcut) => (
                    <li
                      key={shortcut.id}
                      className="flex min-h-9 items-center justify-between gap-4 border-b border-line py-1.5 last:border-b-0"
                    >
                      <span>{shortcut.label}</span>
                      <SequenceKeys keys={shortcut.keys} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Une séquence s'écrit « G puis K » ; une combinaison, « ⌘ K ». */
function SequenceKeys({ keys }: { keys: string }) {
  const steps = keys.split(' ');
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {steps.map((step, index) => (
        // L'index est la seule clé unique : une séquence peut répéter une touche (« g g »).
        <Fragment key={index}>
          {index > 0 ? <span className="text-xs text-ink-3">puis</span> : null}
          <ShortcutKeys keys={step} />
        </Fragment>
      ))}
    </span>
  );
}
