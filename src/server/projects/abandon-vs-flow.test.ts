import { describe, expect, it } from 'vitest';
import { analyzeFlow, type DependencyHistory, type TicketHistory } from '../../domain/flow';
import type { DependencyRecord, IssueSummary } from '../dolt/reader';
import { buildIssues } from './issues';

/**
 * L'Abandon du kanban (la pastille « Abandon » des cartes et du détail, que `buildIssues` tire de l'état présent) et celui
 * des métriques (`analyzeFlow`, qui lit l'historique des liens) sont la même chose : un ticket fermé que l'un de ses liens
 * déclare doublon d'un autre ou remplacé par lui. La règle est une seule (`abandonOf`, src/domain/abandon.ts), que chacun lit sur
 * ses liens, l'un sur les dépendances actives d'aujourd'hui, l'autre sur leur historique ; ce test les fait lire le même Projet et
 * refuse qu'ils s'écartent sur la cause. Il est ici, dans le projet vitest `node`, parce qu'il passe par
 * `buildIssues` (voir `board-vs-cfd.test.ts`).
 *
 * Les deux ne lisent pas les mêmes dates : l'historique dit à quel commit un lien apparaît, l'état présent quand sa ligne a été
 * écrite (`created_at`). Un seul commit peut réunir des liens posés à des moments différents (un lot de bd, un import, un
 * historique aplati) : seul le `created_at` de leur ligne, que l'historique lit aussi, dit alors lequel a été posé le premier
 * (scénarios « meme-commit-… »).
 */

const at = (iso: string) => new Date(`${iso}Z`);
const CREATED = '2026-10-01T09:00';

interface Scenario {
  id: string;
  type?: string;
  statuses: [status: string, iso: string][];
  /**
   * Les liens du ticket, dans l'ordre où ils sont posés : une minute après le précédent, sauf `placed` (leur instant, celui du
   * `created_at` de leur ligne). `commit` : le commit de l'historique où le lien apparaît, par défaut l'instant où il a été posé.
   * `removed` : retiré depuis (absent de l'état présent, présent dans l'historique).
   */
  links?: { type: string; target: string; removed?: string; placed?: string; commit?: string }[];
}

const CLOSED: Scenario['statuses'] = [['open', CREATED], ['closed', '2026-10-05T09:00']];
/** Un commit qui réunit des liens posés avant lui : un lot de bd, un import, ou un historique aplati qui ne garde du ticket que son dernier état. */
const BATCH = '2026-10-06T08:00';

const SCENARIOS: Scenario[] = [
  { id: 'livre', statuses: CLOSED },
  { id: 'livre-malgre-blocage', statuses: CLOSED, links: [{ type: 'blocks', target: 'ouvert' }] },
  { id: 'doublon', statuses: CLOSED, links: [{ type: 'duplicates', target: 'livre' }] },
  { id: 'remplace', statuses: CLOSED, links: [{ type: 'supersedes', target: 'livre' }] },
  { id: 'doublon-hors-projet', statuses: CLOSED, links: [{ type: 'duplicates', target: 'external:ailleurs:x-1' }] },
  { id: 'lien-retire', statuses: CLOSED, links: [{ type: 'duplicates', target: 'livre', removed: '2026-10-06T09:00' }] },
  { id: 'rouvert', statuses: [...CLOSED, ['open', '2026-10-06T09:00']], links: [{ type: 'duplicates', target: 'livre' }] },
  { id: 'refermé', statuses: [...CLOSED, ['open', '2026-10-06T09:00'], ['closed', '2026-10-07T09:00']], links: [{ type: 'supersedes', target: 'livre' }] },
  { id: 'ouvert', statuses: [['open', CREATED]], links: [{ type: 'duplicates', target: 'livre' }] },
  { id: 'epic-fermee', type: 'epic', statuses: CLOSED, links: [{ type: 'duplicates', target: 'livre' }] },
  // Les deux liens : celui du premier posé fait la cause, dans un sens comme dans l'autre.
  { id: 'doublon-puis-remplace', statuses: CLOSED, links: [{ type: 'duplicates', target: 'livre' }, { type: 'supersedes', target: 'doublon' }] },
  { id: 'remplace-puis-doublon', statuses: CLOSED, links: [{ type: 'supersedes', target: 'doublon' }, { type: 'duplicates', target: 'livre' }] },
  // Posés au même instant : la plus petite cible (« doublon » avant « livre »), quel que soit le type du lien.
  {
    id: 'meme-instant',
    statuses: CLOSED,
    links: [{ type: 'duplicates', target: 'livre', placed: '2026-10-05T09:01' }, { type: 'supersedes', target: 'doublon', placed: '2026-10-05T09:01' }],
  },
  // Les deux liens apparaissent au même commit (sanofi-ai-standards : dix liens dans un commit de lot), et seul le created_at de
  // leur ligne dit lequel est le premier. La plus petite cible (« doublon » avant « livre ») dirait l'inverse.
  {
    id: 'meme-commit-remplace-puis-doublon',
    statuses: [['closed', BATCH]],
    links: [{ type: 'supersedes', target: 'livre', commit: BATCH }, { type: 'duplicates', target: 'doublon', commit: BATCH }],
  },
  {
    id: 'meme-commit-doublon-puis-remplace',
    statuses: [['closed', BATCH]],
    links: [{ type: 'duplicates', target: 'livre', commit: BATCH }, { type: 'supersedes', target: 'doublon', commit: BATCH }],
  },
  // Le premier lien posé a été retiré : le suivant fait la cause. Dans l'historique le lien retiré existe encore, daté de sa pose.
  {
    id: 'premier-retire',
    statuses: CLOSED,
    links: [{ type: 'supersedes', target: 'doublon', removed: '2026-10-06T09:00' }, { type: 'duplicates', target: 'livre' }],
  },
  {
    id: 'deuxieme-retire',
    statuses: CLOSED,
    links: [{ type: 'supersedes', target: 'doublon' }, { type: 'duplicates', target: 'livre', removed: '2026-10-06T09:00' }],
  },
];

