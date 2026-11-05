import { focusContainer } from './focus';

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

/** Donne le focus à la zone qui contient `from`. `tabindex="-1"` ne lui est posé que le temps qu'elle l'a (voir `focusContainer`). */
export function focusZoneOf(from: Element): boolean {
  return focusContainer(zoneOf(from));
}

/** Donne le focus au titre de la zone qui contient `from`, sinon à la zone : un titre à lire plutôt qu'un conteneur muet. */
export function focusTitleOf(from: Element): boolean {
  const zone = zoneOf(from);
  return (zone !== null && focusContainer(titleOf(zone))) || focusContainer(zone);
}

/**
 * Donne le focus au titre de la zone, s'il a le focus encore (l'utilisateur ne l'a pas mis ailleurs) et dès que ce titre existe : tant que la zone n'a que le
 * titre d'un squelette (la porte du Projet qui ouvre la page d'une Epic, dont les tickets se chargent encore), la zone le garde, et le titre de la page qui arrive
 * le prend. L'attente s'arrête dès que le focus quitte la zone, quand le titre est donné, ou par la fonction rendue.
 */
export function focusTitleWhenReady(zone: HTMLElement): () => void {
  const take = () => {
    if (document.activeElement === zone) focusContainer(titleOf(zone));
  };
  if (!showsSkeletonTitle(zone)) {
    take();
    return () => undefined;
  }
  const watch = new MutationObserver(() => {
    if (document.activeElement !== zone) {
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

/** Pour l'avis d'erreur : ce qui part rend le focus à la zone qui se recharge. */
export const keepFocusInZone = keepFocusIn(focusZoneOf);
