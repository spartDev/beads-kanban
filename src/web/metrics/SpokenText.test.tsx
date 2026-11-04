import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { DurationText, SpokenText } from './SpokenText';
import { plain, shownText, spokenText } from './testing';

const NBSP = ' ';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Le texte rendu dans un paragraphe : ce que l'œil lit, ce que l'oreille entend, et le paragraphe pour en lire la structure. */
function rendered(element: ReactElement) {
  const { container } = render(<p>{element}</p>);
  const paragraph = container.querySelector('p') as HTMLElement;
  return { paragraph, shown: plain(shownText(paragraph)), heard: plain(spokenText(paragraph)) };
}

describe('SpokenText : un texte écrit avec un chevron se dit avec des mots', () => {
  it.each([
    ['< 1 min', 'moins d’une minute'],
    ['> 99,9 %', 'plus de 99,9 %'],
  ])('écrit « %s » à l’écran et dit « %s » aux lecteurs d’écran', (written, spoken) => {
    const { paragraph, shown, heard } = rendered(<SpokenText written={written} spoken={spoken} />);

    expect(shown).toBe(written);
    expect(heard).toBe(spoken);
    // Le chevron est caché aux lecteurs d'écran, les mots ne sont écrits que pour eux : chacun n'est lu qu'une fois.
    expect(paragraph.querySelector('[aria-hidden="true"]')?.textContent).toBe(written);
    expect(paragraph.querySelector('.sr-only')?.textContent).toBe(spoken);
  });

  it('ne double pas un texte sans chevron : l’œil et l’oreille lisent la même chose, sans balise de plus', () => {
    const { paragraph, shown, heard } = rendered(<SpokenText written="124 j" spoken="124 jours" />);

    expect(shown).toBe('124 j');
    expect(heard).toBe('124 j');
    expect(paragraph.children).toHaveLength(0);
  });

  it('double aussi une phrase qui porte le chevron en son milieu : elle se dit tout entière avec des mots', () => {
    const { shown, heard } = rendered(<SpokenText written="Le Lead Time cumulé (< 1 min), réparti" spoken="Le Lead Time cumulé (moins d’une minute), réparti" />);

    expect(shown).toBe('Le Lead Time cumulé (< 1 min), réparti');
    expect(heard).toBe('Le Lead Time cumulé (moins d’une minute), réparti');
  });

  it('laisse une phrase sans chevron en un seul morceau de texte, pour que l’écran ne change pas d’un pixel', () => {
    const { paragraph } = rendered(<SpokenText written="Le Lead Time cumulé de 18 Livraisons (120 j)" spoken="Le Lead Time cumulé de 18 Livraisons (120 jours)" />);

    expect(paragraph.childNodes).toHaveLength(1);
    expect(paragraph.firstChild?.nodeType).toBe(Node.TEXT_NODE);
  });
});

describe('SpokenText `spelledOut` : l’abréviation reste lue, suivie des mots, sauf quand elle porte un chevron', () => {
  it('redit en toutes lettres, entre parenthèses, un texte sans chevron : « 189 j (189 jours) »', () => {
    const { paragraph, shown, heard } = rendered(<SpokenText written="189 j" spoken="189 jours" spelledOut />);

    expect(shown).toBe('189 j');
    expect(heard).toBe('189 j (189 jours)');
    expect(paragraph.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(paragraph.querySelector('.sr-only')?.textContent).toBe(' (189 jours)');
    expect(paragraph.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('ne lit pas deux fois un texte à chevron : l’écriture est cachée, les mots sont dits une fois, sans parenthèses', () => {
    const { paragraph, shown, heard } = rendered(<SpokenText written="< 1 min" spoken="moins d’une minute" spelledOut />);

    expect(shown).toBe('< 1 min');
    expect(heard).toBe('moins d’une minute');
    expect(paragraph.querySelector('[aria-hidden="true"]')?.textContent).toBe('< 1 min');
    expect(paragraph.querySelector('.sr-only')?.textContent).toBe('moins d’une minute');
  });

  it('n’ajoute pas de parenthèses vides quand il n’y a rien à redire', () => {
    const { paragraph, heard } = rendered(<SpokenText written="—" spoken="" spelledOut />);

    expect(heard).toBe('—');
    expect(paragraph.children).toHaveLength(0);
  });

  it('sans `spelledOut`, un texte sans chevron reste seul : rien n’est redit', () => {
    const { paragraph, heard } = rendered(<SpokenText written="189 j" spoken="189 jours" />);

    expect(heard).toBe('189 j');
    expect(paragraph.children).toHaveLength(0);
  });
});

describe('DurationText : une durée sous la minute se dit « moins d’une minute »', () => {
  it('écrit « < 1 min » et dit « moins d’une minute » sous 30 s, que l’arrondi à la minute ramène à zéro', () => {
    for (const ms of [0, 3_516, 29_999]) {
      const { shown, heard } = rendered(<DurationText ms={ms} />);
      expect(shown).toBe('< 1 min');
      expect(heard).toBe('moins d’une minute');
    }
  });

  it('écrit comme `formatDuration` et ne change rien à une durée qui s’écrit sans chevron', () => {
    for (const [ms, written] of [
      [30_000, `1${NBSP}min`],
      [2 * 60 * MINUTE + 26 * MINUTE, `2${NBSP}h${NBSP}26`],
      [124 * DAY, `124${NBSP}j`],
    ] as const) {
      const { paragraph, shown, heard } = rendered(<DurationText ms={ms} />);
      expect(shown).toBe(plain(written));
      expect(heard).toBe(plain(written));
      expect(paragraph.children).toHaveLength(0);
    }
  });

  it('écrit un tiret sans durée, et ne le double pas', () => {
    for (const ms of [null, undefined]) {
      const { paragraph, shown, heard } = rendered(<DurationText ms={ms} />);
      expect(shown).toBe('—');
      expect(heard).toBe('—');
      expect(paragraph.children).toHaveLength(0);
    }
  });
});
