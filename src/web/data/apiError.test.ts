import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_ERROR_PARAMS, readApiErrorDetail, type ApiErrorCode, type ApiErrorDetail } from '../../shared/errors';
import { ApiError, apiGet, describeError, errorText } from './client';

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

/** L'erreur que `apiGet` lève pour ce corps de réponse. */
async function failureOf(body: unknown, status: number): Promise<ApiError> {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body, status)));
  const error: unknown = await apiGet('/api/x').catch((caught: unknown) => caught);
  if (!(error instanceof ApiError)) throw new Error('apiGet aurait dû lever une ApiError');
  return error;
}

const coded = (message: string, status: number, detail: ApiErrorDetail) => new ApiError(message, status, { detail });

describe('readApiErrorDetail', () => {
  it('garde un code connu dont les paramètres ont la forme attendue', () => {
    expect(readApiErrorDetail('project-not-found', { project: 'p' })).toEqual({ code: 'project-not-found', params: { project: 'p' } });
    expect(readApiErrorDetail('period-too-long', { days: 400, max: 366 })).toEqual({ code: 'period-too-long', params: { days: 400, max: 366 } });
    expect(readApiErrorDetail('query-invalid-range', { received: 'x', expected: ['7d'] })).toMatchObject({ code: 'query-invalid-range' });
    expect(readApiErrorDetail('unexpected', {})).toEqual({ code: 'unexpected', params: {} });
    expect(readApiErrorDetail('unexpected', undefined)).toEqual({ code: 'unexpected', params: {} }); // sans paramètre, `params` peut manquer
  });

  it.each([
    ['un code inconnu', 'nouveau-code', {}],
    ['un code qui n’est pas un texte', 42, {}],
    ['un nom hérité d’Object', 'toString', {}],
    ['un paramètre manquant', 'issue-not-found', { project: 'p' }],
    ['une liste vide pour un code sans paramètre', 'unexpected', []],
    ['un nombre pour paramètres', 'unexpected', 0],
    ['un paramètre au nom hérité d’Object', 'project-not-found', { valueOf: ['p'] }],
    ['un paramètre mal nommé', 'query-unknown-parameter', { parameter: 'x', attendus: ['a'] }],
    ['un paramètre en trop', 'project-not-found', { project: 'p', path: '/Users/x' }],
    ['un paramètre mal typé', 'period-too-long', { days: '400', max: 366 }],
    ['un nombre nul', 'period-too-long', { days: null, max: 366 }],
    ['un nombre qui n’est pas fini (NaN)', 'period-too-long', { days: Number.NaN, max: 366 }],
    ['un nombre qui n’est pas fini (Infinity)', 'period-too-long', { days: Number.POSITIVE_INFINITY, max: 366 }],
    ['des paramètres pour un code qui n’en a pas', 'unexpected', { path: '/Users/x' }],
    ['une liste qui contient autre chose que des textes', 'query-unknown-parameter', { parameter: 'x', expected: ['a', 1] }],
    ['des paramètres qui ne sont pas un objet', 'project-not-found', ['p']],
    ['des paramètres nuls', 'unexpected', null],
  ])('refuse %s', (_name, code, params) => {
    expect(readApiErrorDetail(code, params)).toBeUndefined();
  });
});

describe('apiGet : code et paramètres', () => {
  it('garde le code et les paramètres d’une réponse d’erreur, à côté de son message', async () => {
    const error = await failureOf(
      { statusCode: 404, error: 'Not Found', message: 'Projet inconnu : p', code: 'project-not-found', params: { project: 'p' } },
      404,
    );

    expect(error).toMatchObject({ status: 404, message: 'Projet inconnu : p', detail: { code: 'project-not-found', params: { project: 'p' } } });
  });

  it('garde une erreur codée sans message : la phrase vient du code', async () => {
    const error = await failureOf({ code: 'project-not-found', params: { project: 'p' } }, 404);

    expect(error.detail).toEqual({ code: 'project-not-found', params: { project: 'p' } });
    expect(errorText(error, 'en')).toBe('Unknown Project: p');
  });

  it('ignore un code qu’il ne connaît pas, ou dont les paramètres n’ont pas la forme attendue : le message reste', async () => {
    const unknown = await failureOf({ message: 'Nouveau refus', code: 'nouveau-code', params: {} }, 400);
    const malformed = await failureOf({ message: 'Projet inconnu : p', code: 'project-not-found', params: { project: 1 } }, 404);

    expect(unknown.detail).toBeUndefined();
    expect(errorText(unknown, 'en')).toBe('Nouveau refus');
    expect(malformed.detail).toBeUndefined();
    expect(errorText(malformed, 'en')).toBe('Projet inconnu : p');
  });
});

