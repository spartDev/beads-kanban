/**
 * La disposition du tableau selon son nombre de colonnes : cinq pour tout Projet, jusqu'à huit avec les colonnes des Statuts de relais (`boardColumns`).
 * Les colonnes passent côte à côte dès que le panneau (le conteneur `@container/board` de `Board`) leur donne à chacune sa largeur, écart compris ; en
 * deçà, une colonne à la fois, avec le sélecteur de colonne, comme sur mobile. Tailwind ne lit que des classes écrites en entier : chaque seuil a les
 * siennes, ici, et nulle part ailleurs (`Board`, `Column`, `ColumnSelector`, `Card`).
 *
 * Un rem vaut 18 px : la racine est à 112,5 % (styles.css). Une requête de conteneur compte en rem de la racine (une requête de média, elle, en
 * compte 16) : les seuils ci-dessous se lisent à 18 px le rem.
 *
 * Cinq colonnes : la disposition d'avant les Statuts de relais, inchangée, 12 rem par colonne (`WIDE_REM_PER_COLUMN`), seuil de 60 rem.
 *
 * Six à huit colonnes : 7,7 rem par colonne, écart compris (`NARROW_REM_PER_COLUMN`), pour que les huit tiennent côte à côte sur un écran de 1 440 px.
 *   - Le panneau y fait la fenêtre moins 17,5 rem : la barre latérale (`w-60`, 15 rem) et les marges de la page large (`md:px-5`, 2 × 1,25 rem),
 *     soit 1 440 − 315 = 1 125 px.
 *   - Seuils : 6 × 7,7 = 46,2 rem, 7 × 7,7 = 53,9 rem, 8 × 7,7 = 61,6 rem, soit 1 108,8 px à huit : 16,2 px de marge pour une barre de défilement
 *     classique (fine : 8 à 11 px ; ordinaire : 15 px).
 *   - Au seuil, une colonne fait (N × 7,7 rem − (N − 1) × 9 px) / N, l'écart de 9 px (`gap-2`) déduit : 130,7 px à huit, un peu plus à six ou sept ;
 *     132,75 px à huit sur le panneau de 1 125 px.
 *   - Côte à côte, l'en-tête se lit comme une phrase (`inlineHeader`) : pictogramme, libellé et compte se suivent et passent à la ligne entre deux
 *     mots, jamais dans un mot ; marges de 6,75 px (`px-1.5`), soit 130,7 − 2 − 13,5 = 115,2 px de ligne. Les en-têtes ont tous la hauteur du plus
 *     haut, et les premières cartes s'alignent d'une colonne à l'autre : chaque colonne est une sous-grille de deux rangées de la grille du tableau
 *     (`grid-rows-subgrid`) : l'en-tête, puis le bloc qui réunit la liste et la note de Terminé (`body`).
 *   - Ce bloc est un conteneur (`@container/column`), de la largeur du contenu de la colonne, et la carte ne s'allège que si elle est vraiment
 *     étroite : moins de 9,5 rem (`NARROW_COLUMN_REM`, 171 px), là où la carte d'avant ne tient plus (layout.test.ts le mesure). Une colonne de
 *     367 px (six colonnes à 2 560 px) garde la carte d'avant. Le conteneur ne peut pas être la colonne elle-même : un conteneur a un confinement
 *     de mise en page, et un élément confiné n'est jamais une sous-grille (CSS Grid 2, § 9). La liste, dans ce bloc, vise donc le tableau par son
 *     nom (`/board`) ; l'en-tête aussi, par cohérence.
 *   - La carte allégée : marges de 2,25 px pour la liste (`px-0.5`) et de 6,75 px pour la carte (`px-1.5`), soit 130,7 − 2 − 4,5 − 2 − 13,5 =
 *     108,7 px de contenu ; ses pastilles perdent leur pictogramme et passent à la ligne entre deux mots ; son titre se coupe d'un tiret
 *     (`hyphens-auto`, dans la langue de la page). La priorité garde son code (« P2 »), qui la dit en clair, et perd ses barres : avec elles,
 *     l'identifiant n'aurait que 43,2 px, moins que « bdesk- » (51,2 px), et se couperait en trois.
 *   - layout.test.ts le vérifie avec les polices de l'application (`test/fontMetrics.ts`), aux tailles réelles (15,75 px pour le libellé, 13,5 px
 *     pour le reste ; pictogrammes et bordures en px) : libellés, comptes, pastilles, âges, identifiants, en français et en anglais.
 *
 * Le sélecteur de cinq boutons est celui d'avant, une grille de cinq. Au-delà, ses boutons gardent leur nom sur une ligne et la rangée défile en
 * elle-même quand elle ne tient pas (à 375 px, la page, elle, ne défile jamais de côté) ; elle s'étire sur toute la largeur quand elle tient. Son
 * remplissage (`p-1`, 4,5 px) laisse la place à l'anneau de focus d'un bouton (2 px, à 2 px du bouton), que le défilement rognerait sinon.
 */
