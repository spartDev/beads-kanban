/**
 * Une lecture abandonnée par son demandeur : le client HTTP a fermé la connexion avant la réponse (bdesk-38k.20). Ce n'est
 * pas une panne de la base : jamais un Projet illisible (503), et personne n'attend plus de réponse.
 * Son nom est celui de l'`AbortError` de la plateforme, que `isAbortError` reconnaît aussi.
 */
export class ReadAborted extends Error {
  constructor() {
    super('Lecture abandonnée par son demandeur.');
    this.name = 'AbortError';
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Attend `promise`, mais s'en détache aussitôt (`ReadAborted`) quand `signal` est abandonné. La lecture, elle, continue :
 * c'est à son propriétaire de l'arrêter (voir `Flight`). Sert à attendre une lecture que d'autres demandeurs partagent et
 * qu'aucun ne peut interrompre à lui seul.
 */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new ReadAborted());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ReadAborted());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
