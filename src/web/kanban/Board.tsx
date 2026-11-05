import { CirclePause, SearchX } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { epicOf } from '../../domain/epics';
import type { Issue, Project } from '../data/types';
import { Button } from '../ui/Button';
import { Notice } from '../ui/states';
import { useNow } from '../lib/useNow';
import { useKeepFocusInBoard } from './boardFocus';
import { Card } from './Card';
import { useCardFlash } from './cardFlash';
import { Column } from './Column';
import { ColumnSelector } from './ColumnSelector';
import { buildBoard, defaultColumn, doneSince, onlyPaused, type Lane } from './columns';
import { EpicFilter } from './EpicFilter';
import { epicChoices, indexById } from './epics';
import { COLUMNS, countLabel, onlyPausedNotice } from './meta';
import { PausedDrawer } from './PausedDrawer';
import { useBoardParams } from './useBoardParams';
import { useBoardShortcuts, type Lanes } from './useBoardShortcuts';

/**
 * Le kanban d'un Projet : cinq colonnes (Backlog, Prêt, En cours, Bloqué, Terminé) et le tiroir « En pause ».
 *
 * - Le panneau est assez large (60 rem) : les cinq colonnes côte à côte, à largeurs égales. Sinon, une colonne à la
 *   fois, avec un sélecteur : la page ne défile jamais horizontalement. La largeur se mesure sur le panneau, pas sur
 *   l'écran : la barre latérale en prend une partie.
 * - Le filtre Epic, la durée de Terminé et la colonne affichée vivent dans l'adresse (`params.ts`). Terminé couvre les
 *   N derniers jours calendaires, aujourd'hui compris (`columns.ts`).
 * - Sans `?col=`, la colonne affichée sur mobile est choisie à l'ouverture et gardée : un rafraîchissement des données
 *   qui la vide ne fait pas sauter le tableau d'une colonne à l'autre. Seul un choix de l'utilisateur la change.
 * - Quand tous les tickets du tableau sont en pause, aucune colonne n'a de carte : un état vide le dit et renvoie au
 *   tiroir « En pause », qu'il ouvre.
 * - Lecture seule : rien ne se déplace, une carte ouvre son ticket. Mais un commit peut la changer de colonne : elle garde alors le focus (voir `boardFocus`).
 */
