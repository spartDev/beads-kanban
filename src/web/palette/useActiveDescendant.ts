import { useLayoutEffect, type RefObject } from 'react';

const ATTRIBUTE = 'aria-activedescendant';

/** La ligne que cmdk montre sélectionnée dans sa liste. */
const SELECTED_ROW = '[cmdk-list] [cmdk-item][aria-selected="true"]';

/** Ce qui porte l'attribut chez cmdk : le champ, qui garde le focus, et la liste. */
const OWNERS = '[cmdk-input], [cmdk-list]';

/**
 * Tient `aria-activedescendant` du champ et de la liste d'accord avec la ligne que la liste montre sélectionnée : l'id de cette ligne, et
 * rien quand aucune ne l'est. Sans lui, un lecteur d'écran annonce une ligne qui n'est plus là ou n'est pas celle en surbrillance, et axe
 * relève `aria-valid-attr-value` (critique) quand l'id ne désigne plus rien.
 *
 * cmdk 1.1.1 calcule l'attribut lui-même, mais trop tôt : quand il choisit une ligne d'office (à l'ouverture, à chaque frappe, quand des
 * lignes arrivent ou que la sélectionnée disparaît), il cherche la ligne sélectionnée dans le DOM pendant le vidage de sa file de tâches,
 * avant que React ait rendu la nouvelle sélection ; il retient l'id de la ligne d'avant, souvent retirée depuis. Et la palette pilote sa
 * valeur (voir `useQuietRow`) : il n'en recalcule alors rien, et l'attribut manque alors même qu'une ligne est sélectionnée.
 *
 * `aria-selected` de la ligne est la vérité : c'est ce que la liste montre. On en recopie l'id sur le champ et sur la liste à chaque
 * changement de la liste (lignes montées ou retirées, sélection déplacée), après les rendus de cmdk, qui réécrivent l'attribut dans le même
 * temps. Un `MutationObserver` ne sait rien de l'ordre de ces rendus, et vaut donc pour toutes ses façons de choisir. Il passe à la fin de la
 * tâche qui a changé le DOM, avant l'image suivante.
 *
 * `root` est l'élément racine de `Command`. Comme `useQuietRow`, cela lit le DOM de cmdk 1.1.1 (`cmdk-input`, `cmdk-list`, `cmdk-item`).
 */
export function useActiveDescendant(root: RefObject<HTMLElement | null>): void {
  // Branché dans le commit qui monte la liste, comme son `ref`. Un effet passif ne s'en distinguerait pas : les mutations observées viennent
  // des rendus suivants, et React vide les effets passifs avant tout rendu (celles du commit même précèdent les deux). Aucun test ne peut
  // donc fixer ce choix, à la différence de celui de `useSelectionGuard`, où la priorité du rendu de la correction change.
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    const observer = new MutationObserver(() => {
      const id = element.querySelector(SELECTED_ROW)?.id ?? '';
      for (const owner of element.querySelectorAll(OWNERS)) {
        if (id === '') owner.removeAttribute(ATTRIBUTE);
        else owner.setAttribute(ATTRIBUTE, id);
      }
    });
    observer.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected'] });
    return () => observer.disconnect();
  }, [root]);
}
