/**
 * La disposition du tableau selon son nombre de colonnes : cinq pour tout Projet, jusqu'à huit avec les colonnes des Statuts de relais (`boardColumns`).
 * Les colonnes passent côte à côte dès que le panneau (le conteneur `@container` de `Board`) leur donne à chacune sa largeur, écart compris ; en deçà,
 * une colonne à la fois, avec le sélecteur de colonne, comme sur mobile. Tailwind ne lit que des classes écrites en entier : chaque seuil a les
 * siennes, ici, et nulle part ailleurs (`Board`, `Column`, `ColumnSelector`, `Card`).
 *
 * Cinq colonnes : la disposition d'avant les Statuts de relais, inchangée, 12 rem par colonne (`WIDE_REM_PER_COLUMN`), seuil de 60 rem.
 *
 * Six à huit colonnes : 9 rem par colonne, écart compris (`NARROW_REM_PER_COLUMN`), pour que les huit tiennent côte à côte sur un écran de 1 440 px.
 *   - Le panneau y fait 1 440 − 240 (barre latérale, `w-60`) − 2 × 20 (marges de la page large, `md:px-5`) = 1 160 px, soit 72,5 rem.
 *   - Seuils : 6 × 9 = 54 rem, 7 × 9 = 63 rem, 8 × 9 = 72 rem (1 152 px ≤ 1 160 px).
 *   - Au seuil, une colonne fait (N × 144 − (N − 1) × 8) / N = 136 + 8 / N px, écart de 8 px (`gap-2`) déduit : 137 px à huit, un peu plus à six
 *     ou sept, et 138 px à huit sur le panneau de 1 160 px. Une barre de défilement classique de plus de 8 px (Windows) repousse le seuil de huit
 *     colonnes juste au-delà de 1 440 px ; celles de macOS, superposées, ne prennent pas de place.
 *   - Côte à côte, l'en-tête d'une colonne se resserre (marges de 8 px, écarts de 6 px) et passe à la ligne : le libellé prend la place qui reste et
 *     se coupe entre deux mots, jamais dans un mot ; le compte passe dessous s'il ne tient pas à côté. La liste et les cartes se resserrent aussi
 *     (marges de 4 et de 8 px) : une carte garde 137 − 2 − 2 × 4 − 2 − 2 × 8 = 109 px pour son contenu. layout.test.ts le vérifie, mot par mot,
 *     avec la police de l'application (`test/fontMetrics.ts`) : libellés, comptes, pastilles, âges, en français et en anglais.
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
  /** La ligne de l'en-tête (pictogramme, libellé, compte) : elle passe à la ligne dans une colonne étroite. */
  headerRow: string;
  /** Le libellé de la colonne : il prend la place qui reste sur la ligne, et se coupe entre deux mots. */
  title: string;
  /** La liste des cartes d'une colonne : plusieurs cartes par ligne quand une seule colonne prend toute la largeur. */
  cards: string;
  /** Une carte d'une colonne (pas du tiroir « En pause ») : ses marges, resserrées dans une colonne étroite. */
  card: string;
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

/** La largeur d'une colonne côte à côte, écart compris, à cinq colonnes : 60 rem pour les cinq, le seuil d'avant les Statuts de relais. */
export const WIDE_REM_PER_COLUMN = 12;

/** La largeur d'une colonne côte à côte, écart compris, de six à huit colonnes : 72 rem pour les huit, qui tiennent dans le panneau à 1 440 px. */
export const NARROW_REM_PER_COLUMN = 9;

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
    headerRow: '',
    title: '',
    cards: '@min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-1',
    card: '',
    selector: '@min-[60rem]:hidden',
    selectorGroup: 'grid grid-cols-5 gap-0.5 rounded-lg border border-line bg-well p-0.5',
    selectorButton: 'flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-md px-0.5 py-1.5 text-micro font-medium transition-colors',
    selectorLabel: 'text-center wrap-anywhere',
    scrolls: false,
  },
  // Six colonnes tiennent côte à côte dès 54 rem, avant les 60 rem où une colonne seule passerait à trois cartes par ligne : jamais trois.
  6: {
    grid: '@min-[54rem]:grid @min-[54rem]:grid-cols-6',
    column: '@min-[54rem]:flex',
    header: '@min-[54rem]:sticky @min-[54rem]:top-11 @min-[54rem]:px-2',
    headerRow: '@min-[54rem]:flex-wrap @min-[54rem]:gap-x-1.5 @min-[54rem]:gap-y-0.5',
    title: '@min-[54rem]:basis-0 @min-[54rem]:grow',
    cards: '@min-[36rem]:grid-cols-2 @min-[54rem]:grid-cols-1 @min-[54rem]:px-1',
    card: '@min-[54rem]:px-2',
    selector: '@min-[54rem]:hidden',
    ...SCROLLING_SELECTOR,
  },
  // Sept et huit : une colonne seule passe à trois cartes par ligne dès 60 rem, jusqu'au seuil où toutes tiennent côte à côte.
  7: {
    grid: '@min-[63rem]:grid @min-[63rem]:grid-cols-7',
    column: '@min-[63rem]:flex',
    header: '@min-[63rem]:sticky @min-[63rem]:top-11 @min-[63rem]:px-2',
    headerRow: '@min-[63rem]:flex-wrap @min-[63rem]:gap-x-1.5 @min-[63rem]:gap-y-0.5',
    title: '@min-[63rem]:basis-0 @min-[63rem]:grow',
    cards: '@min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-3 @min-[63rem]:grid-cols-1 @min-[63rem]:px-1',
    card: '@min-[63rem]:px-2',
    selector: '@min-[63rem]:hidden',
    ...SCROLLING_SELECTOR,
  },
  8: {
    grid: '@min-[72rem]:grid @min-[72rem]:grid-cols-8',
    column: '@min-[72rem]:flex',
    header: '@min-[72rem]:sticky @min-[72rem]:top-11 @min-[72rem]:px-2',
    headerRow: '@min-[72rem]:flex-wrap @min-[72rem]:gap-x-1.5 @min-[72rem]:gap-y-0.5',
    title: '@min-[72rem]:basis-0 @min-[72rem]:grow',
    cards: '@min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-3 @min-[72rem]:grid-cols-1 @min-[72rem]:px-1',
    card: '@min-[72rem]:px-2',
    selector: '@min-[72rem]:hidden',
    ...SCROLLING_SELECTOR,
  },
};

/** La disposition d'un tableau de `count` colonnes : de cinq (tout Projet) à huit (les trois Statuts de relais). */
export function boardLayout(count: number): BoardLayout {
  const clamped = Math.min(8, Math.max(5, Math.round(count))) as 5 | 6 | 7 | 8;
  return LAYOUTS[clamped];
}
