import { type RefCallback, useCallback, useLayoutEffect, useRef, useState } from 'react';

/** Ce que le navigateur a mesuré en dernier de ce que le crochet observe, et ce que cela montrait (le Projet, ou la Vue globale). */
interface Measure {
  scope: string;
  height: number;
}

/**
 * Ce qu'il faut pour que le squelette qui remplace un temps un bloc, puis le bloc qui revient, gardent la place de qui lisait plus bas (bdesk-38k.81). Le bloc est celui où `ref` est posée, ici les
 * chiffres des métriques ; `holding` dit que ce qui le remplace est à l'écran.
 *
 * - `height` : la hauteur du bloc, que le squelette garde le temps de l'attente. Tant que le bloc est à l'écran, le navigateur dit chaque fois qu'il change de hauteur (`ResizeObserver`), et le crochet
 *   retient la dernière ; il la rend dès le rendu qui le remplace. Elle ne se lit pas à son départ : le rendu du squelette la demande avant que le bloc soit démonté, et un second rendu pour la poser
 *   laisserait la page rétrécir le temps d'une mise en page, assez pour que le navigateur ramène le défilement. Elle ne vaut que pour la même attente : celle d'un autre périmètre (`scope`, le Projet ou
 *   la Vue globale) ne dit rien du squelette de celui-ci, et elle s'oublie dès que l'attente cesse (les chiffres reviennent, ou une erreur les remplace) : l'attente suivante ne reprend que ce qui a été
 *   mesuré depuis. Sans mesure (l'ouverture de la page, une hauteur nulle), il n'y a rien à garder.
 * - `settling` : le bloc vient de remplacer l'attente et le navigateur ne l'a pas encore mesuré. Sa première mise en page n'est pas la dernière (un graphique tient sa place par un fond de chargement,
 *   dont la hauteur n'est pas celle du dessin qui le remplace dans la foulée) : l'ancrage du défilement de Chromium suivrait ce premier état, et déplacerait de la différence qui lisait plus bas. Le
 *   bloc s'exclut de l'ancrage (`overflow-anchor`) jusqu'à sa première mesure, après laquelle l'ancrage lui est rendu.
 */
export function useKeptPlace<T extends HTMLElement>(holding: boolean, scope: string) {
  const measure = useRef<Measure | undefined>(undefined);
  const [settling, setSettling] = useState(false);
  const [wasHolding, setWasHolding] = useState(holding);

  // L'attente finit : les chiffres arrivent et se règlent. Elle commence : plus rien à régler. Ajusté pendant le rendu, comme React le conseille pour un état qui suit une propriété : le premier rendu
  // des chiffres porte déjà l'exclusion, il n'y a pas de rendu où le navigateur verrait leur première mise en page sans elle.
  if (wasHolding !== holding) {
    setWasHolding(holding);
    setSettling(wasHolding && !holding);
  }

  const ref = useCallback<RefCallback<T>>(
    (node) => {
      if (node === null) return undefined;
      const observer = new ResizeObserver((entries) => {
        const entry = entries.at(-1);
        if (entry !== undefined) measure.current = { scope, height: entry.contentRect.height };
        setSettling(false);
      });
      observer.observe(node);
      return () => observer.disconnect();
    },
    [scope],
  );

  // L'attente finie, ce qui a été mesuré ne vaut plus : un effet de mise en page, dont le nettoyage passe avant tout affichage et avant le `ResizeObserver` des chiffres qui reviennent (un effet
  // différé pourrait effacer la mesure de ces chiffres, arrivée entre-temps).
  useLayoutEffect(() => {
    if (!holding) return undefined;
    return () => {
      measure.current = undefined;
    };
  }, [holding]);

  const height = holding && measure.current?.scope === scope ? measure.current.height : 0;
  return { ref, height: height > 0 ? height : undefined, settling };
}
