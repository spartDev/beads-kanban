# Les textes de l'interface viennent d'un catalogue TypeScript typé, en français et en anglais, sans bibliothèque d'i18n

L'interface était écrite en français, texte en dur dans les composants, nombres et dates écrits à la main (`metrics/format.ts`) pour que l'affichage, et donc les tests, ne dépendent pas de la version d'ICU. Elle doit aussi exister en anglais : la langue suit celle du navigateur (`navigator.languages`, la première langue connue l'emporte, l'anglais à défaut), et un sélecteur à trois positions (langue du navigateur, Français, English), sur le modèle de celui du thème, permet d'en changer.

Les textes viennent donc d'un **catalogue en TypeScript** : un objet `fr` et un objet `en` du même type. Une clé manquante, ou un paramètre oublié, est une erreur de compilation ; les pluriels et les phrases à paramètres sont des fonctions du catalogue. Les formateurs de nombres, durées et dates restent écrits à la main, une version par langue. Les messages du serveur qu'affiche l'interface lui parviennent sous forme d'un code et de ses paramètres, et c'est elle qui les écrit dans sa langue. Le contenu des tickets n'est jamais traduit.

## Considered Options

- **Une bibliothèque (react-i18next, Lingui, FormatJS)** — écartée : pour deux langues, elle apporte des fichiers JSON non typés (ou un outillage de génération pour les typer), une extraction, et des pluriels et dates par ICU, ce qui rend l'affichage dépendant de la version d'ICU, que le projet évite déjà pour ses formateurs.
- **`Intl.NumberFormat` / `Intl.DateTimeFormat` paramétrés par la langue** — écarté pour les mêmes raisons que dans `metrics/format.ts` : le texte change d'une version d'ICU à l'autre. Seuls les fuseaux passent par `Intl` (ADR 0004).

## Consequences

- Ajouter une troisième langue, c'est écrire un troisième objet du même type et ses formateurs ; le compilateur dit ce qui manque.
- La suite de tests force le français ; l'anglais a ses propres tests (choix de la langue, sélecteur, formateurs, quelques écrans).
- `<html lang>`, les titres d'onglet et les textes destinés aux lecteurs d'écran suivent la langue choisie.
