/**
 * Les langues que le navigateur déclare (`navigator.languages`, `navigator.language`), que jsdom fixe à l'anglais américain. La suite
 * de tests est en français : `setup.ts` déclare un navigateur français avant chaque test ; un test de la détection en choisit d'autres.
 * `languagechange` prévient l'application, comme un navigateur dont on change les langues.
 */
export function setBrowserLanguages(
  languages: readonly string[],
  { notify = false, language = languages[0] ?? '' }: { notify?: boolean; language?: string } = {},
): void {
  const list = Object.freeze([...languages]);
  Object.defineProperty(window.navigator, 'languages', { configurable: true, get: () => list });
  // `language` : la première de la liste, comme un navigateur ; à part, pour un navigateur qui a une langue mais une liste vide.
  Object.defineProperty(window.navigator, 'language', { configurable: true, get: () => language });
  if (notify) window.dispatchEvent(new Event('languagechange'));
}
