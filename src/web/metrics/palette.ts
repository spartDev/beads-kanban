/**
 * Le contour des formes pleines des graphiques. La couleur d'une série (bande, barre, point) est un aplat doux : pour que
 * la forme se détache du fond à 3:1 (WCAG 1.4.11), on la cerne d'un trait mêlé à l'encre du thème, sombre en clair,
 * clair en sombre. `metrics/palette.test.ts` vérifie ce contraste pour chaque jeton avec la même part de mélange.
 */
export const OUTLINE_FILL_SHARE = 0.6;

/** `color` mêlée à l'encre du thème (`--ink`), dans OKLab : pas d'arc de teinte, le trait garde celle de la série. */
export const outlineOf = (color: string): string => `color-mix(in oklab, ${color} ${OUTLINE_FILL_SHARE * 100}%, var(--ink))`;
