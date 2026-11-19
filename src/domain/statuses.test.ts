import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CustomStatus, HandoffStatus, StatusCategory } from '../shared/api';
import { declareStatuses, HANDOFF_STATUSES, STATUS_CATEGORIES } from './statuses';

const wip = (name: string): CustomStatus => ({ name, category: 'wip' });

describe('declareStatuses', () => {
  it('reconnaît les trois Statuts de relais que pose la chaîne d’agents (ADR 0007)', () => {
    expect(declareStatuses([wip('in_review'), wip('in_integration'), wip('awaiting_human')])).toEqual({
      handoff: ['in_review', 'in_integration', 'awaiting_human'],
      others: [],
    });
  });

  it('rend les Statuts de relais dans le même ordre, quel que soit celui de la déclaration', () => {
    expect(declareStatuses([wip('awaiting_human'), wip('in_review')]).handoff).toEqual(['in_review', 'awaiting_human']);
  });

  it('les reconnaît par leur nom seul : sans catégorie, ou avec une autre que wip', () => {
    expect(
      declareStatuses([
        { name: 'in_review', category: null },
        { name: 'in_integration', category: 'frozen' },
        { name: 'awaiting_human', category: 'done' },
      ]),
    ).toEqual({ handoff: ['in_review', 'in_integration', 'awaiting_human'], others: [] });
  });

  it('les reconnaît par leur nom exact : une autre casse est un autre statut, celui que portent alors les tickets', () => {
    expect(declareStatuses([wip('IN_REVIEW'), wip('In_Integration')])).toEqual({
      handoff: [],
      others: [wip('IN_REVIEW'), wip('In_Integration')],
    });
  });

  it('garde les autres statuts personnalisés avec leur catégorie, dans l’ordre de la déclaration', () => {
    expect(
      declareStatuses([
        { name: 'qa_testing', category: 'wip' },
        wip('in_review'),
        { name: 'on_hold', category: 'frozen' },
        { name: 'shipped', category: 'done' },
        { name: 'triage', category: 'active' },
        { name: 'parked', category: null },
      ]),
    ).toEqual({
      handoff: ['in_review'],
      others: [
        { name: 'qa_testing', category: 'wip' },
        { name: 'on_hold', category: 'frozen' },
        { name: 'shipped', category: 'done' },
        { name: 'triage', category: 'active' },
        { name: 'parked', category: null },
      ],
    });
  });

  it('ne compte qu’une fois un statut déclaré deux fois : la première déclaration fixe sa catégorie', () => {
    expect(
      declareStatuses([
        { name: 'qa_testing', category: 'wip' },
        wip('in_review'),
        { name: 'qa_testing', category: 'done' },
        { name: 'in_review', category: 'frozen' },
        { name: 'parked', category: null },
        { name: 'parked', category: 'wip' },
      ]),
    ).toEqual({ handoff: ['in_review'], others: [{ name: 'qa_testing', category: 'wip' }, { name: 'parked', category: null }] });
  });

  it('ne prend pas un statut de base pour un statut personnalisé : le Projet ne peut pas en changer la catégorie', () => {
    const builtIn = ['open', 'in_progress', 'blocked', 'deferred', 'closed', 'pinned', 'hooked'].map(wip);

    expect(declareStatuses([...builtIn, wip('qa_testing')])).toEqual({ handoff: [], others: [wip('qa_testing')] });
  });

  it('ne déclare rien quand le Projet ne déclare rien', () => {
    expect(declareStatuses([])).toEqual({ handoff: [], others: [] });
  });

  it('ne garde rien de plus que le nom et la catégorie de ce qu’on lui donne', () => {
    const extra = { name: 'qa_testing', category: 'wip', note: 'x' } as CustomStatus;

    expect(declareStatuses([extra]).others).toEqual([wip('qa_testing')]);
  });
});

describe('les listes du domaine suivent les types du contrat de l’API', () => {
  it('HANDOFF_STATUSES nomme chaque Statut de relais, STATUS_CATEGORIES chaque catégorie', () => {
    expectTypeOf<(typeof HANDOFF_STATUSES)[number]>().toEqualTypeOf<HandoffStatus>();
    expectTypeOf<(typeof STATUS_CATEGORIES)[number]>().toEqualTypeOf<StatusCategory>();
    expect(HANDOFF_STATUSES).toEqual(['in_review', 'in_integration', 'awaiting_human']);
    expect(STATUS_CATEGORIES).toEqual(['active', 'wip', 'done', 'frozen']);
  });
});
