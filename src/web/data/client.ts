import { readApiErrorDetail } from '../../shared/errors';
import type { Language } from '../i18n/language';
import { ApiError, errorText } from './apiError';

export { ApiError, errorText } from './apiError';

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
      // `reason` (503) dit pourquoi un Projet est illisible : c'est le message le plus utile. `code` et `params` ne sont gardés que s'ils ont la
      // forme que leur code demande : sinon, l'erreur s'écrit par son message.
      const { reason, message, error, code, params } = body as Record<string, unknown>;
      const text = [reason, message, error].find((candidate): candidate is string => typeof candidate === 'string' && candidate !== '');
      const detail = readApiErrorDetail(code, params);
      if (text || detail) {
        return new ApiError(text ?? `Erreur HTTP ${res.status}`, res.status, {
          reason: typeof reason === 'string' && reason ? reason : undefined,
          detail,
        });
      }
    }
  } catch {
    // Corps absent ou qui n'est pas du JSON : on retombe sur le code HTTP.
  }
  return new ApiError(`Erreur HTTP ${res.status}`, res.status, { bodyless: true });
}

export interface ErrorDescription {
  title: string;
  detail?: string;
  /** Le titre nomme la cause elle-même (Projet illisible) : il remplace le titre de contexte d'un `ErrorNotice`. */
  specific?: true;
}

/** Titre et détail affichables d'une erreur de chargement ; le détail est écrit dans `language` (`errorText`). */
export function describeError(error: unknown, language: Language): ErrorDescription {
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
      return { title: 'Le serveur a rencontré une erreur', detail: errorText(error, language) };
    }
    if (error.status === 404) return { title: 'Ressource introuvable', detail: errorText(error, language) };
    return { title: 'Chargement impossible', detail: errorText(error, language) };
  }
  return {
    title: 'Chargement impossible',
    detail: errorText(error, language),
  };
}
