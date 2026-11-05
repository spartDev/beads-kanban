import { focusContainer, focusIsAdrift } from './focus';

/**
 * Où le focus revient quand ce qui le tenait disparaît parce que sa zone se recharge (l'avis d'erreur et son bouton « Réessayer » que le squelette
 * remplace, le bandeau qui part au rétablissement). La zone est la plus proche de ce qui part :
 * - le panneau d'un ticket (`data-issue-panel`), que la palette et l'aide cherchent aussi pour lui rendre le focus (voir `OverlayProvider`) ;
 * - une région nommée que la page marque `data-focus-zone` (la liste des Projets de la barre latérale, la section « Projets suivis » de la Vue globale) ;
 * - à défaut, le contenu principal (`main`) ou la boîte de dialogue qui contient ce qui part : celui que `focus.ts` donne déjà au focus quand une boîte de
 *   dialogue se referme, et jamais, pour une boîte modale, un contenu hors d'elle ;
 * - faute de mieux, le contenu principal de la page.
 * Jamais le corps de la page, qui ne vaut pas un focus.
 */
const ZONE = '[data-issue-panel], [data-focus-zone]';
const ENCLOSING = 'main, [role="dialog"], [role="alertdialog"]';

/** Le marqueur du titre d'un squelette (`Page` le pose sur le `h1` dont le titre est `null`, la page charge) : ni le titre de la page, ni son nom pour le lecteur d'écran (« Chargement… »). */
const SKELETON = '[data-skeleton]';

/** La zone qui contient `from`, sinon la boîte de dialogue ou le contenu principal qui le contient, sinon le contenu principal. */
export function zoneOf(from: Element): HTMLElement | null {
  const zone = from.closest(ZONE) ?? from.closest(ENCLOSING) ?? document.querySelector('main');
  return zone instanceof HTMLElement ? zone : null;
}

/**
 * Le titre d'une zone : son premier intertitre (le titre de la page dans le contenu principal, celui de la section dans une région), hors le titre d'un
 * squelette : ce n'est pas le titre de la page, et la page qui le remplace le retire du document, avec le focus qu'on lui aurait donné. Ce qui le dit est le marqueur
 * `data-skeleton`, pas le nom ni le texte : le squelette a un nom pour les lecteurs d'écran (« Chargement… »), qui n'est pas celui d'un titre à lire.
 */
export function titleOf(zone: Element): HTMLElement | null {
  return zone.querySelector<HTMLElement>(`h1:not(${SKELETON}), h2:not(${SKELETON})`);
}

/** La zone a encore le titre d'un squelette : le titre de la page qui le remplacera n'est pas encore là. */
export function showsSkeletonTitle(zone: Element): boolean {
  return zone.querySelector(`h1${SKELETON}, h2${SKELETON}`) !== null;
}

/**
 * La page que montre la zone : l'adresse (chemin et paramètres) que le shell écrit sur le contenu principal (`data-location`, voir `AppShell`), ou `null` pour une zone qui n'en
 * dit rien (la barre latérale). Elle est écrite dans le même rendu que la page : quand l'observateur de mutations de `focusTitleWhenReady` s'exécute, juste après ce rendu, c'est
 * l'adresse de la page qui vient d'arriver, jamais celle de la précédente. C'est donc le document qui dit qu'on a changé de page : la zone ne connaît pas le routeur, et un effet qui
 * l'interrogerait pourrait s'exécuter après l'observateur, quand le titre de la nouvelle page a déjà pris le focus.
 */
export function locationOf(zone: Element): string | null {
  return zone.closest('[data-location]')?.getAttribute('data-location') ?? null;
}

/** Donne le focus à la zone qui contient `from`. `tabindex="-1"` ne lui est posé que le temps qu'elle l'a (voir `focusContainer`). */
export function focusZoneOf(from: Element): boolean {
  return focusContainer(zoneOf(from));
}

/**
 * Donne le focus au titre de la zone, s'il a le focus encore (l'utilisateur ne l'a pas mis ailleurs) et dès que ce titre existe : tant que la zone n'a que le
 * titre d'un squelette (la porte du Projet qui ouvre la page d'une Epic, dont les tickets se chargent encore), la zone le garde, et le titre de la page qui arrive
 * le prend. L'attente s'arrête dès que le focus quitte la zone, quand le titre est donné, quand la zone montre une autre page que celle qu'on attendait (l'utilisateur
 * a pris un raccourci, un lien, « Retour » : le titre de celle-ci n'est pas celui qu'il a demandé, voir `locationOf`), ou par la fonction rendue.
 *
 * `page` : la page où le focus a été demandé. « Réessayer » et « Reconnecter » en retiennent l'adresse (`locationOf`) en étant pressés, et la donnent à l'issue, qui arrive plus tard :
 * si la zone en montre une autre alors, l'utilisateur est allé ailleurs entre l'appui et l'issue, la demande ne vaut plus, et rien n'est fait (le titre d'une page qui existe déjà
 * n'est pas pris non plus). Sans elle, la page est celle que la zone montre à l'appel, la demande étant faite à l'instant.
 */
