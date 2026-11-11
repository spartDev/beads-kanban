import { useEffect, useState } from 'react';

/**
 * Vrai quand `active` dure depuis `ms`, faux dès qu'il cesse (dans le même rendu : aucun où il vaudrait encore vrai). Une attente que l'on ne remarque pas n'a pas besoin d'être dite,
 * et ce qui s'allumerait avec elle clignoterait à chaque réponse rapide : ce que l'on commande par ce délai ne paraît que si l'attente dure. L'attente suivante repart de zéro.
 */
export function useDelayed(active: boolean, ms: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => {
      clearTimeout(timer);
      setElapsed(false);
    };
  }, [active, ms]);
  return active && elapsed;
}
