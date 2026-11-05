import { SearchX, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { ApiError } from '../data/client';
import { ticketTitle } from '../data/helpers';
import { useIssue } from '../data/hooks';
import { focusCardOrZone } from '../kanban/boardFocus';
import { focusElement, focusIsAdrift } from '../lib/focus';
import { inertOutside } from '../lib/inert';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useScrollFocusable } from '../lib/useOverflow';
import { useProject } from '../pages/ProjectGate';
import { usePalette, useShortcutsHelp } from '../shell/OverlayProvider';
import { useShortcut } from '../shortcuts/ShortcutsProvider';
import { Button } from '../ui/Button';
import { Kbd } from '../ui/Kbd';
import { ErrorNotice, Notice, Skeleton } from '../ui/states';
import { Chronology } from './Chronology';
import { Comments } from './Comments';
import { IssueHeader } from './IssueHeader';
import { keepFocusInPanel } from './panelFocus';
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
 * - Il prend le focus à l'ouverture et le rend à ce qui l'avait (la carte), pour que le clavier reprenne où il en était ; à défaut
 *   (adresse collée, champ de la palette qui l'a ouvert et qui est retiré depuis), au contenu principal, jamais au corps de la page
 *   (voir `restoreFocus`), et à la carte là où elle est maintenant quand un commit l'a changée de colonne entre-temps. Le corps du panneau change d'un coup d'état (l'avis d'erreur et son bouton « Réessayer » que le squelette remplace,
 *   le contenu qu'un 404 remplace) et ce qui y a le focus part avec lui : le panneau le prend avant, quelle que soit la cause du changement
 *   (un réessai, la fiche relue au retour sur l'onglet, le direct ; voir `keepFocusInPanel`). Après « Réessayer », il le donne au titre quand la
 *   fiche arrive, ce que le lecteur d'écran lit (voir `retry`).
 * - Échap le ferme par le registre des raccourcis : le raccourci n'existe que tant que le panneau est ouvert, il passe avant
 *   celui du tableau (qui désélectionne une carte : `priority`, quel que soit l'ordre où chacun s'est enregistré) et se tait
 *   sous la palette ou l'aide, qui se ferment d'abord. Fermé, le panneau laisse à Échap du tableau sa désélection.
 * - Selon l'écran, il est une couche posée sur la page ou une boîte de dialogue modale, et le dit (`aria-modal`) : le registre des
 *   raccourcis le lit. Sur écran large (`aria-modal="false"`), le tableau dessous reste utilisable : l'aide (?) et la navigation
 *   (g …) valent même quand le panneau a le focus, alors que les touches du tableau (j, k, h, l, Entrée) se taisent, pour ne pas
 *   lui voler le focus. Sur écran étroit (`aria-modal="true"`, la page est inerte), il garde le clavier comme la palette et l'aide :
 *   Échap le ferme et ⌘K ouvre la palette, la navigation d'un écran étroit ; ni l'aide ni « g … » ne passent derrière un écran plein.
 * - Les deux requêtes sont indépendantes : la fiche, et la chronologie, plus lente (`Chronology`). Un 404, au chargement
 *   comme à un rafraîchissement, dit « Ticket introuvable » au lieu de garder la fiche périmée, et en donne les deux raisons possibles : l'identifiant
 *   est celui d'un autre Projet, ou bd n'a pas encore enregistré le ticket (l'application ne montre que ce que bd a enregistré, voir « Dernier commit »
 *   dans CONTEXT.md) ; dans ce second cas seulement, il s'affiche ici dès qu'il l'est, la fiche étant relue à chaque mise à jour du Projet.
 * - Tant que la fiche charge, le panneau n'a pas de titre à dire : un squelette en tient la place, sans `<h2>` (un titre vide est une
 *   violation d'accessibilité, axe `empty-heading`), et le dialogue se nomme par l'identifiant seul, que l'adresse donne déjà. Un ticket qui n'a pas
 *   de titre se titre « Sans titre » (`ticketTitle`, que la carte du kanban suit aussi), pour la même raison.
 */
export function IssuePanel() {
  const project = useProject();
  const { issueId = '' } = useParams();
  const query = useIssue(project.id, issueId);
  const issue = query.data;
  const gone = query.error instanceof ApiError && query.error.status === 404;
  // Ni fiche, ni échec : pas de titre à écrire encore (`query.isPending` n'est jamais vrai avec une fiche ou une erreur).
  const loading = query.isPending;
  // La fiche ne se lit pas, et ce n'est pas un 404 : « Ticket indisponible », avec « Réessayer ».
  const failed = !loading && !gone && !issue;
  // Ce que montre le corps du panneau : il change d'un coup, quand l'état change.
  const bodyState = gone ? 'gone' : issue ? 'issue' : loading ? 'loading' : 'failed';
  const { close, destination } = useClosePanel(project.id);
  const palette = usePalette();
  const help = useShortcutsHelp();

  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // « Réessayer » a été activé, et son issue n'est pas arrivée (voir `retry`).
  const retrying = useRef(false);
  // Un ticket long défile : la zone doit alors prendre le focus, pour qu'on puisse la faire défiler au clavier. Elle le garde tant qu'elle l'a, même quand un commit
  // raccourcit le texte au point qu'il ne défile plus : lui retirer son `tabindex` la ferait perdre le focus, qui tomberait sur le corps de la page (voir `useScrollFocusable`).
  const focusable = useScrollFocusable(bodyRef, 'y');
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
    retrying.current = false; // un réessai attendait la fiche d'un autre ticket : son issue n'est plus celle-ci
    panelRef.current?.focus({ preventScroll: true });
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [issueId]);

  // L'issue d'un réessai, quelle qu'elle soit : le réessai est fini, il ne reste pas armé (une relecture qui réussirait plus tard, au retour sur l'onglet,
  // n'est pas une demande de l'utilisateur). La fiche, ou son absence (404), arrive : le titre prend alors le focus que `retry` a donné au panneau, car
  // le lecteur d'écran lit l'élément qui le prend, alors qu'il ne relit pas le nom du dialogue qui change. Un échec de plus ne le prend pas (l'alerte le
  // dit déjà, et le panneau garde le focus), et si l'utilisateur l'a mis ailleurs entre-temps, on n'y touche pas. (`errorUpdateCount` : un échec qui
  // revient aussitôt peut ne jamais dessiner le rechargement, ni `loading` ni `failed` ne changent alors.)
  useEffect(() => {
    if (!retrying.current || loading) return;
    retrying.current = false;
    if (failed) return;
    if (document.activeElement === panelRef.current) titleRef.current?.focus({ preventScroll: true });
  }, [loading, failed, query.errorUpdateCount]);

  // « Réessayer ». La fiche n'a ni donnée ni erreur le temps du rechargement (`loading`) : le squelette prend la place de l'avis d'erreur, le bouton
  // part avec lui, et le focus qu'il avait tomberait sur le corps de la page, hors du panneau (sur mobile, hors d'une boîte de dialogue modale).
  // `keepFocusInPanel` le rend au panneau quand le bouton le tient ; ici le panneau le prend aussi quand le bouton ne l'a pas pris (un toucher, un
  // lecteur d'écran, Safari), pour que le titre le reçoive à l'arrivée de la fiche.
  const retry = () => {
    retrying.current = true;
    panelRef.current?.focus({ preventScroll: true });
    void query.refetch();
  };

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
            // Focalisable par programme seulement (`tabIndex={-1}`) : `retry` lui donne le focus quand la fiche arrive. Il garde le contour de base des
            // éléments à `tabindex` (l'accent du thème, au clavier seulement : `:focus-visible`, jamais après un clic) pour que l'utilisateur au clavier voie où
            // le focus est allé ; resserré sur le texte (`w-fit`, `rounded-sm`, un pixel d'écart) : pas de cadre sur toute la largeur de l'en-tête.
            <h2
              ref={titleRef}
              id={titleId}
              tabIndex={-1}
              className="mt-0.5 w-fit max-w-full wrap-anywhere rounded-sm text-[17px] font-semibold leading-6 tracking-[-0.01em] text-ink focus-visible:outline-offset-1"
            >
              {gone ? 'Ticket introuvable' : issue ? ticketTitle(issue) : 'Ticket indisponible'}
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
        role={focusable ? 'region' : undefined}
        aria-label={focusable ? 'Contenu du ticket' : undefined}
        tabIndex={focusable ? 0 : undefined}
        // Le contour reste à l'intérieur : le panneau rogne ce qui le dépasse.
        className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 py-4 focus-visible:-outline-offset-2"
      >
        {/* Une enveloppe par état (`key`) : quand l'état change, elle part avec ce qu'elle contient, et `keepFocusInPanel` rend au panneau le focus qu'elle y avait.
            `contents` : elle ne dessine aucune boîte, ce qu'elle contient reste dans le flux du corps. */}
        <div key={bodyState} ref={keepFocusInPanel} className="contents">
          {gone ? (
            <Notice
              icon={SearchX}
              title={`Aucun ticket « ${issueId} » dans ${project.name}`}
              action={<Button onClick={close}>Retour {destination}</Button>}
            >
              <p>L’identifiant est peut-être celui d’un autre Projet : la palette (⌘K) peut chercher dans tous les Projets.</p>
              <p className="mt-1">Le ticket n’est peut-être pas encore enregistré par bd ; dans ce cas, il s’affichera ici dès qu’il le sera.</p>
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
            <ErrorNotice error={query.error} title="Impossible de charger le ticket" onRetry={retry} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Rend le focus à ce qui l'avait avant l'ouverture du panneau (la carte du tableau), sinon au contenu principal : jamais au corps de la page
 * (les règles de `focus.ts`, celles de la palette et de l'aide). Le tableau n'est pas remonté par l'ouverture du panneau (voir `KanbanRoute`) :
 * la carte est toujours là. Mais l'origine peut n'être rien (une adresse collée : le corps de la page) ou avoir disparu (le champ de la palette,
 * quand un choix de la palette a ouvert le panneau, est retiré avec elle). Si l'origine est le lien d'une carte qu'un commit a changée de colonne
 * pendant que le panneau était ouvert, ce lien est retiré, et c'est la carte, là où elle est maintenant, qui reçoit le focus ; le contenu principal
 * quand elle n'est pas à l'écran (la colonne d'arrivée est cachée sur un écran étroit, le ticket est supprimé : voir `focusCardOrZone`). Si le focus est
 * allé ailleurs de lui-même (un lien de la barre latérale, une autre carte, une autre page), on n'y touche pas.
 */
function restoreFocus(opener: Element | null): void {
  if (!focusIsAdrift() || focusElement(opener)) return;
  const main = document.querySelector('main');
  if (main) focusCardOrZone(main, opener ?? undefined);
}
