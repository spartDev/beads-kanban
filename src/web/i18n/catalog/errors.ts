import type { Zone } from './zone';

/** Zone « errors » (bdesk-ewr.6) : ce que l'interface écrit pour chaque code d'erreur que le serveur lui envoie (code + paramètres). */
const fr = {};

const en: typeof fr = {};

export const errors: Zone<typeof fr> = { fr, en };