export function Board({ project, issues }: { project: Project; issues: readonly Issue[] }) {
  const params = useBoardParams();
  const now = useNow();
  const rootRef = useRef<HTMLDivElement>(null);
  const pausedToggle = useRef<HTMLButtonElement>(null);
  const [pausedOpen, setPausedOpen] = useState(false);

  const byId = useMemo(() => indexById(issues), [issues]);
  const choices = useMemo(() => epicChoices(issues), [issues]);
  const epicCount = choices.open.length + choices.closed.length;
  const hasEpics = epicCount > 0;
  const epic = params.epicId ? [...choices.open, ...choices.closed].find((candidate) => candidate.id === params.epicId) : undefined;

  const board = useMemo(
    () => buildBoard(issues, { now, doneDays: params.doneDays, epicId: epic?.id ?? null }),
    [issues, now, params.doneDays, epic?.id],
  );
  // Minuit du premier jour de Terminé, pour écrire la règle en toutes lettres.
  const since = doneSince(now, params.doneDays);
  // Choisie une fois, au premier rendu avec des données : le composant est remonté pour un autre Projet (voir la page).
  const [opening] = useState(() => defaultColumn(board));
  const column = params.column ?? opening;

  const lanes = useMemo<Lanes>(() => {
    const ids = (cards: Issue[]) => cards.map((issue) => issue.id);
    const { backlog, ready, inProgress, blocked, done } = board.columns;
    return {
      backlog: ids(backlog),
      ready: ids(ready),
      inProgress: ids(inProgress),
      blocked: ids(blocked),
      done: ids(done),
      paused: ids(board.paused),
    };
  }, [board]);
  useBoardShortcuts({ rootRef, lanes, column, onColumn: params.setColumn });
  // Mises à jour en direct : la carte d'un ticket qui change (déplacée, nouvelle) s'éclaire un instant.
  useCardFlash(rootRef, issues);
  // Et le focus qu'elle avait la suit : une carte qui change de colonne est remontée dans l'autre (voir `boardFocus`).
  useKeepFocusInBoard(rootRef);

  // Ouvre le tiroir depuis l'état vide, et y amène le focus : le bouton de l'état vide disparaît une fois le tiroir ouvert.
  const showPaused = () => {
    setPausedOpen(true);
    pausedToggle.current?.focus();
  };

  // Le filtre dit déjà de quelle Epic sont les cartes : la pastille n'y répéterait que l'Epic choisie.
  const renderCard = (issue: Issue, lane: Lane) => {
    const own = epicOf(issue, byId);
    const pill = epic !== undefined && own?.id === epic.id ? null : own;
    return <Card key={issue.id} issue={issue} lane={lane} projectId={project.id} epic={pill} now={now} />;
  };

  return (
    <div ref={rootRef} className="@container flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {hasEpics ? (
          <EpicFilter open={choices.open} closed={choices.closed} value={epic?.id ?? ''} onChange={params.setEpic} />
        ) : null}
        <p aria-live="polite" className="tnum text-ui text-ink-2 sm:ml-auto">
          {countLabel(board.total)}
          {/* Une Epic regroupe des tickets sans être une carte : on dit où la trouver, tant que le tableau n'est pas filtré. */}
          {hasEpics && !epic ? (
            <span className="text-ink-3">
              {' '}
              · {epicCount} {epicCount > 1 ? 'Epics' : 'Epic'} dans le filtre
            </span>
          ) : null}
        </p>
      </div>

      {params.epicId && !epic ? (
        <Notice
          icon={SearchX}
          title={`Aucune Epic « ${params.epicId} » dans ce Projet`}
          action={<Button onClick={() => params.setEpic(null)}>Retirer le filtre</Button>}
        >
          Le tableau montre tous les tickets. L’Epic a peut-être été supprimée, ou le lien vient d’un autre Projet.
        </Notice>
      ) : null}

      {onlyPaused(board) ? <OnlyPausedNotice count={board.paused.length} opened={pausedOpen} onOpen={showPaused} /> : null}

      <ColumnSelector board={board} current={column} onSelect={params.setColumn} />

      <div className="flex min-w-0 flex-col gap-2 @min-[60rem]:grid @min-[60rem]:grid-cols-5">
        {COLUMNS.map(({ id }) => (
          <Column
            key={id}
            id={id}
            count={board.columns[id].length}
            shown={id === column}
            doneDays={params.doneDays}
            since={since}
            closedEarlier={board.closedEarlier}
            closedUndated={board.closedUndated}
            onDoneDays={params.setDoneDays}
          >
            {board.columns[id].map((issue) => renderCard(issue, id))}
          </Column>
        ))}
      </div>

      <PausedDrawer count={board.paused.length} open={pausedOpen} onOpenChange={setPausedOpen} toggleRef={pausedToggle}>
        {board.paused.map((issue) => renderCard(issue, 'paused'))}
      </PausedDrawer>
    </div>
  );
}

/**
 * Tous les tickets du tableau sont en pause : les colonnes sont vides, ce qui laisserait croire le tableau vide. On dit où ils
 * sont, et le bouton ouvre le tiroir (il s'efface une fois le tiroir ouvert, le tiroir s'y ouvre à la main).
 */
function OnlyPausedNotice({ count, opened, onOpen }: { count: number; opened: boolean; onOpen: () => void }) {
  const { title, detail } = onlyPausedNotice(count);
  return (
    <Notice icon={CirclePause} title={title} action={opened ? null : <Button onClick={onOpen}>Ouvrir « En pause »</Button>}>
      {detail}
    </Notice>
  );
}
