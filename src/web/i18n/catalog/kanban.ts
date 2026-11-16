import type { Zone } from './zone';

/** Zone « kanban » (bdesk-ewr.3) : `kanban/`, `issue/` (Panneau de ticket), `markdown/`, `design/` (types, statuts, priorités), pages du kanban. */
const fr = {};

const en: typeof fr = {};

export const kanban: Zone<typeof fr> = { fr, en };
