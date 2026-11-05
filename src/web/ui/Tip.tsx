import * as Tooltip from '@radix-ui/react-tooltip';
import type { ReactElement, ReactNode } from 'react';
import { isFocusReturning } from '../lib/focus';
import { ShortcutKeys } from './Kbd';

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <Tooltip.Provider delayDuration={350} skipDelayDuration={250}>
    {children}
  </Tooltip.Provider>
);

/**
 * Infobulle accessible au clavier et au survol ; `shortcut` ajoute les touches associées. Elle ne s'ouvre pas quand le focus est rendu au
 * bouton par programme (la palette ou l'aide qu'il a ouverte se referme) : l'utilisateur sait ce qu'il vient d'activer, et l'infobulle
 * prendrait le prochain Échap.
 */
export function Tip({
  label,
  shortcut,
  side = 'top',
  children,
}: {
  label: string;
  shortcut?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactElement;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        asChild
        onFocus={(event) => {
          // Radix n'ouvre pas l'infobulle quand le gestionnaire du focus empêche l'événement par défaut.
          if (isFocusReturning()) event.preventDefault();
        }}
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-[60] flex max-w-72 items-center gap-2 rounded-md border border-line-strong bg-float px-2 py-1 text-xs text-ink shadow-float"
        >
          <span>{label}</span>
          {shortcut ? <ShortcutKeys keys={shortcut} /> : null}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