export function focusTitleWhenReady(zone: HTMLElement, page: string | null = locationOf(zone)): () => void {
  if (locationOf(zone) !== page) return () => undefined;
  const take = () => {
    if (document.activeElement === zone) focusContainer(titleOf(zone));
  };
  if (!showsSkeletonTitle(zone)) {
    take();
    return () => undefined;
  }
  const watch = new MutationObserver(() => {
    if (document.activeElement !== zone || locationOf(zone) !== page) {
      watch.disconnect();
      return;
    }
    if (showsSkeletonTitle(zone)) return;
    watch.disconnect();
    take();
  });
  watch.observe(zone, { childList: true, subtree: true });
  return () => watch.disconnect();
}

/**
 * Fabrique une ref à poser sur ce qui peut disparaître en tenant le focus (l'avis d'erreur et son bouton, un bandeau) : au retrait, le nœud
 * donne le focus à `give(node)`, quand il l'a en lui, et seulement alors. Le focus qu'un utilisateur a mis ailleurs (un lien de la barre
 * latérale, un clic dans le vide) n'est pas dans le nœud : on n'y touche pas.
 *
 * Ni `blur` ni un effet ne le disent à temps : Chromium envoie `blur` au retrait, l'élément encore dans le document, ce qu'un clic dans le vide
 * fait aussi ; un effet de mise en page vient après le retrait. En revanche React détache les références avant de retirer le nœud du document,
 * quand le focus y est encore : un nettoyage de ref dit « ce qui part avait le focus », exactement et sans heuristique, quelle que soit la cause
 * du retrait (un réessai, la page relue au retour sur l'onglet, le direct).
 *
 * Chaque ref doit être la même fonction d'un rendu à l'autre (une constante de module) : React rejouerait le nettoyage à chaque rendu, et le focus
 * serait pris à chacun. Et elle se pose sur un nœud que React *retire* (un composant ou une `key` autre que ce qui le remplace), pas sur un nœud qu'il
 * *met à jour* : d'un nœud mis à jour, il détache la ref après avoir retiré ses enfants, et le focus est déjà tombé sur le corps de la page.
 */
export function keepFocusIn(give: (from: Element) => boolean): (node: HTMLElement | null) => (() => void) | undefined {
  return (node) => {
    if (node === null) return undefined;
    return () => {
      if (node.contains(document.activeElement)) give(node);
    };
  };
}

/**
 * Fabrique une ref à poser sur l'enveloppe d'un état stable : un nœud qui *reste* (le corps d'un panneau qui garde sa fiche, une chronologie qui garde ses
 * Transitions) tandis que son contenu change. Elle fait ce que fait `keepFocusIn` quand l'enveloppe part avec l'état, et elle fait la même chose quand c'est
 * un élément du contenu qui part, l'enveloppe restant : un commit en direct retire le parent, une relation, un Blocage ou un lien du texte pendant qu'un lien a le
 * focus. Sans elle, ce focus tombait sur le corps de la page (hors du panneau, et sur mobile hors de la boîte de dialogue modale), parce que React ne détache la ref
 * que de ce qu'il retire : celle de l'enveloppe, qui reste, ne dit rien.
 *
 * Aucune ref ne dit ici « ce qui part avait le focus », et ce qu'on peut observer à la place est moins sûr que le nettoyage d'une ref : un effet vient après le retrait, et ce que le navigateur dit
 * du retrait varie selon le moteur. Mesuré le 2026-11-05 sur Chromium 156, Firefox 137 et WebKit 18.2 (le moteur de Safari 18.2), sur une page minimale dont on retire, déplace ou cache l'élément qui a le focus :
 * - le retirer : Chromium envoie `blur` puis `focusout`, l'élément encore dans le document ; Firefox et WebKit n'envoient rien ;
 * - le déplacer (retiré puis réinséré) : Chromium envoie les deux événements, Firefox et WebKit rien, et l'élément reste dans le document sans le focus ;
 * - lui retirer son `tabindex`, le cacher (`hidden`, `visibility: hidden`) ou le rendre `inert` : les trois moteurs envoient `blur` et `focusout`, aussitôt ou au rendu suivant.
 * Les moteurs évoluent : cela peut changer, et rien ici n'en dépend, avec ou sans ces événements c'est l'observateur qui reconnaît le retrait.
 *
 * Le nœud retient donc l'élément qui a le focus (`focusin`), et un observateur de mutations, qui s'exécute juste après le retrait et avant tout affichage, constate que cet élément n'est plus dans le
 * document. Alors, et seulement si le focus n'est nulle part (`focusIsAdrift` : rien n'a pris sa place), la zone le prend. Le focus qu'un utilisateur a mis ailleurs, dans le panneau comme hors de lui, n'est
 * jamais repris, ni celui qu'il a laissé sur le corps de la page (un clic dans le vide) : ce qui est retenu est l'élément qui a le focus *maintenant*.
 *
 * L'élément retenu s'oublie dès que rien ne dit plus qu'il a le focus :
 * - au `focusout`, vérifié au tour suivant (une micro-tâche) et non pendant l'événement : Chromium envoie `focusout` au retrait comme à un clic dans le vide, et seul ce qui suit les distingue (l'élément
 *   a quitté le document dans le premier cas, il y est resté dans le second) ;
 * - quand un changement du contenu le trouve dans le document sans qu'il soit l'élément actif : il a perdu le focus sans `focusout` (déplacé, sous Firefox et WebKit). Sans cela, son retrait, plus tard,
 *   prendrait au corps de la page un focus que l'élément n'avait plus.
 * Quand la fenêtre passe au second plan, en revanche, le navigateur envoie `focusout` à l'élément qui reste l'élément actif du document : il n'est pas oublié, le commit que l'utilisateur ne voit pas peut
 * le retirer. (Ce cas n'a pas été mesuré dans un vrai navigateur : un navigateur sans tête ne peut pas défocaliser sa fenêtre. Il tient aux tests.)
 *
 * Ne vaut que pour un élément *retiré* du document : un élément déplacé (retiré puis réinséré) ne l'est pas, et ce qu'il devient est celui du navigateur.
 *
 * `give` reçoit le nœud et, quand c'est un élément du contenu qui part, cet élément (`gone`) : retiré du document, mais le sous-arbre qui est parti avec lui tient (`closest`). C'est de quoi
 * rendre le focus à son équivalent, quand l'élément n'est pas supprimé mais remonté ailleurs (voir `watchContent`).
 */
