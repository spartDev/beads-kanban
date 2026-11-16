import { beforeEach } from 'vitest';

/**
 * Le worker de vitest doit rendre la main à sa boucle d'événements moins d'une minute après chaque message qu'il envoie (bdesk-8g5).
 *
 * Le worker (un processus par fichier de tests, pool `forks`) rapporte au processus principal le début et la fin de chaque test et de chaque crochet par des
 * messages `onTaskUpdate`, regroupés (un envoi au plus toutes les cent millisecondes). Chacun attend sa réponse 60 s au plus (le délai par défaut de birpc,
 * que vitest 3.2.7 ne laisse pas régler). Le processus principal répond en quelques millisecondes, mais le worker ne lit sa réponse que lorsque sa boucle
 * d'événements tourne, et vitest ne la lui rend jamais entre deux tests : il les enchaîne par des microtâches, comme les crochets. Une suite de tests
 * synchrones (`headParity.test.ts` : 49 tests de calcul, de 61 à 67 s d'un seul tenant en CI) ou de commandes `dolt` lancées par `execFileSync` (les crochets
 * et les tests de `stored-sql.*.integration.test.ts` : jusqu'à 58 s d'un seul tenant, mesurées en local sur une machine chargée) la tient bloquée. Quand la
 * boucle reprend après plus de 60 s, la phase des minuteurs passe avant celle des entrées-sorties : le délai expire avant que la réponse, arrivée depuis
 * longtemps, soit lue. vitest rejette alors l'envoi, le fichier finit en erreur, et la suite sort en code 1 sur « [vitest-worker]: Timeout calling
 * "onTaskUpdate" », rapportée à la toute fin sans nom de fichier, alors que tous ses tests passent.
 *
 * D'où ces deux règles : rendre la main avant chaque test (`installEventLoopYield`, posé par les fichiers d'initialisation des deux projets), ce qui borne
 * le blocage à un seul test ou un seul crochet au lieu de toute une suite ; et, dans un crochet ou un test qui enchaîne beaucoup de travail synchrone
 * (plusieurs bases Dolt bâties par `execFileSync`), rendre la main entre deux étapes (`await yieldToEventLoop()`).
 */

/**
 * `setImmediate` pris au chargement du module, avant tout test : un test qui laisse des minuteurs factices (`vi.useFakeTimers` remplace aussi
 * `setImmediate`) ne bloque pas le crochet du suivant.
 */
const realSetImmediate = globalThis.setImmediate;

/**
 * Rend la main à la boucle d'événements jusqu'à ce qu'elle ait traversé une phase d'entrées-sorties, celle où le worker lit les réponses du processus
 * principal. Deux tours de `setImmediate` : le premier peut tomber dans la phase « check » du tour en cours, juste après la phase d'entrées-sorties dont le
 * rappel a repris le code (la fin d'une lecture `dolt` asynchrone, par exemple), sans en traverser une nouvelle ; le second en traverse toujours une.
 */
export const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => realSetImmediate(() => realSetImmediate(resolve)));

/**
 * Rend la main avant chaque test du fichier. À appeler depuis un fichier d'initialisation (`setupFiles`) : vitest l'exécute avant chaque fichier de tests,
 * sous `--no-isolate` aussi, alors qu'un crochet posé à l'évaluation d'un module importé ne le serait qu'une fois par worker.
 */
export function installEventLoopYield(): void {
  beforeEach(yieldToEventLoop);
}
