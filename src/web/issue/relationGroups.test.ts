import { describe, expect, it } from 'vitest';
import type { IssueRef } from '../data/types';
import { groupRelations } from './relationGroups';

const ref = (id: string, extra: Partial<IssueRef> = {}): IssueRef => ({ id, title: `Titre de ${id}`, type: 'task', status: 'open', priority: 2, ...extra });
const linked = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, ref(id)]));

describe('groupRelations', () => {
  it('ne donne rien d’un ticket sans relation', () => {
    expect(groupRelations({ dependencies: [], dependents: [], linked: {} })).toEqual([]);
  });

  it('range les dépendances du ticket par genre, dans l’ordre : parent, enfants, bloqué par, bloque, lié à, découvert à partir de, à l’origine de', () => {
    const groups = groupRelations({
      dependencies: [
        { to: 'a-parent', type: 'parent-child' },
        { to: 'a-bloquant', type: 'blocks' },
        { to: 'a-lie', type: 'relates-to' },
        { to: 'a-origine', type: 'discovered-from' },
      ],
      dependents: [
        { from: 'a-enfant', type: 'parent-child' },
        { from: 'a-bloque', type: 'blocks' },
        { from: 'a-decouvert', type: 'discovered-from' },
      ],
      linked: linked('a-parent', 'a-bloquant', 'a-lie', 'a-origine', 'a-enfant', 'a-bloque', 'a-decouvert'),
    });

    expect(groups.map((group) => [group.id, group.label, group.items.map((item) => item.id)])).toEqual([
      ['parent', 'Parent', ['a-parent']],
      ['children', 'Enfants', ['a-enfant']],
      ['blocked-by', 'Bloqué par', ['a-bloquant']],
      ['blocks', 'Bloque', ['a-bloque']],
      ['related', 'Lié à', ['a-lie']],
      ['discovered-from', 'Découvert à partir de', ['a-origine']],
      ['origin-of', 'À l’origine de', ['a-decouvert']],
    ]);
  });

  it('joint à chaque ticket lié son titre, son type et son statut', () => {
    const [group] = groupRelations({
      dependencies: [{ to: 'a-1', type: 'blocks' }],
      dependents: [],
      linked: { 'a-1': ref('a-1', { status: 'closed', type: 'bug' }) },
    });

    expect(group?.items).toEqual([{ id: 'a-1', ref: ref('a-1', { status: 'closed', type: 'bug' }) }]);
  });

  it('garde sans fiche un ticket hors du Projet : il n’y a rien à ouvrir', () => {
    const [group] = groupRelations({ dependencies: [{ to: 'external:autre:x-1', type: 'blocks' }], dependents: [], linked: {} });

    expect(group?.items).toEqual([{ id: 'external:autre:x-1', ref: undefined }]);
  });

  it('réunit « relates-to » et « related », dans les deux sens, sans doublon', () => {
    const groups = groupRelations({
      dependencies: [
        { to: 'a-1', type: 'relates-to' },
        { to: 'a-2', type: 'related' },
      ],
      dependents: [
        { from: 'a-1', type: 'relates-to' },
        { from: 'a-3', type: 'related' },
      ],
      linked: linked('a-1', 'a-2', 'a-3'),
    });

    expect(groups.map((group) => [group.id, group.items.map((item) => item.id)])).toEqual([['related', ['a-1', 'a-2', 'a-3']]]);
  });

  it('nomme les Abandons : doublon de, doublons, remplace, remplacé par', () => {
    const groups = groupRelations({
      dependencies: [
        { to: 'a-1', type: 'duplicates' },
        { to: 'a-2', type: 'supersedes' },
      ],
      dependents: [
        { from: 'a-3', type: 'duplicates' },
        { from: 'a-4', type: 'supersedes' },
      ],
      linked: linked('a-1', 'a-2', 'a-3', 'a-4'),
    });

    expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
      ['Doublon de', ['a-1']],
      ['A pour doublons', ['a-3']],
      ['Remplace', ['a-2']],
      ['Remplacé par', ['a-4']],
    ]);
  });

  it('garde, sous le nom de son genre, une relation que beads connaît et pas nous', () => {
    const groups = groupRelations({
      dependencies: [{ to: 'a-1', type: 'waits-for' }],
      dependents: [{ from: 'a-2', type: 'waits-for' }],
      linked: linked('a-1', 'a-2'),
    });

    expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
      ['Dépend de (waits-for)', ['a-1']],
      ['Dont dépendent (waits-for)', ['a-2']],
    ]);
  });
});
