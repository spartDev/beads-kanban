import type { Language } from '../language';

/** Les textes d'une zone, un objet par langue, tous du type de l'objet français : une clé manquante ne compile pas. */
export type Zone<Messages> = Record<Language, Messages>;
