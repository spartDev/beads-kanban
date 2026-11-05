/**
 * Une fonction dont on garde les résultats, mais pas tous : au plus `max`, et au-delà celui qu'on a le moins récemment demandé est jeté (et refait si on
 * le redemande). Les formateurs `Intl` du domaine, un par fuseau, vivaient dans une `Map` que rien ne vidait : le fuseau d'une requête vient du client, et une
 * `Map` qu'il peut remplir à volonté est une fuite. Ici la place est comptée une fois pour toutes ; qui demande peu de clés (un fuseau, deux) n'en voit
 * jamais l'effet.
 */
export function lruMemo<K, V>(max: number, make: (key: K) => V): (key: K) => V {
  if (!Number.isInteger(max) || max < 1) throw new RangeError(`Un cache garde au moins une valeur : taille ${max}.`);
  // Une `Map` se parcourt dans l'ordre où on y a mis ses clés : la première est la moins récemment demandée (on remet une clé demandée à la fin).
  const kept = new Map<K, V>();
  return (key) => {
    if (kept.has(key)) {
      const value = kept.get(key) as V;
      kept.delete(key);
      kept.set(key, value);
      return value;
    }
    const value = make(key);
    kept.set(key, value);
    if (kept.size > max) kept.delete(kept.keys().next().value as K);
    return value;
  };
}
