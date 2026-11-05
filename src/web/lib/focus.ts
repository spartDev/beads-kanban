/**
 * Le focus n'est nulle part : sur le corps de la page (ce que le navigateur lui donne quand l'élément qui l'avait est retiré du
 * document) ou sur rien. Un autre élément, resté dans le document, l'a : on n'y touche pas.
 */
export function focusIsAdrift(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || active === document.documentElement || !active.isConnected;
}

let returning = false;

/**
 * Vrai le temps que `focusElement` donne le focus. Ce focus est rendu par programme, à l'élément qui l'avait avant une boîte de dialogue :
 * ce n'est pas un geste de l'utilisateur, et ce qui s'ouvre au focus peut s'en abstenir. L'infobulle d'un bouton (`Tip`) s'ouvrirait, et
 * sa couche Radix prendrait le prochain Échap, qui ne fermerait plus le panneau d'un ticket dessous.
 */
export function isFocusReturning(): boolean {
  return returning;
}

/**
 * Donne le focus à `element`, sans faire défiler la page, et dit s'il l'a pris. Il ne le prend pas quand il a été retiré du document,
 * ou qu'il est désactivé, caché ou inerte : le focus reste où il était. Jamais le corps de la page, qui ne vaut pas un focus.
 */
export function focusElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement) || element === document.body || element === document.documentElement) return false;
  if (!element.isConnected) return false;
  returning = true;
  try {
    element.focus({ preventScroll: true });
  } finally {
    returning = false;
  }
  return document.activeElement === element;
}

/**
 * Même chose pour un conteneur que le navigateur ne fait pas focalisable (le contenu principal). `tabindex="-1"` le permet par programme,
 * et il n'est posé que le temps que le conteneur a le focus : de façon permanente, un clic dans le vide lui donnerait le focus, au
 * lieu de le laisser au corps de la page comme partout ailleurs, et ce qui regarde où est le focus (le panneau d'un ticket qui le
 * rend à la carte quand il se ferme) le prendrait pour un choix de l'utilisateur.
 */
export function focusContainer(container: Element | null): boolean {
  if (!(container instanceof HTMLElement)) return false;
  const temporary = !container.hasAttribute('tabindex');
  if (temporary) container.setAttribute('tabindex', '-1');
  const focused = focusElement(container);
  if (temporary) {
    if (focused) container.addEventListener('blur', () => container.removeAttribute('tabindex'), { once: true });
    else container.removeAttribute('tabindex');
  }
  return focused;
}

/**
 * Veille un élément qui vient de recevoir le focus par programme : s'il quitte le document dans les `ms` qui suivent et que le focus n'est
 * alors nulle part, appelle `fallback`. Le focus rendu à l'élément d'origine d'une boîte de dialogue peut précéder de peu la page qu'un choix
 * de la palette ouvre, surtout sur un appareil lent : l'élément existe encore à ce moment-là, la page le retire ensuite, et le focus
 * tomberait sur le corps de la page. Si le focus est déjà ailleurs à ce moment-là (l'utilisateur ou la nouvelle page l'a pris), on n'y touche pas.
 *
 * La veille ne vaut que pour ce retrait-là, celui que la fermeture a mis en route : dès que l'utilisateur agit (une touche, un clic ou un
 * toucher), ce qui retire l'élément est une navigation qu'il demande, sans rapport avec la boîte fermée, et la veille s'arrête. Le choix
 * qui ouvre la page, lui, précède la fin de l'animation de sortie : il n'arrête rien. Une navigation que l'utilisateur ne demande pas dans
 * la page (le bouton « Retour » du navigateur) reste sous la veille, jusqu'à la fin des `ms` : le contenu principal vaut mieux que le corps.
 */
export function watchRemoval(element: Element, fallback: () => void, ms = 2000): void {
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
    document.removeEventListener('keydown', stop, true);
    document.removeEventListener('pointerdown', stop, true);
  };
  const observer = new MutationObserver(() => {
    if (element.isConnected) return;
    stop();
    if (focusIsAdrift()) fallback();
  });
  const timer = setTimeout(stop, ms);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('keydown', stop, true);
  document.addEventListener('pointerdown', stop, true);
}
