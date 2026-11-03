/**
 * Le texte des axes : celui de la page (la police est héritée, pas celle par défaut de visx), en retrait comme les
 * indices (`--ink-3`, 4,5:1 sur le panneau : design/contrast.test.ts) et assez petit pour tenir sur mobile.
 */
export const AXIS_TEXT = { fill: 'var(--ink-3)', fontSize: 11, fontFamily: 'inherit' } as const;
