import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CustomStatus, HandoffStatus, StatusCategory } from '../shared/api';
import { declareStatuses, HANDOFF_STATUSES, isDeclaredWip, NO_DECLARED_STATUSES, STATUS_CATEGORIES, visibleHandoffStatuses } from './statuses';

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

  it('les reconnaît par leur nom exact, comme bd, qui n’écrit que des minuscules : une autre casse, écrite à la main, n’en fait pas un', () => {
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

  it('ne compte qu’une fois un statut déclaré deux fois (bd le refuse ; une clé écrite à la main) : la première déclaration fixe sa catégorie', () => {
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

describe('isDeclaredWip : un autre statut personnalisé que le Projet déclare de catégorie wip (bdesk-pz0.3)', () => {
  const declared = declareStatuses([
    wip('qa_testing'),
    { name: 'on_hold', category: 'frozen' },
    { name: 'shipped', category: 'done' },
    { name: 'triage', category: 'active' },
    { name: 'parked', category: null },
    wip('in_review'),
  ]);

  it('est vrai pour un statut déclaré wip, faux pour toute autre catégorie ou un statut non déclaré', () => {
    expect(isDeclaredWip('qa_testing', declared)).toBe(true);
    for (const status of ['on_hold', 'shipped', 'triage', 'parked', 'review', '']) expect(isDeclaredWip(status, declared), status).toBe(false);
    expect(isDeclaredWip('qa_testing', NO_DECLARED_STATUSES)).toBe(false);
  });

  it('ne compte ni un Statut de relais (il l’est par son nom) ni un statut de base, même dans une déclaration écrite à la main', () => {
    const forged = { handoff: [], others: ['in_review', 'open', 'deferred', 'closed', 'pinned'].map(wip) };
    for (const status of ['in_review', 'open', 'deferred', 'closed', 'pinned']) {
      expect(isDeclaredWip(status, forged), status).toBe(false);
      expect(isDeclaredWip(status, declared), status).toBe(false);
    }
  });
});

describe('visibleHandoffStatuses : les colonnes de relais d’un Projet (bdesk-pz0.3)', () => {
  it('n’en donne aucune à un Projet qui n’en déclare aucun et dont aucun ticket n’en porte', () => {
    expect(visibleHandoffStatuses([], ['open', 'in_progress', 'blocked', 'closed', 'qa_testing'])).toEqual([]);
  });

  it('donne sa colonne à un Statut de relais déclaré, même qu’aucun ticket ne porte encore', () => {
    expect(visibleHandoffStatuses(['in_integration'], ['open'])).toEqual(['in_integration']);
  });

  it('donne sa colonne à un Statut de relais qu’un ticket porte sans être déclaré : aucun ticket ne se perd', () => {
    expect(visibleHandoffStatuses([], ['open', 'awaiting_human', 'awaiting_human'])).toEqual(['awaiting_human']);
  });

  it('les rend une fois chacun, dans l’ordre En relecture, En intégration, À valider', () => {
    expect(visibleHandoffStatuses(['awaiting_human'], ['in_integration', 'in_review', 'awaiting_human', 'IN_REVIEW'])).toEqual(HANDOFF_STATUSES);
  });
});
