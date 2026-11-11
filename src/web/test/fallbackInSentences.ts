/**
 * Où la page écrit le repli d'un Projet sans nom, « Sans titre », au milieu d'un autre texte (bdesk-38k.73, relecture) : l'outil de `data/projectSentences.rendered.test.tsx`. Le repli est un libellé, seul dans son
 * élément (une ligne de la barre latérale, le titre d'une page, une cellule) ; dans une phrase (« Les tickets de Sans titre, en colonnes ») il se lirait comme le nom d'un Projet.
 *
 * Ce qu'il lit, dans l'arbre qui est à l'écran : le texte propre de chaque élément (les nœuds de texte de l'élément, pas ceux de ses enfants, mis bout à bout : React écrit « Les tickets de {nom}, en colonnes. » en
 * trois nœuds, qui ne se lisent qu'ensemble), et les attributs qu'un lecteur d'écran ou une infobulle lit comme du texte (`title`, `aria-label`, `aria-description`, `placeholder`, `alt`). Et le titre de l'onglet,
 * dont les parties se séparent par « · » (« Kanban · Sans titre · beads-desktop »).
 *
 * Il ne regarde pas comment la phrase est écrite : `{x.name}` à côté de texte, un gabarit, une concaténation, un nom passé de composant en composant, tout rend le même texte. Il ne lit pas un nom écrit seul dans
 * son élément au milieu d'une phrase (`<p>Les tickets de <strong>Sans titre</strong>, en colonnes.</p>`, ou dans un lien : `<a>Sans titre</a>`, que rend un `<Link>` : le texte propre de l'élément est le repli seul) : celui-là, c'est le balayage
 * du code (`projectNameReads`) qui le lit, en écrivant qu'un composant rend un élément de la ligne ; un composant du fichier qui rend lui-même ce nom seul (`<Nom />`) n'est lu par aucun des deux.
 */
export const FALLBACK = 'Sans titre';

const TEXT_ATTRIBUTES = ['title', 'aria-label', 'aria-description', 'placeholder', 'alt'] as const;

const squashed = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Les textes de `root` où le repli est écrit parmi d'autres mots, un par endroit : le texte propre d'un élément, ou un attribut (`title="…"`). */
export function fallbackInSentences(root: ParentNode, fallback = FALLBACK): string[] {
  const found: string[] = [];
  const elements = [...(root instanceof Element ? [root] : []), ...root.querySelectorAll('*')];
  for (const element of elements) {
    const own = squashed(
      [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.nodeValue ?? '')
        .join(''),
    );
    if (own.includes(fallback) && own !== fallback) found.push(`<${element.tagName.toLowerCase()}> ${own}`);
    for (const attribute of TEXT_ATTRIBUTES) {
      const value = squashed(element.getAttribute(attribute) ?? '');
      if (value.includes(fallback) && value !== fallback) found.push(`${attribute}="${value}"`);
    }
  }
  return found;
}

/** Les parties du titre de l'onglet (« Kanban · Sans titre · beads-desktop ») où le repli est écrit parmi d'autres mots. */
export function fallbackInTitle(title: string, fallback = FALLBACK): string[] {
  return title
    .split(' · ')
    .map(squashed)
    .filter((part) => part.includes(fallback) && part !== fallback)
    .map((part) => `<title> ${part}`);
}
