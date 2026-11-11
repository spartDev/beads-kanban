import { isInvisibleText } from '../lib/invisibleText';
import type { NamedProjectsResponse, ProjectsResponse, Written } from './types';

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

/**
 * Les Projets, sous leur nom écrit (identifiant et nom suffisent : ceux de la réponse des métriques). Celui dont le nom a été remplacé porte `unnamed` : « Sans titre » est alors un repli et non un nom
 * (bdesk-38k.73), ce que ni la pastille, ni une phrase, ni la couleur du Projet ne doivent confondre avec le nom d'un dossier qui s'appellerait ainsi. Les autres sont les mêmes objets, sans `unnamed`.
 */
export function withProjectNames<T extends { name: string }>(projects: T[]): Written<T>[] {
  // `unnamed` est facultatif : un `T` qui n'en porte pas est déjà un `Written<T>`, ce que TypeScript ne peut pas voir d'un `T` générique.
  return renamed(
    projects as Written<T>[],
    (project) => project.name,
    (project, name) => ({ ...project, name, unnamed: true }),
  );
}

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
export function namedProjects(response: ProjectsResponse): NamedProjectsResponse {
  const projects = withProjectNames(response.projects);
  return projects === response.projects ? (response as NamedProjectsResponse) : { ...response, projects };
}

/** Ce que dit une phrase d'un Projet dont le nom est un repli : « ce Projet », comme le kanban (« Aucune Epic « x » dans ce Projet »). */
const THIS_PROJECT = 'ce Projet';

/** Un nom entre guillemets : ce qui est entre guillemets est un nom, quoi qu'il dise. */
const quoted = (name: string): string => `« ${name} »`;

/**
 * Le Projet tel qu'une phrase le nomme après « de » ou « dans » (bdesk-38k.73) : son nom, ou « ce Projet » quand le nom est un repli. « Les tickets de Sans titre » se lit comme les tickets d'un Projet
 * qui s'appellerait ainsi ; « Les tickets de ce Projet » dit ce qu'il en est. Un nom qui se voit est écrit tel quel, jusqu'à ses blancs et à sa ponctuation, et un dossier qui s'appelle vraiment « Sans titre »
 * aussi (il n'est pas marqué `unnamed`). Le nom d'un Projet ne s'écrit dans une phrase que par cette fonction ou par `projectList` (ou, pour une ligne de liste qui a sa raison, par `projectLabel`) : `data/projectSentences.test.ts` (qui lit le code) et `data/projectSentences.rendered.test.tsx` (qui lit ce que l'application écrit) le gardent.
 */
export const projectInSentence = (project: { name: string; unnamed?: true }): string => (project.unnamed ? THIS_PROJECT : project.name);

/**
 * Des Projets dans une phrase, après deux-points (« Tickets indisponibles : beads-desktop, My-Prompt-Manager. ») : leurs noms, séparés par une virgule et dans l'ordre, comme toujours. Ceux dont le nom est un repli
 * sont dits ensemble, après les autres : « un Projet sans nom », « 3 Projets sans nom ». « Sans titre, Sans titre » ne dirait pas combien, et se lirait comme deux Projets qui portent ce nom. Et dès que la liste en
 * compte, les noms qui se voient sont entre guillemets : « Sans titre, 3 Projets sans titre » se lisait comme quatre Projets sans titre quand l'un d'eux est un dossier qui s'appelle vraiment ainsi (bdesk-38k.73,
 * relecture). Le groupe est ce qui n'a pas de nom, jamais un nom, quel que soit le nom d'un dossier : même un dossier qui s'appelle « 3 Projets sans nom » y est entre guillemets, et se lit comme un dossier.
 */
export function projectList(projects: readonly { name: string; unnamed?: true }[]): string {
  const unnamed = projects.filter((project) => project.unnamed).length;
  if (unnamed === 0) return projects.map((project) => project.name).join(', ');
  const names = projects.flatMap((project) => (project.unnamed ? [] : [quoted(project.name)]));
  return [...names, unnamed === 1 ? 'un Projet sans nom' : `${unnamed} Projets sans nom`].join(', ');
}

/**
 * Un Projet nommé comme `projectList` nomme ceux qu'il écrit d'un trait, pour une liste où chacun a sa ligne (l'avis « Projets illisibles » des métriques : une ligne par Projet, avec sa raison, sans pastille à côté) :
 * son nom tel quel tant qu'aucun Projet de la liste n'est sans nom ; sinon son nom entre guillemets, et « Un Projet sans nom » pour celui dont le nom est un repli (bdesk-38k.73, relecture finale). « Sans titre : verrou »
 * deux fois ne dit pas laquelle est le dossier qui s'appelle vraiment ainsi, et ce qui est entre guillemets est un nom, quel que soit le nom d'un dossier : même « Un Projet sans nom » y est un dossier.
 */
export function projectLabel(project: { name: string; unnamed?: true }, among: readonly { unnamed?: true }[]): string {
  if (!among.some((other) => other.unnamed)) return project.name;
  return project.unnamed ? 'Un Projet sans nom' : quoted(project.name);
}
