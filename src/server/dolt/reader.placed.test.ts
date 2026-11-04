import { describe, expect, it, vi } from 'vitest';
import * as client from './client';
import { toDependency } from './reader';

// `parseDoltDate` est l'original, espionné : on compte ses appels.
vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>();
  return { ...actual, parseDoltDate: vi.fn(actual.parseDoltDate) };
});

/**
 * La date de pose d'un lien (`created_at`) ne se lit que sur une ligne qui en a une. L'historique relit chaque dépendance à chaque
 * commit, sans cette colonne : des centaines de milliers de lignes dans un grand Projet, que `toDependency` ne doit pas payer d'une
 * lecture de date, ni d'une exception levée puis rattrapée (200 000 lignes : 680 ms, contre 1 ms sans elle).
 */
describe('toDependency : la date de pose n’est lue que d’une ligne qui en a une', () => {
  const parse = vi.mocked(client.parseDoltDate);

  it('ne lit aucune date pour une ligne sans created_at, ou dont il est vide ou nul', () => {
    parse.mockClear();

    for (const created_at of [undefined, '', null]) toDependency({ issue_id: 'a', depends_on_issue_id: 'b', type: 'blocks', created_at });
    toDependency({ issue_id: 'a', depends_on_issue_id: 'b', type: 'blocks' });

    expect(parse).not.toHaveBeenCalled();
  });

  it('lit la date d’une ligne qui en a une, une seule fois', () => {
    parse.mockClear();

    const dependency = toDependency({ issue_id: 'a', depends_on_issue_id: 'b', type: 'blocks', created_at: '2026-10-05 09:01:02' });

    expect(parse).toHaveBeenCalledTimes(1);
    expect(dependency?.createdAt).toEqual(new Date('2026-10-05T09:01:02Z'));
  });
});