export function keepFocusInContent(give: (from: Element, gone?: Element) => boolean): (node: HTMLElement | null) => (() => void) | undefined {
  const leaving = keepFocusIn(give);
  return (node) => {
    if (node === null) return undefined;
    const stopWatching = watchContent(node, give);
    const nodeLeaves = leaving(node);
    return () => {
      // Le focus est rendu avant que l'observateur ne s'arrête, pour que ce qui part avec le nœud ne soit pas rendu deux fois.
      nodeLeaves?.();
      stopWatching();
    };
  };
}

/** `element` est resté dans le document et n'a plus le focus : un autre élément (le corps de la page) est l'élément actif. */
const lostFocus = (element: Element) => element.isConnected && document.activeElement !== element;

/**
 * L'observation de `keepFocusInContent` : l'élément de `node` qui a le focus (`held`), et le focus rendu quand il quitte le document. Renvoie de quoi s'arrêter.
 * `held` ne vaut que tant que rien ne le contredit (les causes d'oubli sont dans la doc de `keepFocusInContent`) : un élément retenu qui n'a plus le focus ferait reprendre, à son retrait, un focus qu'il n'a pas laissé.
 *
 * Exportée pour qui veille un contenu sans qu'il soit l'enveloppe d'un état (le tableau du kanban : une carte que le commit change de colonne est remontée dans une autre, voir `kanban/boardFocus.ts`).
 * Seul un élément du contenu qui part rend le focus, en le demandant à `give(node, gone)`. Quand c'est le nœud lui-même qui part (une autre page), la fonction rendue arrête la veille sans rien rendre :
 * rendre le focus que le nœud tient en partant est ce que `keepFocusInContent` ajoute pour une enveloppe d'état.
 */
export function watchContent(node: HTMLElement, give: (from: Element, gone?: Element) => boolean): () => void {
  let held: Element | null = null;
  const remember = (event: FocusEvent) => {
    held = event.target instanceof Element ? event.target : null;
  };
  const maybeForget = (event: FocusEvent) => {
    const left = event.target;
    queueMicrotask(() => {
      if (held === left && left instanceof Element && lostFocus(left)) held = null;
    });
  };
  const observer = new MutationObserver(() => {
    const gone = held;
    if (gone === null) return;
    if (gone.isConnected) {
      if (lostFocus(gone)) held = null; // resté dans le document sans le focus : perdu sans `focusout`
      return;
    }
    held = null;
    if (focusIsAdrift()) give(node, gone);
  });
  node.addEventListener('focusin', remember);
  node.addEventListener('focusout', maybeForget);
  observer.observe(node, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    node.removeEventListener('focusin', remember);
    node.removeEventListener('focusout', maybeForget);
    held = null;
  };
}

/** Pour l'avis d'erreur : ce qui part rend le focus à la zone qui se recharge. */
export const keepFocusInZone = keepFocusIn(focusZoneOf);
