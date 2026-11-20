/**
 * La disposition du tableau selon son nombre de colonnes : cinq pour tout Projet, jusqu'à huit avec les colonnes des Statuts de relais (`boardColumns`).
 *
 * Toutes côte à côte dès que le panneau (le conteneur `@container` de `Board`) donne à chacune la largeur qu'elle a à cinq, au seuil de 60 rem : 12 rem
 * par colonne, écart compris (`WIDE_REM_PER_COLUMN`). Le seuil croît donc avec le nombre de colonnes (60, 72, 84 ou 96 rem) : une colonne n'est
 * jamais plus étroite qu'à cinq (à moins d'un pixel près, la part d'un écart de plus), où l'identifiant d'une carte tient sur sa ligne et le titre de la
 * colonne se lit. En deçà, une colonne à la fois,
 * avec le sélecteur de colonne, comme sur mobile. Tailwind ne lit que des classes écrites en entier : chaque seuil a les siennes, ici, et nulle part
 * ailleurs (`Board`, `Column`, `ColumnSelector`).
 *
 * Le sélecteur de cinq boutons est celui d'avant, une grille de cinq. Au-delà, ses boutons gardent leur nom sur une ligne et la rangée défile en
 * elle-même quand elle ne tient pas (à 375 px, la page, elle, ne défile jamais de côté) ; elle s'étire sur toute la largeur quand elle tient.
 */
export interface BoardLayout {
  /** Le conteneur des colonnes : une piste de grille par colonne, toutes côte à côte. */
  grid: string;
  /** Une colonne : affichée côte à côte avec les autres, même quand ce n'est pas celle du sélecteur. */
  column: string;
  /** L'en-tête d'une colonne : collant sous la barre du haut, quand les colonnes sont côte à côte. */
  header: string;
  /** La liste des cartes d'une colonne : plusieurs cartes par ligne quand une seule colonne prend toute la largeur. */
  cards: string;
  /** Le sélecteur de colonne : masqué quand les colonnes sont côte à côte. */
  selector: string;
  /** Le groupe de boutons du sélecteur. */
  selectorGroup: string;
  /** Un bouton du sélecteur. */
  selectorButton: string;
  /** Le nom d'une colonne dans son bouton. */
  selectorLabel: string;
  /** La rangée de boutons défile-t-elle en elle-même quand elle ne tient pas ? */
  scrolls: boolean;
}

/** La largeur d'une colonne côte à côte, écart compris, au seuil où le tableau les montre toutes : celle des cinq colonnes à 60 rem. */
export const WIDE_REM_PER_COLUMN = 12;

/** La rangée qui défile du sélecteur de plus de cinq colonnes : chaque bouton a la largeur de son nom, et la rangée s'étire quand elle tient. */
const SCROLLING_SELECTOR = {
  selectorGroup: 'relative flex gap-0.5 overflow-x-auto rounded-lg border border-line bg-well p-0.5',
  selectorButton: 'flex shrink-0 grow basis-auto flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1.5 text-micro font-medium transition-colors',
  selectorLabel: 'whitespace-nowrap',
  scrolls: true,
} as const;

const LAYOUTS: Readonly<Record<5 | 6 | 7 | 8, BoardLayout>> = {
  // Les classes d'avant les Statuts de relais, inchangées : un Projet qui n'en a pas garde son tableau.
  5: {
    grid: '@min-[60rem]:grid @min-[60rem]:grid-cols-5',
    column: '@min-[60rem]:flex',
    header: '@min-[60rem]:sticky @min-[60rem]:top-11',
    cards: '@min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-1',
    selector: '@min-[60rem]:hidden',
    selectorGroup: 'grid grid-cols-5 gap-0.5 rounded-lg border border-line bg-well p-0.5',
    selectorButton: 'flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-md px-0.5 py-1.5 text-micro font-medium transition-colors',
    selectorLabel: 'text-center wrap-anywhere',
    scrolls: false,
  },
  // Au-delà, une colonne seule passe à trois cartes par ligne dès 60 rem, jusqu'au seuil où toutes les colonnes tiennent côte à côte.
  6: {
    grid: '@min-[72rem]:grid @min-[72rem]:grid-cols-6',
    column: '@min-[72rem]:flex',
    header: '@min-[72rem]:sticky @min-[72rem]:top-11',
    cards: '@min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-3 @min-[72rem]:grid-cols-1',
    selector: '@min-[72rem]:hidden',
    ...SCROLLING_SELECTOR,
  },
  7: {
    grid: '@min-[84rem]:grid @min-[84rem]:grid-cols-7',
    column: '@min-[84rem]:flex',
    header: '@min-[84rem]:sticky @min-[84rem]:top-11',
    cards: '@min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-3 @min-[84rem]:grid-cols-1',
    selector: '@min-[84rem]:hidden',
    ...SCROLLING_SELECTOR,
  },
  8: {
    grid: '@min-[96rem]:grid @min-[96rem]:grid-cols-8',
    column: '@min-[96rem]:flex',
    header: '@min-[96rem]:sticky @min-[96rem]:top-11',
    cards: '@min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-3 @min-[96rem]:grid-cols-1',
    selector: '@min-[96rem]:hidden',
    ...SCROLLING_SELECTOR,
  },
};

/** La disposition d'un tableau de `count` colonnes : de cinq (tout Projet) à huit (les trois Statuts de relais). */
export function boardLayout(count: number): BoardLayout {
  const clamped = Math.min(8, Math.max(5, Math.round(count))) as 5 | 6 | 7 | 8;
  return LAYOUTS[clamped];
}
