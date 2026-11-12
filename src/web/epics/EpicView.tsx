import { useCallback, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { epicChildren, epicProgress, epicTree, groupByColumn } from '../../domain/epics';
import type { Issue, Project } from '../data/types';
import { statusLabel } from '../design/issue-palette';
import { epicName } from '../kanban/epics';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useNow } from '../lib/useNow';
import { Page, SectionTitle } from '../pages/Page';
import { paths } from '../paths';
import { PriorityBadge, TypeBadge } from '../ui/IssueBadges';
import { BackToEpics } from './BackToEpics';
import { ByColumn } from './ByColumn';
import { ProgressSection } from './ProgressSection';
import { TimeSection } from './TimeSection';
import { Tree } from './Tree';
import { parseView, VIEW_PARAM, type EpicView } from './view';
import { ViewSwitch } from './ViewSwitch';

/**
 * Les liens du haut de la page, celui de `BackToEpics` compris, font 24 px de haut au moins (bdesk-38k.85). La barre du haut est collante : quand on défile, ses boutons recouvrent en partie un lien qui passe dessous (sur mobile le bouton du Projet,
 * quel que soit son nom ; à 1280 px le fil d'Ariane, selon la longueur du nom), et `target-size` d'axe (WCAG 2.5.8) veut alors dans le lien 24 px sur 24 que rien ne recouvre : un lien de 20 px de haut, large de son texte, n'en a pas (à 375 px, 14
 * positions de défilement d'un pixel en violation par lien, avec un nom de Projet long). La hauteur minimale fixe les 24 px, même quand l'espacement du texte (WCAG 1.4.12) rétrécit la ligne ; le rembourrage centre le texte, la marge négative reprend les
 * 2 px de chaque côté : la page ne bouge pas. « Epics », seul sur sa ligne, la prend en entier, au bureau comme sur mobile : à la largeur de son texte il échoue encore pour certains noms de Projet (le fil d'Ariane de la barre le recouvre alors par le milieu), un plafond
 * de largeur aussi (12 et 24 rem mesurés : chacun échoue pour un autre nom) ; le prix est que le vide à sa droite est cliquable, comme dans le résumé « Données du graphique » (ChartParts.tsx). Sur mobile, la phrase ci-dessous prend aussi la ligne, ses deux liens l'un sous l'autre : la zone
 * libre que la barre laisse à côté du bouton du Projet (TopBar.tsx) tombe dans chacun. Sous 11 rem de large la barre n'a plus cette zone (TopBar.tsx) : la phrase écarte alors ses deux liens de 12 px, pour qu'axe ne les prenne plus pour voisins l'un de l'autre (zoom à 200 % d'une fenêtre
 * de 320 px). Au bureau, les deux liens de la phrase restent étroits et côte à côte (les agrandir ajouterait un second vide cliquable) : pour certains noms et certaines largeurs, ils gardent quelques positions en violation (voir la preuve de bdesk-38k.85). Ce que le test lit :
 * EpicView.targetSize.test.tsx.
 */
const LINK = '-my-0.5 min-h-[24px] py-0.5 font-medium text-accent hover:underline';

/**
 * La page d'une Epic (`/p/<projet>/epics?epic=<id>`) : son avancement (les Livraisons parmi ses Enfants, en nombre), son Lead
 * Time et la prévision de sa fin, puis ses Enfants, par colonne ou en arbre. Tout se calcule des tickets du Projet, ceux que
 * le kanban a déjà : rien de plus à lire, et les mises à jour en direct la tiennent à jour comme lui.
 *
 * Les Enfants sont les mêmes que ceux du filtre Epic du kanban (`epicChildren`), rangés par la même règle de colonne
 * (`columnFor`). L'affichage choisi vit dans l'adresse (`?view=tree`), pour qu'un lien le partage.
 */
export function EpicView({ project, epic, issues }: { project: Project; epic: Issue; issues: readonly Issue[] }) {
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const view = parseView(params.get(VIEW_PARAM));
  // Le titre de la page et celui de l'onglet disent le nom de l'Epic (`epicName`) : son identifiant quand elle n'a pas de titre, jamais un titre vide
  // (axe `empty-heading`) ni un onglet qui commence par « · ».
  useDocumentTitle(epicName(epic), project.name);

  // D'une Epic à l'autre (le lien d'une Epic imbriquée), la page est la même et le panneau de contenu du shell garde son
  // défilement : on repart du haut, comme pour une nouvelle page. Changer seulement d'affichage ne touche à rien.
  useEffect(() => {
    const content = document.getElementById('contenu');
    if (content) content.scrollTop = 0;
  }, [epic.id]);

  const { children, epics: nestedEpics } = useMemo(() => epicChildren(epic.id, issues), [epic.id, issues]);
  const progress = useMemo(() => epicProgress(children), [children]);
  const groups = useMemo(() => groupByColumn(children), [children]);
  const tree = useMemo(() => epicTree(epic.id, issues), [epic.id, issues]);
  const progressOf = useCallback((epicId: string) => epicProgress(epicChildren(epicId, issues).children), [issues]);

  // Chaque changement remplace l'entrée de l'historique : « Retour » quitte la page, il ne rejoue pas les bascules.
  const setView = (next: EpicView) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        if (next === 'tree') updated.set(VIEW_PARAM, 'tree');
        else updated.delete(VIEW_PARAM);
        return updated;
      },
      { replace: true },
    );

  return (
    <Page title={epicName(epic)} eyebrow={<BackToEpics projectId={project.id} />}>
      <div className="flex flex-col gap-2">
        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-ink-2">
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Type</dt>
            <dd>
              <TypeBadge type="epic" />
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Identifiant</dt>
            <dd className="wrap-anywhere font-mono text-xs text-ink-3">{epic.id}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Priorité</dt>
            <dd>
              <PriorityBadge priority={epic.priority} />
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Statut</dt>
            <dd>{statusLabel(epic.status)}</dd>
          </div>
        </dl>
        <p className="flex flex-wrap gap-x-4 gap-y-1 max-md:flex-col max-[11rem]:gap-y-4">
          <Link to={paths.issue(project.id, epic.id)} className={LINK}>
            Ouvrir le ticket
          </Link>
          <Link to={paths.kanban(project.id, epic.id)} className={LINK}>
            Voir au kanban
          </Link>
        </p>
      </div>

      <ProgressSection progress={progress} groups={groups} />
      <TimeSection epic={epic} kids={children} now={now} />

      {children.length + nestedEpics.length > 0 ? (
        <section aria-labelledby="epic-children" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionTitle id="epic-children">Enfants</SectionTitle>
            <ViewSwitch value={view} onChange={setView} />
          </div>
          {view === 'tree' ? (
            <Tree nodes={tree} projectId={project.id} now={now} progressOf={progressOf} />
          ) : (
            <ByColumn groups={groups} nestedEpics={nestedEpics} projectId={project.id} now={now} progressOf={progressOf} />
          )}
        </section>
      ) : null}
    </Page>
  );
}
