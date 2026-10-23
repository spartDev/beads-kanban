import type { ReactNode } from 'react';

export interface Segment {
  key: string;
  label: string;
  count: number;
  color: string;
  /** Pictogramme de la légende. */
  icon?: ReactNode;
}

/** Barre empilée et sa légende ; les segments à zéro disparaissent. */
export function DistributionBar({ segments, label }: { segments: Segment[]; label: string }) {
  const visible = segments.filter((segment) => segment.count > 0);
  const summary = visible.map((segment) => `${segment.count} ${segment.label}`).join(', ');
  return (
    <div className="flex flex-col gap-2.5">
      <div role="img" aria-label={`${label} : ${summary}`} className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        {visible.map((segment) => (
          <span
            key={segment.key}
            className="min-w-1 basis-0 first:rounded-l-full last:rounded-r-full"
            style={{ flexGrow: segment.count, backgroundColor: segment.color }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-ink-2">
        {visible.map((segment) => (
          <li key={segment.key} className="inline-flex max-w-full items-center gap-1.5 wrap-anywhere">
            {segment.icon}
            <span>{segment.label}</span>
            <span className="tnum text-ink-3">{segment.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
