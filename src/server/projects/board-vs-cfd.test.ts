import { describe, expect, it } from 'vitest';
import { analyzeProject, computeMetrics, type MetricsTicket } from '../../domain/metrics';
import type { Issue } from '../../shared/api';
import { buildBoard, type ColumnId } from '../../web/kanban/columns';
import { withTimeZone } from '../../web/test/timeZone';
import type { DependencyRecord, IssueSummary } from '../dolt/reader';
import { buildIssues } from './issues';

/**
 * Le tableau du kanban et le CFD, sur un Projet entier : le même Projet nourrit les deux (l'historique de chaque ticket pour
 * le CFD, son état présent tiré de la base par `buildIssues` pour le tableau), et le tableau compte les mêmes tickets que le
 * dernier point du CFD. Le test est ici, dans le projet vitest `node`, parce qu'il passe par `buildIssues` : la suite de
 * `src/web` n'importe aucun code du serveur.
 *
 * C'est aussi le seul garde-fou de deux définitions encore écrites deux fois : l'exclusion des Epics (`isBoardCard` côté
 * tableau, `analyzeProject` côté CFD) et le Blocage par dépendance (`buildIssues` côté serveur, `dependencyBlockage` côté
 * domaine). La règle statut × Blocage -> colonne, elle, n'existe qu'à un endroit (`src/domain/columns.ts`), et son croisement
 * ticket par ticket entre le tableau et le CFD est dans `src/web/kanban/columns.test.ts`.
 */

withTimeZone('Europe/Paris');

/** Jeudi 23 octobre 2026, midi à Paris (heure d'été, UTC+2 jusqu'au 25). */
const NOW = Date.UTC(2026, 9, 23, 10);

