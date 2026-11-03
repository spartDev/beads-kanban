import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ISSUE_TYPES,
  PRIORITIES,
  PRIORITY_META,
  TYPE_META,
  parsePriority,
  priorityMeta,
  statusLabel,
  typeMeta,
} from './issue-palette';

const css = readFileSync(join(import.meta.dirname, '../styles.css'), 'utf8');
const [lightBlock = '', darkBlock = ''] = css.split(":root[data-theme='dark']");

describe('code couleur des types', () => {
  it('couvre exactement les neuf types beads, chacun avec sa couleur', () => {
    expect([...ISSUE_TYPES]).toEqual([
      'bug', 'feature', 'task', 'chore', 'epic', 'decision', 'spike', 'story', 'milestone',
    ]);
    const colors = ISSUE_TYPES.map((type) => TYPE_META[type].color);
    expect(new Set(colors).size).toBe(ISSUE_TYPES.length);
  });

  it('pointe vers des tokens CSS déclarés en clair et en sombre', () => {
    for (const { token } of [...Object.values(TYPE_META), typeMeta('inconnu')]) {
      expect(lightBlock, `${token} (clair)`).toContain(`${token}:`);
      expect(darkBlock, `${token} (sombre)`).toContain(`${token}:`);
    }
  });

  it('donne la couleur neutre aux types personnalisés, en gardant leur nom', () => {
    expect(typeMeta('molecule')).toMatchObject({ type: 'molecule', label: 'molecule', color: 'var(--type-other)' });
  });
});

describe('code couleur des priorités', () => {
  it('couvre P0 à P4 avec des tokens déclarés en clair et en sombre', () => {
    expect(PRIORITIES.map((p) => PRIORITY_META[p].code)).toEqual(['P0', 'P1', 'P2', 'P3', 'P4']);
    for (const { token } of Object.values(PRIORITY_META)) {
      expect(lightBlock, `${token} (clair)`).toContain(`${token}:`);
      expect(darkBlock, `${token} (sombre)`).toContain(`${token}:`);
    }
  });

  it('accepte un nombre, une chaîne ou le code P1', () => {
    expect(parsePriority(1)).toBe(1);
    expect(parsePriority('2')).toBe(2);
    expect(parsePriority('P3')).toBe(3);
    expect(parsePriority('p0')).toBe(0);
    expect(parsePriority(7)).toBeNull();
    expect(parsePriority('haute')).toBeNull();
    expect(parsePriority(null)).toBeNull();
  });

  it('ramène une valeur hors échelle à la priorité la plus proche', () => {
    expect(priorityMeta(-1).code).toBe('P0');
    expect(priorityMeta(9).code).toBe('P4');
    expect(priorityMeta(Number.NaN).code).toBe('P4');
  });
});

describe('statusLabel', () => {
  it('traduit les statuts beads et laisse les autres tels quels', () => {
    expect(statusLabel('in_progress')).toBe('en cours');
    expect(statusLabel('custom')).toBe('custom');
  });

  it('dit « inconnu » d’un statut vide, au lieu d’une pastille sans texte', () => {
    expect(statusLabel('')).toBe('inconnu');
    expect(statusLabel('   ')).toBe('inconnu');
  });
});