describe('errorText', () => {
  // Chaque code de l'API, dans les deux langues : les paramètres à leur place (un `from` et un `to` échangés se verraient).
  const SENTENCES: Record<ApiErrorCode, [ApiErrorDetail, string, string]> = {
    unexpected: [{ code: 'unexpected', params: {} }, 'Erreur inattendue.', 'Unexpected error.'],
    'request-aborted': [{ code: 'request-aborted', params: {} }, 'Requête abandonnée par le client.', 'Request canceled by the client.'],
    'read-aborted': [{ code: 'read-aborted', params: {} }, 'Lecture abandonnée par son demandeur.', 'Read canceled by its requester.'],
    'host-not-allowed': [
      { code: 'host-not-allowed', params: {} },
      "Hôte non autorisé : l'application n'est joignable que par 127.0.0.1 ou localhost.",
      'Host not allowed: the app can only be reached at 127.0.0.1 or localhost.',
    ],
    'origin-not-allowed': [
      { code: 'origin-not-allowed', params: {} },
      "Origine non autorisée : l'API n'est jointe que par l'application elle-même (127.0.0.1 ou localhost).",
      'Origin not allowed: the API only answers the app itself (127.0.0.1 or localhost).',
    ],
    'project-not-found': [{ code: 'project-not-found', params: { project: 'p' } }, 'Projet inconnu : p', 'Unknown Project: p'],
    'issue-not-found': [{ code: 'issue-not-found', params: { project: 'p', issue: 'p-1' } }, 'Ticket inconnu dans p : p-1', 'Unknown ticket in p: p-1'],
    'project-unreadable': [{ code: 'project-unreadable', params: { reason: 'R' } }, 'Projet illisible : R', 'Unreadable Project: R'],
    'query-unknown-parameter': [
      { code: 'query-unknown-parameter', params: { parameter: 'foo', expected: ['project', 'timeZone'] } },
      'Paramètre inconnu : « foo » (attendus : project, timeZone).',
      'Unknown parameter: “foo” (expected: project, timeZone).',
    ],
    'query-empty-project': [{ code: 'query-empty-project', params: {} }, '« project » ne peut pas être vide.', '“project” cannot be empty.'],
    'query-range-and-dates': [
      { code: 'query-range-and-dates', params: {} },
      'Choisissez « range » ou « from » et « to », pas les deux.',
      'Choose “range” or “from” and “to”, not both.',
    ],
    'query-dates-together': [{ code: 'query-dates-together', params: {} }, '« from » et « to » vont ensemble.', '“from” and “to” go together.'],
    'query-empty-time-zone': [{ code: 'query-empty-time-zone', params: {} }, '« timeZone » ne peut pas être vide.', '“timeZone” cannot be empty.'],
    'query-invalid-range': [
      { code: 'query-invalid-range', params: { received: '1y', expected: ['7d', '30d', '90d'] } },
      '« range » doit valoir 7d, 30d ou 90d : reçu « 1y ».',
      '“range” must be 7d, 30d, or 90d: got “1y”.',
    ],
    'query-not-text': [{ code: 'query-not-text', params: { parameter: 'timeZone' } }, '« timeZone » doit être un texte.', '“timeZone” must be a string.'],
    'query-repeated': [{ code: 'query-repeated', params: { parameter: 'range' } }, "« range » ne peut être donné qu'une fois.", '“range” can only be given once.'],
    'period-inverted': [
      { code: 'period-inverted', params: { from: 'F', to: 'T' } },
      'La plage commence après sa fin : « from » (F) doit être avant « to » (T).',
      'The range starts after it ends: “from” (F) must be before “to” (T).',
    ],
    'period-in-future': [
      { code: 'period-in-future', params: { to: 'T', today: 'D' } },
      "« to » (T) est dans le futur : la plage ne peut pas dépasser aujourd'hui (D).",
      '“to” (T) is in the future: the range cannot go past today (D).',
    ],
    'period-too-early': [
      { code: 'period-too-early', params: { from: 'F' } },
      'La plage doit commencer le 1er janvier 1970 ou après : « from » (F) est trop tôt.',
      'The range must start on or after January 1, 1970: “from” (F) is too early.',
    ],
    'period-too-long': [
      // Les nombres passent par le formateur de la langue : à partir de 1 000, la phrase française groupe les chiffres, ce que le message du serveur ne fait pas.
      { code: 'period-too-long', params: { days: 1200, max: 366 } },
      'La plage est trop longue : 1 200 jours, au plus 366.',
      'The range is too long: 1,200 days, at most 366.',
    ],
    'period-invalid-day': [
      { code: 'period-invalid-day', params: { parameter: 'from', received: 'X' } },
      '« from » doit être un jour qui existe, au format AAAA-MM-JJ : reçu « X ».',
      '“from” must be a real day, formatted YYYY-MM-DD: got “X”.',
    ],
  };

  it.each(Object.entries(SENTENCES))('écrit %s dans les deux langues', (code, [detail, fr, en]) => {
    expect(detail.code).toBe(code);
    const error = coded('message du serveur', 400, detail);

    expect(errorText(error, 'fr')).toBe(fr);
    expect(errorText(error, 'en')).toBe(en);
  });

  it('a une phrase pour chaque code du registre', () => {
    expect(Object.keys(SENTENCES).sort()).toEqual(Object.keys(API_ERROR_PARAMS).sort());
  });

  it('affiche la raison d’un Projet illisible telle que le serveur l’écrit, en français (bdesk-ewr.8 la traduira)', () => {
    const reason = 'La base est tenue par un autre processus dolt : réessayez dans un instant.';
    const error = new ApiError(reason, 503, { reason, detail: { code: 'project-unreadable', params: { reason } } });

    expect(errorText(error, 'en')).toBe(`Unreadable Project: ${reason}`);
    // Le titre dit déjà « Projet illisible » : le détail est la raison seule, dans les deux langues.
    expect(describeError(error, 'en')).toMatchObject({ detail: reason, specific: true });
  });

  it('écrit le message tel quel pour une erreur sans code (un message que le serveur n’a pas codé)', () => {
    expect(errorText(new ApiError('boum', 500), 'en')).toBe('boum');
    expect(errorText(new Error('autre'), 'en')).toBe('autre');
  });

  it('écrit dans la langue les erreurs que le client constate lui-même', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 })));
    const bodyless = await apiGet('/api/x').catch((error: unknown) => error);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const unreachable = await apiGet('/api/x').catch((error: unknown) => error);

    expect([errorText(bodyless, 'fr'), errorText(bodyless, 'en')]).toEqual(['Erreur HTTP 502', 'HTTP error 502']);
    expect([errorText(unreachable, 'fr'), errorText(unreachable, 'en')]).toEqual(['Serveur injoignable', 'Server unreachable']);
  });

  it('ne dit rien de ce qui n’est pas une Error', () => {
    expect(errorText('boum', 'fr')).toBeUndefined();
    expect(errorText(undefined, 'en')).toBeUndefined();
  });
});

describe('describeError : le détail dans la langue', () => {
  it('écrit le détail d’une erreur codée dans la langue demandée, en français comme en anglais', () => {
    const error = coded('Projet inconnu : p', 404, { code: 'project-not-found', params: { project: 'p' } });

    expect(describeError(error, 'fr').detail).toBe('Projet inconnu : p');
    expect(describeError(error, 'en').detail).toBe('Unknown Project: p');
  });

  it('écrit le détail d’une validation refusée (400) et d’une erreur inattendue (500) dans la langue', () => {
    const invalid = coded('« from » et « to » vont ensemble.', 400, { code: 'query-dates-together', params: {} });
    const unexpected = coded('Erreur inattendue.', 500, { code: 'unexpected', params: {} });

    expect(describeError(invalid, 'en').detail).toBe('“from” and “to” go together.');
    expect(describeError(unexpected, 'en').detail).toBe('Unexpected error.');
  });
});
