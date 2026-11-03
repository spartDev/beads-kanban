import { useLayoutEffect, useRef, useState } from 'react';

/**
 * La largeur d'un élément, suivie à chaque redimensionnement : un graphique SVG se dessine à la largeur de son cadre.
 * Mesurée avant le premier affichage (`useLayoutEffect`), pour que le graphique n'apparaisse pas d'abord à largeur nulle.
 */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(Math.floor(element.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
