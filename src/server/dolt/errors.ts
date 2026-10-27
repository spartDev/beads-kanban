/**
 * Les erreurs du lecteur Dolt. Elles vivent à part pour que `read-only.ts` puisse en dériver (`ReadOnlyViolation`)
 * sans import circulaire, `client.ts` important `read-only.ts` : les autres modules les importent de `client.ts`,
 * qui les ré-exporte.
 */

/** Le binaire `dolt` n'est pas installé (ou pas dans le PATH). */
export class DoltNotFoundError extends Error {
  constructor(binary: string) {
    super(`Le binaire « ${binary} » est introuvable : installez Dolt et vérifiez qu'il est dans le PATH.`);
    this.name = 'DoltNotFoundError';
  }
}

/** Échec d'une requête : base illisible, schéma inattendu, verrou persistant, délai dépassé, requête refusée… */
export class DoltQueryError extends Error {
  constructor(
    message: string,
    /** Dossier de la base, quand l'erreur en vient. */
    readonly dir = '',
    readonly locked = false,
    /** L'erreur d'origine, pour qui débogue : l'API n'en expose que le message. */
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DoltQueryError';
  }
}
