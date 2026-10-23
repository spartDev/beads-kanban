/** Erreur d'appel à l'API. `status` vaut 0 quand le serveur est injoignable. */
export class ApiError extends Error {
  readonly status: number;
  /** Pourquoi un Projet est illisible (503) ; absente des autres erreurs. */
  readonly reason?: string;

  constructor(message: string, status: number, options?: ErrorOptions & { reason?: string }) {
    super(message, options);
    this.name = 'ApiError';
    this.status = status;
    this.reason = options?.reason;
  }
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { Accept: 'application/json' }, signal });
  } catch (cause) {
    // Une requête annulée n'est pas une panne : on laisse TanStack Query la traiter.
    if (signal?.aborted) throw cause;
    throw new ApiError('Serveur injoignable', 0, { cause });
  }
  if (!res.ok) throw await readApiError(res);
  return (await res.json()) as T;
}

async function readApiError(res: Response): Promise<ApiError> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object') {
      // `reason` (503) dit pourquoi un Projet est illisible : c'est le message le plus utile.
      const { reason, message, error } = body as { reason?: unknown; message?: unknown; error?: unknown };
      const text = [reason, message, error].find((candidate): candidate is string => typeof candidate === 'string' && candidate !== '');
      if (text) return new ApiError(text, res.status, { reason: typeof reason === 'string' && reason ? reason : undefined });
    }
  } catch {
    // Corps absent ou qui n'est pas du JSON : on retombe sur le code HTTP.
  }
  return new ApiError(`Erreur HTTP ${res.status}`, res.status);
}

export interface ErrorDescription {
  title: string;
  detail?: string;
  /** Le titre nomme la cause elle-même (Projet illisible) : il remplace le titre de contexte d'un `ErrorNotice`. */
  specific?: true;
}

/** Titre et détail affichables d'une erreur de chargement, en français. */
export function describeError(error: unknown): ErrorDescription {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return {
        title: 'Le serveur beads-desktop est injoignable',
        detail: 'Vérifiez que la commande beads-desktop tourne toujours, puis réessayez.',
      };
    }
    // Un 503 avec raison, c'est un Projet que le serveur n'arrive pas à lire (base verrouillée, absente…).
    if (error.status === 503 && error.reason) {
      return { title: 'Projet illisible', detail: error.reason, specific: true };
    }
    if (error.status >= 500) {
      return { title: 'Le serveur a rencontré une erreur', detail: error.message };
    }
    if (error.status === 404) return { title: 'Ressource introuvable', detail: error.message };
    return { title: 'Chargement impossible', detail: error.message };
  }
  return {
    title: 'Chargement impossible',
    detail: error instanceof Error ? error.message : undefined,
  };
}
