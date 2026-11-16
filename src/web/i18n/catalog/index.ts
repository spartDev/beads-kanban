/**
 * Le catalogue des textes de l'interface (ADR 0006) : un module par zone, chacun avec son objet `fr` et son objet `en`.
 *
 * Ajouter un texte, dans le module de sa zone (`catalog/<zone>.ts`) :
 * 1. l'écrire dans `fr`, sous un groupe qui nomme l'écran ou le composant (`fr.language.group`) ; l'objet `fr` donne le type ;
 * 2. l'écrire dans `en` (`const en: typeof fr`) : sans lui, le compilateur refuse ; une clé en trop aussi (sauf tant que `fr` est vide :
 *    le test « mêmes clés » de `language.test.tsx` la voit alors) ;
 * 3. le lire dans un composant par `const t = useT();` puis `t.<zone>.<groupe>.<clé>`.
 *
 * Un texte à paramètres ou à pluriel est une fonction, de même signature dans les deux langues :
 * `count: (n: number) => (n >= 2 ? `${n} tickets` : `${n} ticket`)` en français (singulier sous 2),
 * `count: (n: number) => (n === 1 ? '1 ticket' : `${n} tickets`)` en anglais. Le compilateur n'oblige pas l'anglais à lire chaque
 * paramètre : le test « mêmes clés » compare le nombre de paramètres, la relecture le reste. Les nombres et dates qu'un texte contient
 * passent par les formateurs de la langue : le catalogue n'appelle pas de hook, il reçoit des textes déjà écrits
 * (`delivered: (count: string) => …`, appelé avec `format.formatCount(n)` où `format = useFormat()`), ou le nombre brut quand il
 * ne sert qu'à choisir le pluriel. Jamais `String(n)` pour un nombre qui peut dépasser 999 ou avoir des décimales.
 * Termes anglais : les lignes « English » de CONTEXT.md. Le contenu des tickets n'est jamais traduit.
 *
 * Une zone appartient à une tâche de l'epic bdesk-ewr (voir l'en-tête de chaque module) : chaque tâche n'écrit que dans le sien. Un
 * texte partagé par plusieurs zones (`lib/signals.ts`, `theme/options.ts`…) appartient à la zone qui possède son dossier ; les autres le
 * lisent là (`t.shell.…`), sans le recopier. Les formateurs (`useFormat()`) sont déjà bilingues : aucune zone n'a à les toucher.
 */
import type { Language } from '../language';
import { epics } from './epics';
import { errors } from './errors';
import { kanban } from './kanban';
import { metrics } from './metrics';
import { shell } from './shell';

export interface Messages {
  shell: (typeof shell)['fr'];
  kanban: (typeof kanban)['fr'];
  epics: (typeof epics)['fr'];
  metrics: (typeof metrics)['fr'];
  errors: (typeof errors)['fr'];
}

const messagesIn = (language: Language): Messages => ({
  shell: shell[language],
  kanban: kanban[language],
  epics: epics[language],
  metrics: metrics[language],
  errors: errors[language],
});

export const CATALOGS: Record<Language, Messages> = { fr: messagesIn('fr'), en: messagesIn('en') };
