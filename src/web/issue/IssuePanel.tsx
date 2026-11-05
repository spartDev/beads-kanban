import { SearchX, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { ApiError } from '../data/client';
import { useIssue } from '../data/hooks';
import { inertOutside } from '../lib/inert';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useOverflow } from '../lib/useOverflow';
import { useProject } from '../pages/ProjectGate';
import { usePalette, useShortcutsHelp } from '../shell/OverlayProvider';
import { useShortcut } from '../shortcuts/ShortcutsProvider';
import { Button } from '../ui/Button';
import { Kbd } from '../ui/Kbd';
import { ErrorNotice, Notice, Skeleton } from '../ui/states';
import { Chronology } from './Chronology';
import { Comments } from './Comments';
import { IssueHeader } from './IssueHeader';
import { Relations } from './Relations';
import { TextSections } from './TextSections';
import { useClosePanel } from './useClosePanel';

/** En dessous du seuil `md:` de Tailwind (768 px), le panneau prend tout l'écran. */
const NARROW_SCREEN = '(max-width: 767.98px)';

/**
 * Le panneau d'un ticket (`/p/<projet>/t/<id>`), posé sur le kanban : un panneau latéral sur desktop, l'écran entier sur
 * mobile. Lecture seule. Sa vie tient à l'adresse : il s'ouvre quand elle l'est (carte, lien, adresse collée), « Retour »
 * ou Échap le ferment (voir `useClosePanel`).
 *
 * - Il prend le focus à l'ouverture et le rend à ce qui l'avait (la carte), pour que le clavier reprenne où il en était.
 * - Échap le ferme par le registre des raccourcis : le raccourci n'existe que tant que le panneau est ouvert, il passe avant
 *   celui du tableau (qui désélectionne une carte : `priority`, quel que soit l'ordre où chacun s'est enregistré) et se tait
 *   sous la palette ou l'aide, qui se ferment d'abord. Fermé, le panneau laisse à Échap du tableau sa désélection.
 * - Selon l'écran, il est une couche posée sur la page ou une boîte de dialogue modale, et le dit (`aria-modal`) : le registre des
 *   raccourcis le lit. Sur écran large (`aria-modal="false"`), le tableau dessous reste utilisable : l'aide (?) et la navigation
 *   (g …) valent même quand le panneau a le focus, alors que les touches du tableau (j, k, h, l, Entrée) se taisent, pour ne pas
 *   lui voler le focus. Sur écran étroit (`aria-modal="true"`, la page est inerte), il garde le clavier comme la palette et l'aide :
 *   Échap le ferme et ⌘K ouvre la palette, la navigation d'un écran étroit ; ni l'aide ni « g … » ne passent derrière un écran plein.
 * - Les deux requêtes sont indépendantes : la fiche, et la chronologie, plus lente (`Chronology`). Un 404, au chargement
 *   comme à un rafraîchissement, dit « Ticket introuvable » au lieu de garder la fiche périmée.
 * - Tant que la fiche charge, le panneau n'a pas de titre à dire : un squelette en tient la place, sans `<h2>` (un titre vide est une
 *   violation d'accessibilité, axe `empty-heading`), et le dialogue se nomme par l'identifiant seul, que l'adresse donne déjà.
 */