describe('le tableau d’un Projet et le dernier point de son CFD comptent les mêmes tickets', () => {
  // Un Projet qui passe par chaque branche de la règle. L'historique de chaque ticket nourrit le CFD ; son état présent,
  // que le serveur tire de la même base (`buildIssues`), nourrit le tableau. Dates en UTC, avant NOW.
  const at = (iso: string) => new Date(`${iso}Z`);
  const CREATED = '2026-10-01T09:00';
  const blocks = (target: string, added = CREATED, removed?: string) => ({
    type: 'blocks',
    target,
    addedAt: at(added),
    ...(removed ? { removedAt: at(removed) } : {}),
  });
  const ticket = (id: string, statuses: [string, string][], extra: Partial<MetricsTicket> = {}): MetricsTicket => ({
    id,
    title: `Ticket ${id}`,
    type: 'task',
    priority: 2,
    statusSnapshots: statuses.map(([status, iso]) => ({ status, at: at(iso) })),
    dependencies: [],
    ...extra,
  });
  /** Ouvert à la création, et jamais touché depuis. */
  const open = (id: string, extra: Partial<MetricsTicket> = {}) => ticket(id, [['open', CREATED]], extra);
  /** Ouvert à la création, puis passé à `status` le lendemain. */
  const moved = (id: string, status: string, extra: Partial<MetricsTicket> = {}) =>
    ticket(id, [['open', CREATED], [status, '2026-10-02T09:00']], extra);
  /** Ouvert à la création, puis fermé à `closedAt`. */
  const shipped = (id: string, closedAt: string, extra: Partial<MetricsTicket> = {}) =>
    ticket(id, [['open', CREATED], ['closed', closedAt]], extra);

  const PROJECT: MetricsTicket[] = [
    // Backlog : ouvert, en Blocage (y compris quand la cible a été fermée un temps, puis rouverte).
    open('backlog', { dependencies: [blocks('ready')] }),
    open('rebloque', { dependencies: [blocks('cible-rouverte')] }),
    // Prêt : ouvert, hors Blocage.
    open('ready'),
    ticket('cible-rouverte', [['open', CREATED], ['closed', '2026-10-02T09:00'], ['open', '2026-10-04T09:00']]),
    open('cible-fermee', { dependencies: [blocks('livre-ancien')] }),
    open('hors-projet', { dependencies: [blocks('ailleurs')] }),
    open('simple-lien', { dependencies: [{ type: 'relates-to', target: 'ready', addedAt: at(CREATED) }] }),
    open('lien-retire', { dependencies: [blocks('ready', CREATED, '2026-10-05T09:00')] }),
    ticket('rouvert', [['open', CREATED], ['closed', '2026-10-02T09:00'], ['open', '2026-10-04T09:00']]),
    // En cours : statut de travail, hors Blocage.
    moved('en-cours', 'in_progress'),
    moved('agent', 'hooked'),
    // Bloqué : statut de travail en Blocage, ou statut bloqué.
    moved('coince', 'in_progress', { dependencies: [blocks('ready', '2026-10-02T09:00')] }),
    moved('agent-coince', 'hooked', { dependencies: [blocks('backlog', '2026-10-02T09:00')] }),
    moved('statut-bloque', 'blocked'),
    // Terminé : fermé il y a longtemps, récemment, ou malgré une dépendance qui n'a jamais été fermée.
    shipped('livre-ancien', '2026-08-01T09:00'),
    shipped('livre-recent', '2026-10-21T09:00'),
    shipped('livre-malgre-dependance', '2026-10-12T09:00', { dependencies: [blocks('ready')] }),
    // En pause : dans aucune colonne ni dans le CFD, même en Blocage.
    moved('differe', 'deferred'),
    moved('epingle', 'pinned'),
    moved('differe-bloque', 'deferred', { dependencies: [blocks('ready', '2026-10-02T09:00')] }),
    moved('revue', 'review'),
    // Une Epic n'est une carte ni du tableau ni du CFD, ouverte ou fermée.
    open('epic-ouverte', { type: 'epic' }),
    shipped('epic-fermee', '2026-10-15T09:00', { type: 'epic' }),
  ];

  /** L'état présent du Projet, tel que le serveur le tire de la base : statut courant, dépendances actives, date de clôture. */
  function currentIssues(tickets: MetricsTicket[]): Issue[] {
    const summaries = tickets.map((t): IssueSummary => {
      const created = t.statusSnapshots[0]?.at ?? at(CREATED);
      const last = t.statusSnapshots.at(-1);
      return {
        id: t.id,
        title: t.title,
        type: t.type,
        status: last?.status ?? '',
        priority: t.priority,
        assignee: null,
        createdAt: created,
        updatedAt: last?.at ?? created,
        closedAt: last?.status === 'closed' ? last.at : null,
      };
    });
    const dependencies = tickets.flatMap((t) =>
      t.dependencies.filter((d) => d.removedAt === undefined).map((d): DependencyRecord => ({ from: t.id, to: d.target, type: d.type })),
    );
    return buildIssues(summaries, dependencies);
  }

  /** Le dernier point du CFD : le Projet tel qu'il est à NOW, par colonne. */
  function lastCfdPoint(): Record<ColumnId, number> {
    const analysis = analyzeProject(PROJECT);
    const report = computeMetrics([{ id: 'p', name: 'Projet P', analysis }], { period: { range: '7d' }, now: new Date(NOW), timeZone: 'Europe/Paris' });
    const last = report.cfd.at(-1);
    if (!last) throw new Error('CFD vide');
    const { backlog, ready, inProgress, blocked, done } = last;
    return { backlog, ready, inProgress, blocked, done };
  }

  const counts = (board: ReturnType<typeof buildBoard>): Record<ColumnId, number> => {
    const { backlog, ready, inProgress, blocked, done } = board.columns;
    return { backlog: backlog.length, ready: ready.length, inProgress: inProgress.length, blocked: blocked.length, done: done.length };
  };
  const ids = (issues: Issue[]) => issues.map((i) => i.id).sort();

  it('répartit les tickets comme le CFD à cet instant, Terminé compris quand sa fenêtre est infinie', () => {
    const board = buildBoard(currentIssues(PROJECT), { now: NOW, doneDays: Infinity });

    expect(ids(board.columns.backlog)).toEqual(['backlog', 'rebloque']);
    expect(ids(board.columns.ready)).toEqual(['cible-fermee', 'cible-rouverte', 'hors-projet', 'lien-retire', 'ready', 'rouvert', 'simple-lien']);
    expect(ids(board.columns.inProgress)).toEqual(['agent', 'en-cours']);
    expect(ids(board.columns.blocked)).toEqual(['agent-coince', 'coince', 'statut-bloque']);
    expect(ids(board.columns.done)).toEqual(['livre-ancien', 'livre-malgre-dependance', 'livre-recent']);
    expect(ids(board.paused)).toEqual(['differe', 'differe-bloque', 'epingle', 'revue']);
    expect(counts(board)).toEqual(lastCfdPoint());
  });

  it('avec la fenêtre de Terminé, seul Terminé s’écarte du CFD, exactement des tickets fermés plus tôt', () => {
    const board = buildBoard(currentIssues(PROJECT), { now: NOW });
    const cfd = lastCfdPoint();

    expect(ids(board.columns.done)).toEqual(['livre-malgre-dependance', 'livre-recent']);
    expect(board.closedEarlier).toBe(1); // livre-ancien, fermé le 1er août
    expect(counts(board).done + board.closedEarlier + board.closedUndated).toBe(cfd.done);
    expect({ ...counts(board), done: 0 }).toEqual({ ...cfd, done: 0 });
  });
});