export interface BoardLayout {
  /** Le conteneur des colonnes : une piste de grille par colonne, toutes côte à côte. */
  grid: string;
  /** Une colonne : affichée côte à côte avec les autres, même quand ce n'est pas celle du sélecteur ; de six à huit, une sous-grille de deux rangées. */
  column: string;
  /**
   * Ce qui suit l'en-tête d'une colonne (la liste, la note de Terminé) : de six à huit colonnes, réuni dans un bloc de ces classes, la seconde rangée
   * de la sous-grille, et le conteneur (`column`) dont la carte lit la largeur ; à cinq, `null` : laissé tel quel, le DOM d'avant.
   */
  body: string | null;
  /** L'en-tête d'une colonne : collant sous la barre du haut, quand les colonnes sont côte à côte. */
  header: string;
  /** La ligne de l'en-tête (pictogramme, libellé, compte) : dans une colonne étroite, une ligne de texte qui passe à la ligne entre deux mots. */
  headerRow: string;
  /** Le pictogramme de l'en-tête, dans cette ligne de texte. */
  headerIcon: string;
  /** Le libellé de la colonne, dans cette ligne de texte. */
  title: string;
  /** L'en-tête se lit-il comme une phrase dans une colonne étroite ? Des espaces y séparent alors le libellé, le compte et le choix de Terminé. */
  inlineHeader: boolean;
  /** La liste des cartes d'une colonne : plusieurs cartes par ligne quand une seule colonne prend toute la largeur. */
  cards: string;
  /** Une carte d'une colonne (pas du tiroir « En pause »), allégée dans une colonne étroite. */
  card: CardLayout;
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

/**
 * Une carte de six à huit colonnes (`Card`) : sa marge de défilement côte à côte, et allégée quand sa colonne est étroite. Rien pour un tableau de
 * cinq colonnes ni pour le tiroir « En pause » : la carte d'avant.
 */
export interface CardLayout {
  /**
   * La carte : ses marges, et, côte à côte, sa marge de défilement. Remontée au clavier (j, k, h, l : `scrollIntoView`), elle s'arrête sous les
   * en-têtes collants et non dessous : la barre du haut (`top-11`, 49,5 px), l'en-tête le plus haut (132,75 px au seuil, Terminé avec 9 999 cartes) et
   * son anneau de focus (2 px) tiennent dans `scroll-mt-41` (184,5 px). Une colonne seule garde la marge d'avant (`scroll-mt-28`, Card.tsx).
   */
  item: string;
  /** Son titre : coupé d'un tiret plutôt qu'au milieu d'un mot sans rien dire. */
  title: string;
  /** La rangée de ses pastilles : chacune perd son pictogramme et peut passer à la ligne entre deux mots. */
  badges: string;
  /** Les barres de sa priorité : masquées, le code (« P2 ») reste. */
  priorityGlyph: string;
}

const PLAIN_CARD: CardLayout = { item: '', title: '', badges: '', priorityGlyph: '' };

/** La largeur d'une colonne côte à côte, écart compris, à cinq colonnes : 60 rem pour les cinq, le seuil d'avant les Statuts de relais. */
export const WIDE_REM_PER_COLUMN = 12;

/** La largeur d'une colonne côte à côte, écart compris, de six à huit colonnes : 61,6 rem pour les huit, qui tiennent dans le panneau à 1 440 px. */
export const NARROW_REM_PER_COLUMN = 7.7;

/** Le contenu d'une colonne (le conteneur `column`, `body`) en deçà duquel sa carte s'allège : 9,5 rem, 171 px. */
export const NARROW_COLUMN_REM = 9.5;

/**
 * La carte d'une colonne de moins de 9,5 rem (`NARROW_COLUMN_REM`), de six à huit colonnes, à toute largeur du tableau. Sa marge de défilement
 * (`item`) dépend du seuil de chaque disposition : voir `LAYOUTS`.
 */
const NARROW_CARD: Omit<CardLayout, 'item'> = {
  title: '@max-[9.5rem]/column:hyphens-auto',
  badges: '@max-[9.5rem]/column:[&>span]:shrink @max-[9.5rem]/column:[&>span>svg]:hidden',
  priorityGlyph: '@max-[9.5rem]/column:hidden',
};

/** La rangée qui défile du sélecteur de plus de cinq colonnes : chaque bouton a la largeur de son nom, et la rangée s'étire quand elle tient. */
const SCROLLING_SELECTOR = {
  selectorGroup: 'relative flex gap-0.5 overflow-x-auto rounded-lg border border-line bg-well p-1',
  selectorButton: 'flex shrink-0 grow basis-auto flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1.5 text-micro font-medium transition-colors',
  selectorLabel: 'whitespace-nowrap',
  scrolls: true,
} as const;

/** Les classes de chaque disposition, écrites en entier pour que Tailwind les lise. */
const LAYOUTS: Readonly<Record<5 | 6 | 7 | 8, BoardLayout>> = {
  // Les classes d'avant les Statuts de relais, inchangées : un Projet qui n'en a pas garde son tableau.
  5: {
    grid: '@min-[60rem]:grid @min-[60rem]:grid-cols-5',
    column: '@min-[60rem]:flex',
    body: null,
    header: '@min-[60rem]:sticky @min-[60rem]:top-11',
    headerRow: '',
    headerIcon: '',
    title: '',
    inlineHeader: false,
    cards: '@min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-1',
    card: PLAIN_CARD,
    selector: '@min-[60rem]:hidden',
    selectorGroup: 'grid grid-cols-5 gap-0.5 rounded-lg border border-line bg-well p-0.5',
    selectorButton: 'flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-md px-0.5 py-1.5 text-micro font-medium transition-colors',
    selectorLabel: 'text-center wrap-anywhere',
    scrolls: false,
  },
  // Six à huit : une colonne seule a deux cartes par ligne dès 36 rem, puis une seule quand toutes sont côte à côte ; jamais trois. Côte à côte, pas
  // d'écart entre les deux rangées de la grille : l'en-tête et la liste d'une colonne se touchent, comme avant.
  6: {
    grid: '@min-[46.2rem]:grid @min-[46.2rem]:grid-cols-6 @min-[46.2rem]:gap-y-0',
    column: '@min-[46.2rem]:grid @min-[46.2rem]:data-[shown=true]:grid @min-[46.2rem]:row-span-2 @min-[46.2rem]:grid-rows-subgrid',
    body: '@container/column',
    header: '@min-[46.2rem]/board:sticky @min-[46.2rem]/board:top-11 @min-[46.2rem]/board:px-1.5',
    headerRow: '@min-[46.2rem]/board:block',
    headerIcon: '@min-[46.2rem]/board:inline @min-[46.2rem]/board:mr-1.5',
    title: '@min-[46.2rem]/board:inline',
    inlineHeader: true,
    cards: '@min-[36rem]/board:grid-cols-2 @min-[46.2rem]/board:grid-cols-1 @max-[9.5rem]/column:px-0.5',
    card: { ...NARROW_CARD, item: '@min-[46.2rem]/board:scroll-mt-41 @max-[9.5rem]/column:px-1.5' },
    selector: '@min-[46.2rem]:hidden',
    ...SCROLLING_SELECTOR,
  },
  7: {
    grid: '@min-[53.9rem]:grid @min-[53.9rem]:grid-cols-7 @min-[53.9rem]:gap-y-0',
    column: '@min-[53.9rem]:grid @min-[53.9rem]:data-[shown=true]:grid @min-[53.9rem]:row-span-2 @min-[53.9rem]:grid-rows-subgrid',
    body: '@container/column',
    header: '@min-[53.9rem]/board:sticky @min-[53.9rem]/board:top-11 @min-[53.9rem]/board:px-1.5',
    headerRow: '@min-[53.9rem]/board:block',
    headerIcon: '@min-[53.9rem]/board:inline @min-[53.9rem]/board:mr-1.5',
    title: '@min-[53.9rem]/board:inline',
    inlineHeader: true,
    cards: '@min-[36rem]/board:grid-cols-2 @min-[53.9rem]/board:grid-cols-1 @max-[9.5rem]/column:px-0.5',
    card: { ...NARROW_CARD, item: '@min-[53.9rem]/board:scroll-mt-41 @max-[9.5rem]/column:px-1.5' },
    selector: '@min-[53.9rem]:hidden',
    ...SCROLLING_SELECTOR,
  },
  8: {
    grid: '@min-[61.6rem]:grid @min-[61.6rem]:grid-cols-8 @min-[61.6rem]:gap-y-0',
    column: '@min-[61.6rem]:grid @min-[61.6rem]:data-[shown=true]:grid @min-[61.6rem]:row-span-2 @min-[61.6rem]:grid-rows-subgrid',
    body: '@container/column',
    header: '@min-[61.6rem]/board:sticky @min-[61.6rem]/board:top-11 @min-[61.6rem]/board:px-1.5',
    headerRow: '@min-[61.6rem]/board:block',
    headerIcon: '@min-[61.6rem]/board:inline @min-[61.6rem]/board:mr-1.5',
    title: '@min-[61.6rem]/board:inline',
    inlineHeader: true,
    cards: '@min-[36rem]/board:grid-cols-2 @min-[61.6rem]/board:grid-cols-1 @max-[9.5rem]/column:px-0.5',
    card: { ...NARROW_CARD, item: '@min-[61.6rem]/board:scroll-mt-41 @max-[9.5rem]/column:px-1.5' },
    selector: '@min-[61.6rem]:hidden',
    ...SCROLLING_SELECTOR,
  },
};

/** La disposition d'un tableau de `count` colonnes : de cinq (tout Projet) à huit (les trois Statuts de relais). */
export function boardLayout(count: number): BoardLayout {
  const clamped = Math.min(8, Math.max(5, Math.round(count))) as 5 | 6 | 7 | 8;
  return LAYOUTS[clamped];
}
