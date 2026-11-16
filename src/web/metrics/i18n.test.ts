import { describe, expect, it } from 'vitest';
import { METRICS_GROUP_MODULES } from '../i18n/catalog/metrics';

/**
 * Le catalogue de la zone metrics est réparti en modules de groupes (`catalog/metrics/`), réunis par décomposition d'objets : un groupe
 * défini dans deux modules serait écrasé sans que le compilateur le dise. Ce test le refuse.
 */
describe('catalogue de la zone metrics', () => {
  it('chaque groupe n’est défini que dans un seul module, dans les deux langues', () => {
    for (const language of ['fr', 'en'] as const) {
      const owners = new Map<string, string[]>();
      for (const [module, groups] of Object.entries(METRICS_GROUP_MODULES)) {
        for (const group of Object.keys(groups[language])) owners.set(group, [...(owners.get(group) ?? []), module]);
      }
      const twice = [...owners].filter(([, modules]) => modules.length > 1);
      expect(twice).toEqual([]);
    }
  });
});
