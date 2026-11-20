import { describe, expect, it } from 'vitest';
import { KERNING_ALLOWANCE, MONO_FILE, SANS_FILE, textMeasurer } from './fontMetrics';

/**
 * Étalonnage absolu de `fontMetrics` : des textes connus, à des tailles et des graisses connues, comparés à leur largeur mesurée dans Chromium
 * (`measureText` sur un canevas, polices de l'application chargées), relevée à la relecture de bdesk-pz0.4. `noKern` : sans crénage
 * (`font-kerning: none`), ce que ce module calcule ; `kern` : avec, ce que le navigateur dessine. Une erreur d'échelle (toutes les chasses
 * multipliées par un facteur), de table ou de graisse fait échouer ce test, quand les comparaisons relatives des autres tests passeraient.
 */
const CHROMIUM: { font: 'sans' | 'mono'; size: number; weight: number; text: string; noKern: number; kern: number }[] = [
  { font: 'sans', size: 16, weight: 400, text: 'The quick brown fox jumps over the lazy dog', noKern: 313.796875, kern: 312.53125 },
  { font: 'sans', size: 14, weight: 600, text: 'intégration', noKern: 70.515625, kern: 70 },
  { font: 'sans', size: 14, weight: 600, text: 'Awaiting', noKern: 56.09375, kern: 55.3125 },
  { font: 'sans', size: 14, weight: 400, text: 'intégration', noKern: 66.84375, kern: 66.296875 },
  { font: 'sans', size: 12, weight: 400, text: 'awaiting validation', noKern: 98.609375, kern: 98.265625 },
  { font: 'sans', size: 12, weight: 500, text: 'Long blockage', noKern: 79.4375, kern: 79.4375 },
  { font: 'sans', size: 12, weight: 500, text: 'Renoncement', noKern: 74.515625, kern: 74.078125 },
  { font: 'sans', size: 12, weight: 500, text: 'Drift', noKern: 23.875, kern: 24.296875 },
  { font: 'sans', size: 12, weight: 400, text: '0123456789', noKern: 68.390625, kern: 67.625 },
  { font: 'mono', size: 12, weight: 400, text: 'bdesk-38k.6', noKern: 83.4375, kern: 83.4375 },
];

describe('fontMetrics, étalonné sur Chromium', () => {
  const measure = { sans: textMeasurer(SANS_FILE), mono: textMeasurer(MONO_FILE) };

  it.each(CHROMIUM)('$font $size px, graisse $weight : « $text » mesure $noKern px sans crénage, à 0,1 px près', ({ font, size, weight, text, noKern }) => {
    expect(Math.abs(measure[font](text, { size, weight }) - noKern)).toBeLessThan(0.1);
  });

  it('reste, crénage compris, à moins d’un pixel de ce que dessine Chromium : la marge que layout.test.ts ajoute à chaque mot', () => {
    for (const { font, size, weight, text, kern } of CHROMIUM) {
      if (text.includes(' ')) continue;
      expect(kern - measure[font](text, { size, weight }), text).toBeLessThan(KERNING_ALLOWANCE);
    }
  });
});
