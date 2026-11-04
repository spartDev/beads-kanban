/**
 * Rend inertes (ni cliquables, ni atteignables au clavier, ni lus par les lecteurs d'écran) tous les éléments de la page
 * hors `element` et ses ancêtres : ce qui est « derrière » une couche qui prend tout l'écran. Les éléments posés
 * directement sur le corps de la page ne sont pas touchés : les boîtes de dialogue (palette, aide) s'y ouvrent, au-dessus.
 * Ce qui apparaît ensuite hors de l'élément (un bandeau, un message) devient inerte à son tour, tant que la page l'est.
 * Renvoie la fonction qui rend la page telle qu'elle était, y compris ce qui était déjà inerte.
 */
export function inertOutside(element: HTMLElement): () => void {
  const changed = new Set<Element>();
  const silence = (candidate: Element) => {
    // Ni un élément déjà inerte (il le restera, il n'est pas à nous), ni l'élément ou l'un de ses ancêtres : le panneau resterait muet.
    if (candidate.hasAttribute('inert') || candidate.contains(element)) return;
    candidate.setAttribute('inert', '');
    changed.add(candidate);
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) for (const added of record.addedNodes) if (added instanceof Element) silence(added);
  });
  for (let node: HTMLElement | null = element; node?.parentElement && node.parentElement !== document.body; node = node.parentElement) {
    for (const sibling of node.parentElement.children) if (sibling !== node) silence(sibling);
    observer.observe(node.parentElement, { childList: true });
  }

  return () => {
    observer.disconnect();
    for (const sibling of changed) sibling.removeAttribute('inert');
  };
}
