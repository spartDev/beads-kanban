import { describe, expect, it } from 'vitest';
import { abandonOf, type AbandonLink } from './abandon';

const at = (iso: string) => new Date(`${iso}Z`);

/** Un lien posé à `added` (et retiré à `removed`, s'il l'a été) du ticket vers `target`. */
const link = (type: string, target: string, added: string, removed?: string): AbandonLink => ({
  type,
  target,
  addedAt: at(added),
  ...(removed ? { removedAt: at(removed) } : {}),
});

describe('abandonOf : le ticket que ses liens déclarent doublon ou remplacé', () => {
  it('est un doublon quand il porte un lien duplicates, et nomme le ticket qu’il double', () => {
    expect(abandonOf([link('duplicates', 'a', '2026-10-05T09:00')])).toEqual({ cause: 'duplicate', of: 'a' });
  });

  it('est remplacé quand il porte un lien supersedes, et nomme le ticket qui le remplace', () => {
    expect(abandonOf([link('supersedes', 'b', '2026-10-05T09:00')])).toEqual({ cause: 'superseded', of: 'b' });
  });

  it('n’est pas un Abandon sans lien, ni avec de simples liens entre tickets', () => {
    const informative = ['blocks', 'parent-child', 'relates-to', 'related', 'discovered-from', 'waits-for'].map((type) =>
      link(type, 'a', '2026-10-05T09:00'),
    );

    expect(abandonOf([])).toBeUndefined();
    expect(abandonOf(informative)).toBeUndefined();
  });

  it('ne tient pas compte d’un lien retiré', () => {
    expect(abandonOf([link('duplicates', 'a', '2026-10-05T09:00', '2026-10-06T09:00')])).toBeUndefined();
  });

  it('ne dépend pas de la cible : un ticket d’un autre Projet, ou supprimé, fait un Abandon comme un autre', () => {
    expect(abandonOf([link('supersedes', 'external:autre:p-9', '2026-10-05T09:00')])).toEqual({ cause: 'superseded', of: 'external:autre:p-9' });
  });

  describe('avec plusieurs liens d’Abandon', () => {
    const superseded = link('supersedes', 'b', '2026-10-05T09:01');
    const duplicate = link('duplicates', 'a', '2026-10-05T09:02');

    it('retient la cause du premier lien posé : remplacé puis doublon est un remplacé', () => {
      expect(abandonOf([superseded, duplicate])).toEqual({ cause: 'superseded', of: 'b' });
    });

    it('retient la cause du premier lien posé : doublon puis remplacé est un doublon', () => {
      const [first, second] = [link('duplicates', 'a', '2026-10-05T09:01'), link('supersedes', 'b', '2026-10-05T09:02')];

      expect(abandonOf([first, second])).toEqual({ cause: 'duplicate', of: 'a' });
    });

    it('lit l’instant où chaque lien a été posé, pas la place qu’il a dans la liste', () => {
      expect(abandonOf([duplicate, superseded])).toEqual({ cause: 'superseded', of: 'b' });
      expect(abandonOf([superseded, duplicate])).toEqual(abandonOf([duplicate, superseded]));
    });

    it('départage deux liens posés au même instant par la plus petite cible, quelle que soit leur place', () => {
      const [late, early] = [link('supersedes', 'b', '2026-10-05T09:00'), link('duplicates', 'a', '2026-10-05T09:00')];

      expect(abandonOf([late, early])).toEqual({ cause: 'duplicate', of: 'a' });
      expect(abandonOf([early, late])).toEqual({ cause: 'duplicate', of: 'a' });
    });

    it('départage de même deux liens de même cause : le premier posé, puis la plus petite cible', () => {
      expect(abandonOf([link('duplicates', 'a-2', '2026-10-05T09:02'), link('duplicates', 'a-9', '2026-10-05T09:01')])).toEqual({ cause: 'duplicate', of: 'a-9' });
      expect(abandonOf([link('duplicates', 'a-9', '2026-10-05T09:00'), link('duplicates', 'a-2', '2026-10-05T09:00')])).toEqual({ cause: 'duplicate', of: 'a-2' });
    });

    it('passe au suivant quand le premier lien posé a été retiré', () => {
      const removed = link('supersedes', 'b', '2026-10-05T09:01', '2026-10-06T09:00');

      expect(abandonOf([removed, duplicate])).toEqual({ cause: 'duplicate', of: 'a' });
    });

    it('n’est pas un Abandon quand tous ses liens ont été retirés', () => {
      const [first, second] = [link('supersedes', 'b', '2026-10-05T09:01', '2026-10-06T09:00'), link('duplicates', 'a', '2026-10-05T09:02', '2026-10-06T09:00')];

      expect(abandonOf([first, second])).toBeUndefined();
    });
  });

  it('laisse la liste qu’on lui donne dans l’ordre où elle était', () => {
    const links = [link('duplicates', 'a', '2026-10-05T09:02'), link('supersedes', 'b', '2026-10-05T09:01'), link('blocks', 'c', '2026-10-05T09:00')];
    const before = links.map((l) => l.target);

    abandonOf(links);

    expect(links.map((l) => l.target)).toEqual(before);
  });
});
