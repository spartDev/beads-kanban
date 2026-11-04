/**
 * Ce que l'adresse de la page Epic retient, pour qu'un lien le partage :
 *
 *   ?epic=<id>     l'Epic (sans lui, la page est la liste des Epics du Projet)
 *   ?view=tree     les Enfants en arborescence ; sans lui, rangés par colonne
 */
export const EPIC_PARAM = 'epic';
export const VIEW_PARAM = 'view';

export type EpicView = 'columns' | 'tree';

/** Le réglage `?view=` : `tree`, sinon les colonnes. */
export const parseView = (value: string | null): EpicView => (value === 'tree' ? 'tree' : 'columns');
