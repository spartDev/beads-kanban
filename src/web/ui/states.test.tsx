import { act, render, screen, within } from '@testing-library/react';
import { Info } from 'lucide-react';
import { createRef, StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../data/client';
import { INVISIBLE_TEXTS } from '../test/invisibleTexts';
import { ErrorNotice, Notice } from './states';

describe('ErrorNotice', () => {
  it('titre un Projet illisible (503 avec raison) « Projet illisible », avec la raison, à la place du titre générique', () => {
    const error = new ApiError('Base Dolt verrouillée', 503, { reason: 'Base Dolt verrouillée' });
    render(<ErrorNotice error={error} title="Impossible de charger les tickets" onRetry={vi.fn()} />);

    const alert = screen.getByRole('alert');
    expect(alert.querySelector('p')?.textContent).toBe('Projet illisible');
    expect(alert.textContent).toContain('Base Dolt verrouillée');
    expect(alert.textContent).not.toContain('Impossible de charger les tickets');
    expect(screen.getByRole('button', { name: /Réessayer/ })).toBeTruthy();
  });

  it('garde le titre de l’appelant, puis la cause, pour les autres erreurs', () => {
    render(<ErrorNotice error={new ApiError('boom', 500)} title="Impossible de charger les tickets" />);

    const alert = screen.getByRole('alert');
    expect(alert.querySelector('p')?.textContent).toBe('Impossible de charger les tickets');
    expect(alert.textContent).toContain('Le serveur a rencontré une erreur');
    expect(alert.textContent).toContain('boom');
  });
});

describe('ErrorNotice : le focus qu’il tient quand il part (bdesk-38k.40)', () => {
  /** Un contenu principal (et une région qui est une zone de focus) où l'avis d'erreur est remplacé par le contenu, comme le squelette le remplace au rechargement. */
  function Page({ failed, zone = false }: { failed: boolean; zone?: boolean }) {
    const notice = failed ? <ErrorNotice error={new ApiError('boom', 500)} onRetry={vi.fn()} /> : <p>Chargé</p>;
    return (
      <>
        <button type="button">Ailleurs</button>
        <main>
          <h1>Page</h1>
          {zone ? (
            <section aria-label="Liste" data-focus-zone="" className="outline-none">
              <h2>Liste</h2>
              {notice}
            </section>
          ) : (
            notice
          )}
        </main>
      </>
    );
  }

  it('« Réessayer » a le focus quand l’avis part : le contenu principal le prend, pas le corps de la page', () => {
    const { rerender } = render(<Page failed />);
    act(() => screen.getByRole('button', { name: /Réessayer/ }).focus());

    rerender(<Page failed={false} />);

    expect(screen.queryByRole('button', { name: /Réessayer/ })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('une région marquée comme zone de focus est plus proche : elle prend le focus à la place du contenu principal', () => {
    const { rerender } = render(<Page failed zone />);
    act(() => screen.getByRole('button', { name: /Réessayer/ }).focus());

    rerender(<Page failed={false} zone />);

    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Liste' }));
  });

  it('l’avis d’un panneau de ticket : le panneau prend le focus, pas le contenu principal où il est posé', () => {
    function Panel({ failed }: { failed: boolean }) {
      return (
        <main>
          <div role="dialog" aria-label="Ticket" data-issue-panel="" tabIndex={-1}>
            {failed ? <ErrorNotice error={new ApiError('boom', 500)} onRetry={vi.fn()} /> : <p>Chargé</p>}
          </div>
        </main>
      );
    }
    const { rerender } = render(<Panel failed />);
    act(() => screen.getByRole('button', { name: /Réessayer/ }).focus());

    rerender(<Panel failed={false} />);

    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Ticket' }));
  });

  it('le focus est ailleurs quand l’avis part : il n’est pas repris', () => {
    const { rerender } = render(<Page failed zone />);
    const elsewhere = screen.getByRole('button', { name: 'Ailleurs' });
    act(() => elsewhere.focus());

    rerender(<Page failed={false} zone />);

    expect(document.activeElement).toBe(elsewhere);
  });

  it('en StrictMode (le développement monte les refs deux fois), l’avis ne prend le focus à personne en s’affichant, et le rend en partant', () => {
    const { rerender } = render(
      <StrictMode>
        <Page failed={false} zone />
      </StrictMode>,
    );
    const elsewhere = screen.getByRole('button', { name: 'Ailleurs' });
    act(() => elsewhere.focus());

    rerender(
      <StrictMode>
        <Page failed zone />
      </StrictMode>,
    );
    expect(document.activeElement).toBe(elsewhere); // l'avis qui s'affiche ne prend pas le focus
    act(() => screen.getByRole('button', { name: /Réessayer/ }).focus());

    rerender(
      <StrictMode>
        <Page failed={false} zone />
      </StrictMode>,
    );
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Liste' }));
  });

  it('la zone n’est focalisable que le temps qu’elle a le focus', () => {
    const { rerender } = render(<Page failed zone />);
    const region = screen.getByRole('region', { name: 'Liste' });
    expect(region.hasAttribute('tabindex')).toBe(false);
    act(() => screen.getByRole('button', { name: /Réessayer/ }).focus());

    rerender(<Page failed={false} zone />);
    expect(region.getAttribute('tabindex')).toBe('-1');
    act(() => screen.getByRole('button', { name: 'Ailleurs' }).focus());

    expect(region.hasAttribute('tabindex')).toBe(false);
  });
});

/**
 * Le nom d'un avis de statut (bdesk-38k.61). Un avis (`Notice`) est une région `status` : sans nom, un lecteur d'écran dit « statut » puis le contenu, et l'arbre d'accessibilité n'a qu'un
 * `status` muet à montrer. Il est nommé par son titre : `aria-labelledby` vers le texte qu'on lit, pour que le nom soit ce titre et non une copie à tenir à jour. Rien n'est ajouté à ce que
 * la région contient : le nom est un attribut, pas du texte de plus. Un titre qu'on ne voit pas (vide, d'espaces, de caractères sans largeur) ne nomme rien, et la région n'en porte pas.
 */
describe('Notice : le nom d’un avis de statut (bdesk-38k.61)', () => {
  const alive = (root: Element) => root.querySelectorAll('[role="status"], [role="alert"], [aria-live]');

  it('est nommé par son titre : le lecteur d’écran sait de quoi parle le statut', () => {
    render(
      <Notice icon={Info} title="Aucun ticket dans ce Projet">
        Créez-en un.
      </Notice>,
    );

    expect(screen.getByRole('status', { name: 'Aucun ticket dans ce Projet' })).toBeTruthy();
  });

  it('est nommé de même sans détail ni action : le titre est tout ce qu’il dit', () => {
    render(<Notice icon={Info} title="Rien à signaler" />);

    expect(screen.getByRole('status', { name: 'Rien à signaler' })).toBeTruthy();
  });

  it.each(INVISIBLE_TEXTS)('un titre %s ne nomme rien : ni `aria-labelledby` sur la région, ni `id` sur le titre', (_kind, title) => {
    const { container } = render(
      <Notice icon={Info} title={title}>
        Détail.
      </Notice>,
    );

    const region = screen.getByRole('status', { name: '' });

    expect(region.hasAttribute('aria-labelledby')).toBe(false);
    expect(container.querySelector('[id]')).toBeNull();
  });

  it('un titre qui se voit nomme la région, même de la ponctuation seule : seul ce qu’on ne voit pas ne la nomme pas', () => {
    render(
      <Notice icon={Info} title="-">
        Détail.
      </Notice>,
    );

    expect(screen.getByRole('status', { name: '-' })).toBeTruthy();
  });

  it('dit son contenu une seule fois : le nom n’ajoute aucun texte à la région, que le titre, le détail et l’action', () => {
    render(
      <Notice icon={Info} title="Aucun ticket dans ce Projet" action={<button type="button">Ouvrir</button>}>
        Créez-en un.
      </Notice>,
    );

    const region = screen.getByRole('status', { name: 'Aucun ticket dans ce Projet' });

    expect(region.textContent).toBe('Aucun ticket dans ce ProjetCréez-en un.Ouvrir');
    expect(within(region).getAllByText('Aucun ticket dans ce Projet')).toHaveLength(1); // le titre est lu, une fois, dans son paragraphe
  });

  it('est une seule région vivante, qui n’a que son rôle : ni `aria-live` ni `aria-atomic` de plus', () => {
    const { container } = render(<Notice icon={Info} title="Aucun ticket dans ce Projet">Créez-en un.</Notice>);

    const region = screen.getByRole('status', { name: 'Aucun ticket dans ce Projet' });

    expect([...alive(container)]).toEqual([region]);
    expect(region.hasAttribute('aria-live')).toBe(false); // `role="status"` est déjà poli et atomique : nommer la région n'y ajoute ni `aria-live` ni `aria-atomic`
    expect(region.hasAttribute('aria-atomic')).toBe(false);
  });

  it('garde le même nœud quand son titre change : le nom suit le titre, et la région reste la seule région vivante', () => {
    const { container, rerender } = render(<Notice icon={Info} title="Les 3 tickets du tableau sont tous en pause">Détail.</Notice>);
    const region = screen.getByRole('status', { name: 'Les 3 tickets du tableau sont tous en pause' });

    rerender(<Notice icon={Info} title="Les 4 tickets du tableau sont tous en pause">Détail.</Notice>);

    expect(screen.getByRole('status', { name: 'Les 4 tickets du tableau sont tous en pause' })).toBe(region); // le même nœud : la région n'a pas été remontée
    expect(screen.queryByRole('status', { name: 'Les 3 tickets du tableau sont tous en pause' })).toBeNull();
    expect([...alive(container)]).toEqual([region]);
  });

  it('plusieurs avis sur une page : chacun porte le nom de son propre titre, aucun n’emprunte celui d’un autre', () => {
    render(
      <>
        <Notice icon={Info} title="Premier avis">
          Premier détail.
        </Notice>
        <Notice icon={Info} title="Second avis">
          Second détail.
        </Notice>
      </>,
    );

    expect(within(screen.getByRole('status', { name: 'Premier avis' })).getByText('Premier détail.')).toBeTruthy();
    expect(within(screen.getByRole('status', { name: 'Second avis' })).getByText('Second détail.')).toBeTruthy();
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });

  it('en StrictMode comme hors de lui : la même région, le même nom', () => {
    render(
      <StrictMode>
        <Notice icon={Info} title="Aucun ticket dans ce Projet">
          Créez-en un.
        </Notice>
      </StrictMode>,
    );

    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status', { name: 'Aucun ticket dans ce Projet' })).toBeTruthy();
  });

  it('rend la région elle-même à `ref` : ce que `ErrorNotice` surveille pour rendre le focus est la région nommée, pas un nœud de dessous', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <Notice ref={ref} icon={Info} title="Aucun ticket dans ce Projet">
        Créez-en un.
      </Notice>,
    );

    expect(ref.current).toBe(screen.getByRole('status', { name: 'Aucun ticket dans ce Projet' }));
  });
});

/**
 * L'alerte d'une erreur n'est pas nommée (bdesk-38k.61). Une alerte se lit à son apparition, et les lecteurs d'écran qui lisent le nom d'une alerte nommée le disent avant son contenu
 * (« nom, alerte, contenu » : le relevé de JAWS sur a11ysupport.io, « alert role » nommé ; la norme ARIA 1.2 le permet) : nommée par son titre, elle le dirait deux fois, à chaque erreur.
 * Son contenu suffit, le titre en tête. Un avis de statut, lui, se lit en parcourant la page, et le nom lui donne un sens à cet endroit. Pour nommer aussi les alertes, il suffit
 * qu'`aria-labelledby` ne soit plus retiré à `tone="danger"` dans `Notice` : ces deux tests, et ceux de `noticeNames.test.tsx`, diraient alors le contraire.
 */
describe('Notice : l’alerte d’une erreur reste sans nom (bdesk-38k.61)', () => {
  it('une erreur est une alerte sans nom : son titre est dans son contenu, pas redit en nom', () => {
    render(<ErrorNotice error={new ApiError('boom', 500)} title="Impossible de charger les tickets" onRetry={vi.fn()} />);

    const alert = screen.getByRole('alert', { name: '' });

    expect(alert.hasAttribute('aria-labelledby')).toBe(false);
    expect(alert.hasAttribute('aria-label')).toBe(false);
    expect(within(alert).getAllByText('Impossible de charger les tickets')).toHaveLength(1);
  });

  it('un avis qui prend le ton de l’erreur (`tone="danger"`) est une alerte sans nom lui aussi', () => {
    render(
      <Notice icon={Info} tone="danger" title="Ce Projet est illisible">
        Base verrouillée.
      </Notice>,
    );

    expect(screen.getByRole('alert', { name: '' })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('l’alerte reste le nœud que `ref` reçoit : le focus que `ErrorNotice` rend part de ce nœud-là, comme avant', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <Notice ref={ref} icon={Info} tone="danger" title="Ce Projet est illisible">
        Base verrouillée.
      </Notice>,
    );

    expect(ref.current).toBe(screen.getByRole('alert'));
  });
});