/** L'instant où le lien numéro `index` du ticket a été posé. */
const placedAt = (index: number, placed?: string) => at(placed ?? `2026-10-05T09:0${index + 1}`);

const histories = (): TicketHistory[] =>
  SCENARIOS.map(({ id, type = 'task', statuses, links = [] }) => ({
    id,
    type,
    statusSnapshots: statuses.map(([status, iso]) => ({ status, at: at(iso) })),
    dependencies: links.map(({ type: linkType, target, removed, placed, commit }, index): DependencyHistory => {
      const createdAt = placedAt(index, placed);
      return {
        type: linkType,
        target,
        addedAt: commit ? at(commit) : createdAt,
        createdAt,
        ...(removed ? { removedAt: at(removed) } : {}),
      };
    }),
  }));

/**
 * L'état présent, tel que le serveur le tire de la base : le dernier statut, et les liens qui n'ont pas été retirés, datés de
 * leur pose (le `created_at` de leur ligne). `arrange` change l'ordre des lignes : la base ne les rend pas dans l'ordre de pose.
 */
function currentIssues(arrange: (rows: DependencyRecord[]) => DependencyRecord[] = (rows) => rows) {
  const summaries = SCENARIOS.map(({ id, type = 'task', statuses }): IssueSummary => {
    const last = statuses.at(-1);
    return {
      id,
      title: id,
      type,
      status: last?.[0] ?? '',
      priority: 2,
      assignee: null,
      createdAt: at(CREATED),
      updatedAt: at(last?.[1] ?? CREATED),
      closedAt: last?.[0] === 'closed' ? at(last[1]) : null,
    };
  });
  const dependencies = SCENARIOS.flatMap(({ id, links = [] }) =>
    links.flatMap((link, index): DependencyRecord[] =>
      link.removed === undefined ? [{ from: id, to: link.target, type: link.type, createdAt: placedAt(index, link.placed) }] : [],
    ),
  );
  return buildIssues(summaries, arrange(dependencies));
}

describe('l’Abandon du kanban et celui des métriques', () => {
  const flows = analyzeFlow(histories());

  describe.each([
    ['dans l’ordre où les liens ont été posés', (rows: DependencyRecord[]) => rows],
    ['dans l’ordre inverse', (rows: DependencyRecord[]) => [...rows].reverse()],
    ['rangées par cible, comme une base qui ne les rend pas dans l’ordre de pose', (rows: DependencyRecord[]) => [...rows].sort((a, b) => b.to.localeCompare(a.to))],
  ])('avec des lignes de dépendances %s', (_order, arrange) => {
    const issues = new Map(currentIssues(arrange).map((issue) => [issue.id, issue]));

    it.each(SCENARIOS.map(({ id }) => id))('disent la même chose du ticket « %s »', (id) => {
      const outcome = flows.get(id)?.outcome;
      const abandon = issues.get(id)?.abandon;

      if (outcome?.kind === 'abandoned') expect(abandon?.cause).toBe(outcome.cause);
      else expect(abandon).toBeUndefined();
    });

    it('en voient autant, et pas un de moins que ceux que le scénario construit pour l’être', () => {
      const abandoned = [...flows].filter(([, flow]) => flow.outcome.kind === 'abandoned').map(([id]) => id);

      expect(abandoned.sort()).toEqual([
        'deuxieme-retire',
        'doublon',
        'doublon-hors-projet',
        'doublon-puis-remplace',
        'meme-commit-doublon-puis-remplace',
        'meme-commit-remplace-puis-doublon',
        'meme-instant',
        'premier-retire',
        'refermé',
        'remplace',
        'remplace-puis-doublon',
      ]);
      expect([...issues.values()].filter((issue) => issue.abandon).map((issue) => issue.id).sort()).toEqual(abandoned);
    });

    // Les deux pourraient se tromper de la même façon sans se contredire : la cause attendue est écrite, et la cible côté kanban.
    it.each([
      ['doublon-puis-remplace', 'duplicate', 'livre'],
      ['remplace-puis-doublon', 'superseded', 'doublon'],
      ['meme-instant', 'superseded', 'doublon'],
      ['meme-commit-remplace-puis-doublon', 'superseded', 'livre'],
      ['meme-commit-doublon-puis-remplace', 'duplicate', 'livre'],
      ['premier-retire', 'duplicate', 'livre'],
      ['deuxieme-retire', 'superseded', 'doublon'],
    ])('donnent au ticket « %s » la cause « %s », pour le ticket « %s »', (id, cause, target) => {
      expect(flows.get(id)?.outcome).toMatchObject({ kind: 'abandoned', cause });
      expect(issues.get(id)?.abandon).toEqual({ cause, of: target });
    });
  });
});
