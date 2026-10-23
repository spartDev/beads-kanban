/**
 * localStorage peut lever (navigation privée, stockage bloqué, quota) :
 * toute lecture ou écriture passe par ici, et l'app reste fonctionnelle sans.
 */
export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Stockage indisponible : la valeur reste en mémoire pour la session.
  }
}
