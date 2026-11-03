import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Skeleton } from '../ui/states';
import { outlineOf } from './palette';
import { placeTooltip } from './scales';
import { useElementWidth } from './useElementWidth';

/** Intertitre d'une section de la page Métriques (même style que ceux des autres pages). */
export function SectionHeading({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-ui font-semibold text-ink">
      {children}
    </h2>
  );
}

/** Les pièces communes des graphiques de la page Métriques : cadre mesuré, carte, légende, infobulle, tableau de données. */

/**
 * Le cadre d'un graphique : une hauteur fixe (la page ne saute pas quand les données arrivent) et la largeur du
 * conteneur, mesurée. Tant qu'elle n'est pas connue, un fond de chargement tient la place.
 */
export function ChartFrame({
  height,
  children,
}: {
  height: number;
  children: (size: { width: number; height: number }) => ReactNode;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  return (
    <div ref={ref} data-chart-frame="" className="relative w-full select-none" style={{ height }}>
      {width > 0 ? children({ width, height }) : <Skeleton className="size-full" />}
    </div>
  );
}

/** Une carte de graphique : titre, phrase d'explication, réglages, légende, dessin, et le tableau de ses données. */
export function ChartCard({
  title,
  description,
  actions,
  legend,
  data,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  legend?: ReactNode;
  /** Le tableau des valeurs dessinées, déplié à la demande : le dessin n'est pas la seule façon de les lire. */
  data?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cx('flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-panel p-3 @md:p-4', className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 id={titleId} className="text-ui font-semibold text-ink">
            {title}
          </h3>
          {description ? <p className="mt-0.5 max-w-[60ch] text-micro text-ink-3">{description}</p> : null}
        </div>
        {actions}
      </header>
      {legend}
      {children}
      {data ? (
        <details className="group text-micro">
          <summary className="inline-flex cursor-default list-none items-center gap-1 font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="inline-block text-ink-3 transition-transform group-open:rotate-90">
              ›
            </span>
            Données du graphique
          </summary>
          <div className="mt-2 max-h-72 overflow-auto rounded-md border border-line" tabIndex={0} role="region" aria-label={`Données : ${title}`}>
            {data}
          </div>
        </details>
      ) : null}
    </section>
  );
}

/** Le tableau des données d'un graphique : mêmes valeurs que le dessin, lisibles par tous. */
export function DataTable({ caption, head, children }: { caption: string; head: ReactNode; children: ReactNode }) {
  return (
    <table className="w-full border-collapse text-left text-micro tnum">
      <caption className="sr-only">{caption}</caption>
      <thead className="sticky top-0 bg-well text-ink-2">{head}</thead>
      <tbody className="divide-y divide-line">{children}</tbody>
    </table>
  );
}

/** Une pastille de couleur : un aplat doux cerné de son trait, comme la forme qu'elle désigne dans le graphique. */
export function Swatch({ color, hatched = false, round = false }: { color: string; hatched?: boolean; round?: boolean }) {
  const style: CSSProperties = {
    background: hatched ? `repeating-linear-gradient(45deg, ${outlineOf(color)} 0 1.5px, transparent 1.5px 4px)` : color,
    borderColor: outlineOf(color),
  };
  return <span aria-hidden="true" className={cx('inline-block size-2.5 shrink-0 border', round ? 'rounded-full' : 'rounded-[3px]')} style={style} />;
}

/** La légende d'un graphique : une pastille et un nom par série. */
export function Legend({ items, label }: { items: readonly { key: string; label: string; color: string; hatched?: boolean; round?: boolean }[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <ul aria-label={label} className="flex flex-wrap gap-x-4 gap-y-1 text-micro text-ink-2">
      {items.map((item) => (
        <li key={item.key} className="inline-flex items-center gap-1.5">
          <Swatch color={item.color} hatched={item.hatched} round={item.round} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Où est le pointeur dans le graphique (pixels du cadre), et ce qu'il désigne. */
export interface Active<T> {
  value: T;
  x: number;
  y: number;
}

/**
 * L'élément désigné par le pointeur (souris ou doigt) d'un graphique. À la souris, il disparaît quand le pointeur sort ;
 * au doigt, il reste jusqu'à ce qu'on touche ailleurs : le doigt qui se lève « sort » du graphique à l'instant même.
 */
export function useActive<T>() {
  const [active, setActive] = useState<Active<T> | null>(null);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const dismiss = (event: Event) => {
      if (!(event.target instanceof Node) || !frame.current?.contains(event.target)) setActive(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [active]);

  return {
    active,
    frame,
    show: setActive,
    clear: () => setActive(null),
    /** À brancher sur `onPointerLeave` : la souris efface, le doigt reste. */
    leave: (event: PointerEvent) => {
      if (event.pointerType !== 'touch') setActive(null);
    },
  };
}

/** Position du pointeur dans un élément, en pixels de cet élément. */
export function pointerIn(event: PointerEvent, element: Element): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/**
 * L'infobulle d'un graphique : près du pointeur, sans jamais sortir du cadre. Décor : les valeurs sont dans le tableau.
 * Sa taille n'est connue qu'une fois affichée : on la place juste après le rendu, avant l'affichage à l'écran
 * (`useLayoutEffect`), en écrivant sa position dans le DOM plutôt que dans un état, qui referait un rendu à chaque mesure.
 */
export function ChartTooltip({ pointer, bounds, children }: { pointer: { x: number; y: number }; bounds: { width: number; height: number }; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { left, top } = placeTooltip({ pointer, tooltip: { width: element.offsetWidth, height: element.offsetHeight }, bounds });
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  });

  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-chart-tooltip=""
      className="pointer-events-none absolute z-10 flex w-max max-w-[15rem] flex-col gap-1 rounded-md border border-line-strong bg-float px-2.5 py-1.5 text-xs text-ink shadow-float"
      style={{ left: pointer.x, top: pointer.y }}
    >
      {children}
    </div>
  );
}
