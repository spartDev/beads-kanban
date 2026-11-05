import { describe, expect, it } from 'vitest';
import { abandonOf, type AbandonLink } from './abandon';

const at = (iso: string) => new Date(`${iso}Z`);

/**
 * Un lien apparu à `added` (et retiré à `removed`, s'il l'a été) du ticket vers `target`. `created` : le `created_at` de sa ligne,
 * quand la lecture le donne.
 */
const link = (type: string, target: string, added: string, removed?: string, created?: string): AbandonLink => ({
  type,
  target,
  addedAt: at(added),
  ...(removed ? { removedAt: at(removed) } : {}),
  ...(created ? { createdAt: at(created) } : {}),
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

    describe('liens apparus au même instant (un seul commit les réunit)', () => {
      // Un commit de lot de bd (auto-commit `batch`), un import ou un historique aplati réunit des liens écrits à des moments
      // différents : l'historique ne dit plus dans quel ordre ils l'ont été. Seul le `created_at` de leur ligne le dit. Les instants
      // sont ceux d'un vrai lot (sanofi-ai-standards) : le commit du 28 avril à 08:31:51 UTC réunit des liens écrits à 10:10:30,
      // 10:10:31 et 10:10:32, heure locale.
      const COMMIT = '2026-04-28T08:31:51';
      const [first, second] = [
        link('supersedes', 'b', COMMIT, undefined, '2026-04-28T10:10:30'),
        link('duplicates', 'a', COMMIT, undefined, '2026-04-28T10:10:32'),
      ];

      it('départage par le created_at de la ligne, avant la cible : le premier posé fait la cause, bien que sa cible soit la plus grande', () => {
        expect(abandonOf([first, second])).toEqual({ cause: 'superseded', of: 'b' });
        expect(abandonOf([second, first])).toEqual({ cause: 'superseded', of: 'b' });
      });

      it('départage de même dans l’autre sens : doublon posé avant remplacé', () => {
        const [early, late] = [link('duplicates', 'b', COMMIT, undefined, '2026-04-28T10:10:30'), link('supersedes', 'a', COMMIT, undefined, '2026-04-28T10:10:32')];

        expect(abandonOf([late, early])).toEqual({ cause: 'duplicate', of: 'b' });
        expect(abandonOf([early, late])).toEqual({ cause: 'duplicate', of: 'b' });
      });

      it('retient la plus petite cible quand les created_at sont égaux', () => {
        const [late, early] = [link('supersedes', 'b', COMMIT, undefined, '2026-04-28T10:10:31'), link('duplicates', 'a', COMMIT, undefined, '2026-04-28T10:10:31')];

        expect(abandonOf([late, early])).toEqual({ cause: 'duplicate', of: 'a' });
        expect(abandonOf([early, late])).toEqual({ cause: 'duplicate', of: 'a' });
      });

      it('fait passer avant les autres un lien dont la ligne n’a pas de created_at, comme le kanban pour une ligne non datée', () => {
        const undated = link('supersedes', 'b', COMMIT);
        const dated = link('duplicates', 'a', COMMIT, undefined, '2026-04-28T10:10:30');

        expect(abandonOf([dated, undated])).toEqual({ cause: 'superseded', of: 'b' });
        expect(abandonOf([undated, dated])).toEqual({ cause: 'superseded', of: 'b' });
      });

      it('ne lit le created_at que si les liens sont apparus au même instant : le commit le plus ancien l’emporte', () => {
        // Les lignes qu'écrivaient d'anciennes versions de bd portent une heure locale (`created_at` de 2 h en avance sur l'UTC à
        // Paris en été : 10:10:30 pour 08:10:30 UTC), celles du bd actuel l'UTC : le created_at de l'une ne se compare pas à celui
        // de l'autre. Les commits, eux, sont en UTC : le lien du lot (08:31:51) précède celui de 09:00, malgré un created_at plus tardif.
        const legacy = link('supersedes', 'b', COMMIT, undefined, '2026-04-28T10:10:30');
        const recent = link('duplicates', 'a', '2026-04-28T09:00:00', undefined, '2026-04-28T09:00:00');

        expect(abandonOf([recent, legacy])).toEqual({ cause: 'superseded', of: 'b' });
        expect(abandonOf([legacy, recent])).toEqual({ cause: 'superseded', of: 'b' });
      });
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