export function IssuePanel() {
  const project = useProject();
  const { issueId = '' } = useParams();
  const query = useIssue(project.id, issueId);
  const issue = query.data;
  const gone = query.error instanceof ApiError && query.error.status === 404;
  // Ni fiche, ni échec : pas de titre à écrire encore (`query.isPending` n'est jamais vrai avec une fiche ou une erreur).
  const loading = query.isPending;
  const { close, destination } = useClosePanel(project.id);
  const palette = usePalette();
  const help = useShortcutsHelp();

  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Un ticket long défile : la zone doit alors prendre le focus, pour qu'on puisse la faire défiler au clavier.
  const scrolls = useOverflow(bodyRef, 'y');
  const idId = useId();
  const titleId = useId();

  // Le titre de l'onglet est celui du ticket tant que le panneau est ouvert, puis celui de la page dessous. (Déclaré avant
  // `useDocumentTitle` : l'effet qui le retient doit s'exécuter avant celui qui le change.)
  useEffect(() => {
    const previous = document.title;
    return () => {
      document.title = previous;
    };
  }, []);
  useDocumentTitle(issueId, project.name);

  // Sur un écran étroit, le panneau prend tout l'écran : c'est une boîte de dialogue modale, la page derrière est inerte (ni
  // cliquable, ni atteignable au clavier, ni lue). Sur un écran large, elle reste utilisable à côté. (Un effet de mise en page,
  // pas un effet différé : la page doit cesser d'être inerte dans le rendu même où le panneau disparaît, et le devenir avant le
  // premier affichage ; déclaré avant le focus, dont l'effet rend le focus à la page une fois qu'elle ne l'est plus.)
  const narrow = useMediaQuery(NARROW_SCREEN);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (narrow && panel) return inertOutside(panel);
  }, [narrow]);

  // Le focus : pris à l'ouverture, à chaque ticket (celui qu'un lien du panneau avait est parti avec l'ancien contenu),
  // et rendu à ce qui l'avait quand le panneau se ferme.
  const [opener] = useState(() => document.activeElement);
  useEffect(() => () => restoreFocus(opener), [opener]);
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [issueId]);

  useShortcut({
    id: 'issue.close',
    keys: 'escape',
    label: 'Fermer le ticket',
    group: 'Ticket',
    // Le focus est dans le panneau, une boîte de dialogue : sans cela le registre se tairait.
    allowInInput: true,
    // Le panneau est posé sur le tableau : Échap le ferme avant de désélectionner une carte, que le tableau ait enregistré son
    // raccourci avant le panneau (carte) ou après (adresse : ses tickets arrivent quand le panneau est déjà là).
    priority: 1,
    // Sous la palette ou l'aide, Échap ferme d'abord celles-ci (Radix la prend avant nous, la condition double la règle).
    when: () => !palette.open && !help.open,
    run: close,
  });

  return (
    <div
      ref={panelRef}
      role="dialog"
      // Ce que la palette et l'aide cherchent pour lui rendre le focus quand l'élément d'origine a disparu (voir `OverlayProvider`).
      data-issue-panel=""
      aria-labelledby={loading ? idId : `${idId} ${titleId}`}
      aria-modal={narrow}
      tabIndex={-1}
      className="fixed inset-0 z-40 flex animate-[panel-fade-in_140ms_ease-out] flex-col bg-panel outline-none md:inset-y-2 md:left-auto md:right-2 md:w-[min(42rem,calc(100vw-1rem))] md:animate-[panel-in_160ms_cubic-bezier(0.2,0.8,0.2,1)] md:rounded-xl md:border md:border-line md:shadow-float"
    >
      <header className="flex items-start gap-3 border-b border-line px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <p id={idId} className="wrap-anywhere font-mono text-xs font-medium text-ink-3">
            {issueId}
          </p>
          {loading ? (
            // Pas de `<h2>` avant le titre : vide, il serait une violation (axe `empty-heading`). Le squelette prend sa place, avec sa
            // marge et sa hauteur d'une ligne (`leading-6`) : l'en-tête garde sa forme quand le titre arrive.
            <Skeleton className="mt-0.5 h-6 w-2/3" />
          ) : (
            <h2 id={titleId} className="mt-0.5 wrap-anywhere text-[17px] font-semibold leading-6 tracking-[-0.01em] text-ink">
              {gone ? 'Ticket introuvable' : issue ? issue.title : 'Ticket indisponible'}
            </h2>
          )}
        </div>
        <div className="-mr-1.5 -mt-0.5 flex shrink-0 items-center gap-1">
          {/* À côté du bouton, pas dedans : le texte visible d'un bouton doit figurer dans son nom (WCAG 2.5.3), et celui-ci n'en a pas. */}
          <span aria-hidden="true" className="max-md:hidden">
            <Kbd>Échap</Kbd>
          </span>
          <button
            type="button"
            aria-label="Fermer le panneau"
            onClick={close}
            className="inline-flex size-8 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-hover hover:text-ink"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        ref={bodyRef}
        data-panel-body
        role={scrolls ? 'region' : undefined}
        aria-label={scrolls ? 'Contenu du ticket' : undefined}
        tabIndex={scrolls ? 0 : undefined}
        // Le contour reste à l'intérieur : le panneau rogne ce qui le dépasse.
        className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 py-4 focus-visible:-outline-offset-2"
      >
        {gone ? (
          <Notice
            icon={SearchX}
            title={`Aucun ticket « ${issueId} » dans ${project.name}`}
            action={<Button onClick={close}>Retour {destination}</Button>}
          >
            L’identifiant est peut-être celui d’un autre Projet : la palette (⌘K) peut chercher dans tous les Projets.
          </Notice>
        ) : issue ? (
          <>
            <IssueHeader issue={issue} projectId={project.id} />
            <Chronology projectId={project.id} issueId={issueId} />
            <TextSections issue={issue} />
            <Relations issue={issue} projectId={project.id} />
            <Comments comments={issue.comments} />
          </>
        ) : loading ? (
          <div role="status" aria-busy="true" aria-label="Chargement du ticket" className="flex flex-col gap-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        ) : (
          <ErrorNotice error={query.error} title="Impossible de charger le ticket" onRetry={() => void query.refetch()} />
        )}
      </div>
    </div>
  );
}

/**
 * Rend le focus à ce qui l'avait avant l'ouverture du panneau (la carte du tableau). Le tableau n'est pas remonté par
 * l'ouverture du panneau (voir `KanbanRoute`) : cet élément est toujours là. S'il a disparu, ou si le focus est allé
 * ailleurs de lui-même (un lien de la barre latérale, une autre page), on n'y touche pas.
 */
function restoreFocus(opener: Element | null): void {
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected) return;
  if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
}
