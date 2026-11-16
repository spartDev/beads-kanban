/**
 * Marque : des perles enfilées sur un fil, comme les tickets sur leur parcours. Le fond est le marine de la barre latérale
 * (--side), les perles le jaune de la marque (--mark) : sur la barre latérale, seuls le fil et les perles se détachent.
 */
export function BrandMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} aria-hidden="true">
      <rect width="20" height="20" rx="5.5" fill="var(--side)" />
      <path d="M3.4 10h13.2" stroke="var(--side-ink)" strokeOpacity=".7" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="6.3" cy="10" r="2.7" fill="var(--mark)" />
      <circle cx="12" cy="10" r="2.7" fill="var(--mark)" />
      <circle cx="16.2" cy="10" r="1.5" fill="var(--side-ink)" />
    </svg>
  );
}
