import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

/** Un titre qui s'ajuste à son texte, et un contour de focus qui l'épouse de près : voir `SectionTitle` et `Page`. */
const TIGHT_OUTLINE = 'w-fit max-w-full rounded-sm focus-visible:outline-offset-1';

/**
 * Cadre commun des pages : titre, phrase d'explication, contenu. Largeur de lecture limitée, sauf `wide` : le contenu
 * prend toute la largeur du panneau, avec des marges et des écarts plus serrés (le kanban). `eyebrow` : un lien de retour
 * ou un fil d'Ariane, au-dessus du titre.
 */
export function Page({
  title,
  description,
  eyebrow,
  children,
  wide = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  children?: ReactNode;
  wide?: boolean;
}) {
  // Un titre qui n'est pas un texte est un squelette (`<Skeleton />`, avec ou sans texte pour les lecteurs d'écran) : la page qui le remplace aura le sien. On le marque,
  // pour que le focus que « Réessayer » rend à la page ne s'y pose pas (voir `titleOf`) : le squelette part, et le focus tomberait sur le corps de la page.
  const skeleton = typeof title !== 'string';
  return (
    <div
      className={cx(
        'mx-auto flex w-full min-w-0 flex-col px-4 py-6 md:py-8',
        wide ? 'gap-4 md:px-5' : 'max-w-4xl gap-7 md:px-8',
      )}
    >
      <header className="min-w-0">
        {eyebrow ? <div className="mb-2 text-ui">{eyebrow}</div> : null}
        {/* wrap-anywhere : un id, un chemin ou un nom de fichier sans espace passe à la ligne au lieu d'être rogné. */}
        <h1
          data-skeleton={skeleton ? '' : undefined}
          className={cx(
            'wrap-anywhere text-xl font-semibold tracking-[-0.02em] text-ink md:text-[22px] md:leading-7',
            // Le titre prend le focus par programme à l'arrivée d'une page qu'un « Réessayer » a rechargée (voir `useRetryFocus`) : son contour (au clavier
            // seulement) entoure le texte, pas toute la largeur de l'en-tête. Pas pour un squelette, dont la largeur en pourcentage tomberait à zéro.
            !skeleton && TIGHT_OUTLINE,
          )}
        >
          {title}
        </h1>
        {description ? <p className="mt-1.5 max-w-[62ch] wrap-anywhere text-[14px] leading-6 text-ink-2">{description}</p> : null}
      </header>
      {children}
    </div>
  );
}

/** Page dont le contenu est l'objet d'un autre ticket : dit lequel, sans rien promettre de plus. */
export function ComingSoon({ ticket, children }: { ticket: string; children: ReactNode }) {
  return (
    <aside className="flex items-start gap-3 rounded-lg border border-line bg-well p-4">
      <span className="mt-px inline-flex h-5 shrink-0 items-center rounded-full bg-accent-soft px-2 text-xs font-medium text-accent">
        À venir
      </span>
      <p className="min-w-0 text-ink-2">
        {children} <code className="whitespace-nowrap font-mono text-xs text-ink">{ticket}</code>
      </p>
    </aside>
  );
}

/** Intertitre d'une section de page. Même contour resserré que le titre de la page : celui d'une section prend le focus quand elle se recharge. */
export function SectionTitle({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className={cx('text-ui font-semibold text-ink', TIGHT_OUTLINE)}>
      {children}
    </h2>
  );
}
