import type { Plugin } from 'vite';

/**
 * Qui peut encadrer l'application dans une page (`<iframe>`, `<frame>`, `<object>`, `<embed>`) : elle-même, et l'éditeur qui l'ouvre dans un panneau
 * (bdesk-38k.67 ; ADR 0002, résiduel (c) de « Toute l'API refuse les pages d'un autre site » ; décision de l'utilisateur : option C).
 *
 * Le garde de bdesk-38k.64 (`origin.ts`) refuse à l'API les requêtes d'une page d'un autre site. Il ne voit pas celle qui encadre l'application elle-même : le
 * document est demandé `cross-site`, mais ce n'est pas une route de l'API ; ensuite l'application, chargée dans le cadre, appelle SON API, de même origine
 * (`same-origin`), et le garde doit la laisser passer. Une page tierce faisait ainsi travailler l'API (lectures Dolt, métriques, flux) par des cadres cachés.
 * Cet en-tête arrête le navigateur avant qu'il ne charge le document dans le cadre : aucun script ne s'y exécute, donc aucune requête à l'API.
 *
 * - `'self'` : l'application dans un cadre de sa propre origine ;
 * - `vscode-webview:` et `vscode-file:` : le Simple Browser de VS Code (et des éditeurs qui en dérivent) encadre l'adresse dans une webview (`vscode-webview://…`),
 *   sous la fenêtre de l'éditeur (`vscode-file://…`). `frame-ancestors` vérifie TOUS les ancêtres du cadre, d'où les deux schémas. Une page web (`http:` ou `https:`) ne peut
 *   pas avoir ces schémas pour origine : elle reste refusée, y compris ouverte DANS le Simple Browser, où elle devient elle-même un ancêtre du cadre. MAIS tout contenu
 *   rendu dans une webview d'éditeur a cette origine (la sortie HTML d'un notebook d'un dépôt cloné, l'aperçu HTML d'une extension) et peut encadrer l'application : c'est le
 *   prix de l'option C, accepté par l'utilisateur, raisonné et non essayé. D'après leur code, le Simple Browser de VS Code 1.139 et celui de Cursor 3.22 n'encadrent rien
 *   (navigateur intégré) et n'ont probablement pas besoin de ces schémas ; `frame-ancestors 'self'` seul serait alors sans coût. Voir l'ADR 0002.
 *
 * Pas de `X-Frame-Options` : il ne connaît plus que `DENY` et `SAMEORIGIN` (`ALLOW-FROM` n'est plus compris), ne sait pas nommer ces schémas, et refuserait une webview d'éditeur qui encadre l'application.
 */
export const FRAME_ANCESTORS = "frame-ancestors 'self' vscode-webview: vscode-file:";

/** Un document HTML : `index.html`, que servent `/` et toute route de l'app, et tout autre que l'on ajouterait au dossier de l'interface (refusé par défaut). */
const HTML_DOCUMENT = /\.html?$/i;

/**
 * Le `setHeaders` de `@fastify/static`, appelé pour chaque fichier qu'il envoie, le repli sur `index.html` (`reply.sendFile`) et les réponses 304 compris : pose
 * `FRAME_ANCESTORS` sur un document HTML, et rien sur les autres fichiers (scripts, feuilles de style, icône). L'API et les 404 ne passent pas par là.
 */
export function refuseFraming(res: { setHeader(name: string, value: string): unknown }, path: string): void {
  if (HTML_DOCUMENT.test(path)) res.setHeader('Content-Security-Policy', FRAME_ANCESTORS);
}

/**
 * En développement (`pnpm dev`), c'est Vite qui sert la page, pas Fastify (relecture de bdesk-38k.67, B1). Son `server.headers` ne suffit pas : Vite 6.4.4 répond la 304 d'une page
 * revalidée (`If-None-Match`) AVANT de l'appliquer (`send`, `dep-3O3b9SCF.js`), et son HTML se revalide à chaque chargement (`Cache-Control: no-cache`, ETag tiré du contenu, donc stable
 * tant que `index.html` ne change pas). Une page encadrée par un site tiers avant le correctif, gardée en cache, aurait continué de s'afficher dans le cadre. Cet intergiciel passe donc
 * AVANT tous ceux de Vite (celui qu'un greffon enregistre dans `configureServer`, sans fonction de retour, précède les intergiciels internes : cache de transformation, proxy,
 * `indexHtmlMiddleware`) et pose l'en-tête avant que Vite ne choisisse entre un 200 et un 304. Sur toute réponse, pas seulement le HTML : on ne sait pas encore ce que Vite va répondre ;
 * c'est sans effet pour un module, puisque seul un document s'encadre. Pas sur `/api` : le proxy de Vite prend toute adresse qui commence par là, et relaie la réponse de l'API telle quelle.
 */
export function refuseFramingInDev(req: { url?: string }, res: { setHeader(name: string, value: string): unknown }, next: () => void): void {
  if (!(req.url ?? '').startsWith('/api')) res.setHeader('Content-Security-Policy', FRAME_ANCESTORS);
  next();
}

/** Le greffon de Vite qui installe `refuseFramingInDev`. `enforce: 'pre'` : son intergiciel est enregistré avant ceux des autres greffons, qui passeraient sinon devant le sien. */
export function frameAncestorsPlugin(): Plugin {
  return {
    name: 'frame-ancestors',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use(refuseFramingInDev);
    },
  };
}
