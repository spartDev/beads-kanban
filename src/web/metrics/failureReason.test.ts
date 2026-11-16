import { describe, expect, it } from 'vitest';
import { CATALOGS } from '../i18n/catalog';
import { failureRateReason } from './failureReason';

const NBSP = '\u00a0';
const thresholds = { minCoverage: 0.5, minBugs: 5 };

describe('motif d’un Taux d’échec non significatif', () => {
  it('rien quand le taux est significatif', () => {
    expect(failureRateReason({ reasons: [], coverage: { bugs: 9, linked: 9, ratio: 1 }, thresholds }, 'fr')).toBeNull();
  });

  it('reprend en français la phrase du serveur, les deux motifs joints', () => {
    expect(failureRateReason({ reasons: ['low-coverage', 'few-bugs'], coverage: { bugs: 3, linked: 1, ratio: 1 / 3 }, thresholds }, 'fr')).toBe(
      `Couverture insuffisante : 33${NBSP}% des bugs ont une origine renseignée (minimum 50${NBSP}%) ; trop peu de bugs pour conclure : 3 (minimum 5).`,
    );
  });

  it('s’écrit en anglais', () => {
    expect(failureRateReason({ reasons: ['few-bugs'], coverage: { bugs: 1, linked: 1, ratio: 1 }, thresholds }, 'en')).toBe(
      'Too few bugs to conclude: 1 (minimum 5).',
    );
    expect(failureRateReason({ reasons: ['low-coverage'], coverage: { bugs: 20, linked: 2, ratio: 0.1 }, thresholds }, 'en')).toBe(
      'Coverage too low: 10% of bugs have a recorded origin (minimum 50%).',
    );
  });
});

describe('note du Rapport de rétrospective, en anglais', () => {
  it('garde la majuscule de Coverage, met la minuscule à tout autre motif', () => {
    const note = CATALOGS.en.metrics.retrospective.failureNote;
    expect(note(failureRateReason({ reasons: ['few-bugs'], coverage: { bugs: 0, linked: 0, ratio: null }, thresholds }, 'en') ?? '')).toBe(
      'Change failure rate not significant: too few bugs to conclude: 0 (minimum 5).',
    );
    expect(note(failureRateReason({ reasons: ['low-coverage'], coverage: { bugs: 20, linked: 2, ratio: 0.1 }, thresholds }, 'en') ?? '')).toBe(
      'Change failure rate not significant: Coverage too low: 10% of bugs have a recorded origin (minimum 50%).',
    );
  });
});
