/** Intervalle de temps semi-ouvert [start, end), en ms epoch. */
export type Interval = readonly [start: number, end: number];

/** Union normalisée : intervalles triés, disjoints, non vides. */
export function union(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = merged.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [as, ae] of union(a)) {
    for (const [bs, be] of union(b)) {
      const s = Math.max(as, bs);
      const e = Math.min(ae, be);
      if (e > s) out.push([s, e]);
    }
  }
  return union(out);
}

export function measure(intervals: Interval[]): number {
  return union(intervals).reduce((total, [s, e]) => total + (e - s), 0);
}
