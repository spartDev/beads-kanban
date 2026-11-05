import { isInvisibleText } from '../lib/invisibleText';
import type { ProjectsResponse } from './types';

/**
 * Ce que l'interface écrit à la place du nom d'un Projet dont le dossier n'a pas de nom qu'on voie : le même mot que pour un ticket sans titre (`ticketTitle`) et une page sans titre (`Page`), si bien
 * que le fil d'Ariane, la barre latérale, l'onglet et le `<h1>` d'un Projet disent la même chose.
 */
const UNNAMED_PROJECT = 'Sans titre';

/**
 * Le nom d'un Projet tel que l'interface l'écrit : celui de son dossier (le serveur le tire du `basename`, qui peut être vide, fait d'espaces ou de caractères sans largeur, d'un remplisseur hangul ou
 * d'un blanc braille : `isInvisibleText`), ou « Sans titre » quand on n'en verrait rien. Tout autre nom est écrit tel quel, jusqu'à ses blancs et à sa ponctuation : « - » et « : » se voient.
 */
const writtenName = (name: string): string => (isInvisibleText(name) ? UNNAMED_PROJECT : name);

/**
 * Les éléments de `items`, chacun sous le nom de Projet que `read` y lit, écrit (`writtenName`) ; `write` rend l'élément sous son nouveau nom. L'élément reste le même objet quand son nom est déjà celui-là,
 * et la liste la même liste quand aucun ne change : les données gardent leur identité, rien ne se redessine pour rien.
 */
function renamed<T>(items: T[], read: (item: T) => string, write: (item: T, name: string) => T): T[] {
  const named = items.map((item) => {
    const name = writtenName(read(item));
    return name === read(item) ? item : write(item, name);
  });
  return named.some((item, index) => item !== items[index]) ? named : items;
}

/** Les Projets, sous leur nom écrit (identifiant et nom suffisent : ceux de la réponse des métriques). */
export const withProjectNames = <T extends { name: string }>(projects: T[]): T[] =>
  renamed(
    projects,
    (project) => project.name,
    (project, name) => ({ ...project, name }),
  );

/**
 * Les lignes du découpage par Projet des métriques, sous le nom écrit de leur Projet. Le serveur écrit le nom du dossier une deuxième fois dans le libellé de chaque ligne (`slicesOf`,
 * `domain/metrics.ts`), à côté de celui de `projects`, et le tableau des métriques par Projet en fait le texte du lien de la ligne : un libellé laissé tel quel faisait de ce lien un lien sans nom.
 */
export const withProjectLabels = <T extends { label: string }>(slices: T[]): T[] =>
  renamed(
    slices,
    (slice) => slice.label,
    (slice, label) => ({ ...slice, label }),
  );

/**
 * La réponse de `GET /api/projects`, ses Projets sous leur nom écrit : c'est le `select` de `useProjects`. Les noms sont donnés une fois, à l'entrée des données, et non à chaque endroit qui les écrit
 * (une vingtaine : fil d'Ariane, barre latérale, palette, titres de page, onglet) : `Project.name` y est le nom que l'interface écrit, qui n'est celui du dossier que quand on le voit.
 */
export function namedProjects(response: ProjectsResponse): ProjectsResponse {
  const projects = withProjectNames(response.projects);
  return projects === response.projects ? response : { ...response, projects };
}
