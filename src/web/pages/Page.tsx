import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

/**
 * Cadre commun des pages : titre, phrase d'explication, contenu. Largeur de lecture limitée, sauf `wide` : le contenu
 * prend toute la largeur du panneau, avec des marges et des écarts plus serrés (le kanban).
 */
export function Page({
  title,
  description,
  children,
  wide = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={cx(
        'mx-auto flex w-full min-w-0 flex-col px-4 py-6 md:py-8',
        wide ? 'gap-4 md:px-5' : 'max-w-4xl gap-7 md:px-8',
      )}
    >
      <header className="min-w-0">
        {/* wrap-anywhere : un id, un chemin ou un nom de fichier sans espace passe à la ligne au lieu d'être rogné. */}
        <h1 className="wrap-anywhere text-xl font-semibold tracking-[-0.02em] text-ink md:text-[22px] md:leading-7">{title}</h1>
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

/** Intertitre d'une section de page. */
export function SectionTitle({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-ui font-semibold text-ink">
      {children}
    </h2>
  );
}
