import { useEffect, useState } from 'react';

/**
 * L'heure courante, remise à jour toutes les `intervalMs` : un tableau laissé ouvert voit un ticket fermé sortir de
 * Terminé, et les âges des cartes avancer, sans attendre de nouvelles données.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
