import { CATALOGS } from '../i18n/catalog';
import type { Language } from '../i18n/language';

/** Erreur d'appel à l'API. `status` vaut 0 quand le serveur est injoignable. */
export class ApiError extends Error {
  readonly status: number;
  /** Pourquoi un Projet est illisible (503) ; absente des autres erreurs. */
  readonly reason?: string;
  /** La réponse ne disait rien d'autre que son code HTTP : le message est un repli, que l'interface écrit dans sa langue (`describeError`). */
  readonly bare?: true;

  constructor(message: string, status: number, options?: ErrorOptions & { reason?: string; bare?: true }) {
    super(message, options);
    this.name = 'ApiError';
    this.status = status;
    this.reason = options?.reason;
    if (options?.bare) this.bare = true;
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
  return new ApiError(`Erreur HTTP ${res.status}`, res.status, { bare: true });
}

export interface ErrorDescription {
  title: string;
  detail?: string;
  /** Le titre nomme la cause elle-même (Projet illisible) : il remplace le titre de contexte d'un `ErrorNotice`. */
  specific?: true;
}

/**
 * Titre et détail affichables d'une erreur de chargement, dans la langue de l'interface. Le message que le serveur envoie (une raison de Dolt, le
 * message d'une erreur) est écrit tel quel : il n'est pas traduit.
 */
export function describeError(error: unknown, language: Language = 'fr'): ErrorDescription {
  const t = CATALOGS[language].shell.loadErrors;
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return { title: t.unreachable, detail: t.unreachableDetail };
    }
    // Un 503 avec raison, c'est un Projet que le serveur n'arrive pas à lire (base verrouillée, absente…).
    if (error.status === 503 && error.reason) {
      return { title: t.unreadableProject, detail: error.reason, specific: true };
    }
    const detail = error.bare ? t.http(error.status) : error.message;
    if (error.status >= 500) return { title: t.serverError, detail };
    if (error.status === 404) return { title: t.notFound, detail };
    return { title: t.failed, detail };
  }
  return {
    title: t.failed,
    detail: error instanceof Error ? error.message : undefined,
  };
}
