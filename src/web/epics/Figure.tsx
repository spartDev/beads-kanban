import type { ReactNode } from 'react';
import { formatDuration, spokenDuration } from '../metrics/format';

/** Une durée, courte pour les yeux (« 3 j 4 h ») et en toutes lettres pour les lecteurs d'écran (« 3 jours 4 heures »). */
export function Duration({ ms }: { ms: number }) {
  return (
    <>
      <span aria-hidden="true">{formatDuration(ms)}</span>
      <span className="sr-only">{spokenDuration(ms)}</span>
    </>
  );
}

/**
 * Une case de chiffre, comme celles de la chronologie d'un ticket : un intitulé (`dt`), sa valeur en grand, puis ce qui la
 * précise ou explique qu'elle manque. À mettre dans une liste de définitions (`dl`).
 */
export function Figure({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-well px-3 py-2">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="tnum wrap-anywhere text-[15px] font-semibold leading-5 text-ink">{value}</dd>
      {children}
    </div>
  );
}

/** Une ligne sous la valeur d'une case. */
export function FigureNote({ children }: { children: ReactNode }) {
  return <dd className="wrap-anywhere text-xs leading-4 text-ink-3">{children}</dd>;
}
