import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../data/client';
import { LanguageProvider } from '../i18n';
import { setBrowserLanguages } from '../test/languages';
import { ErrorNotice } from './states';

/**
 * bdesk-ewr.6 : `ErrorNotice` écrit le détail d'une erreur d'API dans la langue affichée, par son code (`errorText`). Le titre, lui, reste
 * celui de la zone qui l'affiche.
 */
describe('ErrorNotice : le détail d’une erreur codée dans la langue affichée', () => {
  const error = new ApiError('« from » et « to » vont ensemble.', 400, { detail: { code: 'query-dates-together', params: {} } });

  it('en anglais quand l’interface l’est', () => {
    setBrowserLanguages(['en-US']);
    render(
      <LanguageProvider switchEnabled>
        <ErrorNotice error={error} />
      </LanguageProvider>,
    );

    expect(screen.getByText('“from” and “to” go together.')).toBeTruthy();
    expect(screen.queryByText('« from » et « to » vont ensemble.')).toBeNull();
  });

  it('en français, le message du serveur, sinon', () => {
    render(
      <LanguageProvider switchEnabled>
        <ErrorNotice error={error} />
      </LanguageProvider>,
    );

    expect(screen.getByText('« from » et « to » vont ensemble.')).toBeTruthy();
  });
});
