/**
 * Marque : trois perles enfilées sur un fil, de la plus petite à la plus grande puis de nouveau
 * la plus petite. Les couleurs suivent le thème (--accent, --accent-ink).
 */
export function BrandMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} aria-hidden="true">
      <rect width="20" height="20" rx="5.5" fill="var(--accent)" />
      <path
        d="M5.4 14.6 14.6 5.4"
        stroke="var(--accent-ink)"
        strokeOpacity=".45"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <circle cx="5.8" cy="14.2" r="2" fill="var(--accent-ink)" />
      <circle cx="10" cy="10" r="2.7" fill="var(--accent-ink)" />
      <circle cx="14.2" cy="5.8" r="2" fill="var(--accent-ink)" />
    </svg>
  );
}
