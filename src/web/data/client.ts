import { readApiErrorDetail } from '../../shared/errors';
import { CATALOGS } from '../i18n/catalog';
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
  return new ApiError(`Erreur HTTP ${res.status}`, res.status, { bare: true });
}

export interface ErrorDescription {
  title: string;
  detail?: string;
  /** Le titre nomme la cause elle-même (Projet illisible) : il remplace le titre de contexte d'un `ErrorNotice`. */
  specific?: true;
}

/**
 * Titre et détail affichables d'une erreur de chargement, dans la langue de l'interface. Le détail passe par `errorText` : la phrase du catalogue pour une
 * erreur que l'API a codée, sinon le message tel que le serveur l'envoie (une raison de Projet illisible, le message d'une erreur), qui n'est pas traduit.
 */
export function describeError(error: unknown, language: Language): ErrorDescription {
  const t = CATALOGS[language].shell.loadErrors;
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return { title: t.unreachable, detail: t.unreachableDetail };
    }
    // Un 503 avec raison, c'est un Projet que le serveur n'arrive pas à lire (base verrouillée, absente…).
    if (error.status === 503 && error.reason) {
      return { title: t.unreadableProject, detail: error.reason, specific: true };
    }
    const detail = errorText(error, language);
    if (error.status >= 500) return { title: t.serverError, detail };
    if (error.status === 404) return { title: t.notFound, detail };
    return { title: t.failed, detail };
  }
  return {
    title: t.failed,
    detail: errorText(error, language),
  };
}
