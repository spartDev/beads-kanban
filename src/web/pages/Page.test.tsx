import { render, screen } from '@testing-library/react';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { focusTitleOf, showsSkeletonTitle, titleOf } from '../lib/zoneFocus';
import { INVISIBLE_TEXTS, VISIBLE_TEXTS } from '../test/invisibleTexts';
import { Skeleton } from '../ui/states';
import { Page } from './Page';

/**
 * Le titre d'un squelette est marqué `data-skeleton` (bdesk-38k.40) : le focus que « Réessayer » rend à une page qui se recharge ne doit pas s'y poser, la page
 * qui le remplace le retire du document, et le focus tomberait sur le corps de la page. Le marqueur, pas le nom : le squelette est nommé « Chargement… »
 * (bdesk-38k.53) sans cesser d'être un squelette, et une page qui s'appellerait ainsi n'en serait pas un.
 */
describe('Page : le marqueur du titre d’un squelette', () => {
  it('le titre d’une page, un texte, n’est pas marqué', () => {
    render(<Page title="Kanban" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Kanban' }).hasAttribute('data-skeleton')).toBe(false);
  });

  it('un titre qui charge (`null`) est marqué', () => {
    render(<Page title={null} />);

    expect(document.querySelector('h1')?.hasAttribute('data-skeleton')).toBe(true);
  });

  it('ce qui marque le squelette est l’absence de titre, pas son nom : le squelette, nommé « Chargement… », l’est ; une page qui s’appelle ainsi, non', () => {
    const { rerender } = render(<Page title={null} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Chargement…' }).hasAttribute('data-skeleton')).toBe(true);

    rerender(<Page title="Chargement…" />);

    const title = screen.getByRole('heading', { level: 1, name: 'Chargement…' });
    expect(title.hasAttribute('data-skeleton')).toBe(false);
    expect(title.hasAttribute('aria-label')).toBe(false); // son nom est son texte, pas celui d'un squelette
  });
});

/**
 * Le titre d'un squelette a un nom (bdesk-38k.53). Un `<h1>` dont le seul contenu est un `<Skeleton />` (caché aux lecteurs d'écran) est vide : axe le relève
 * (`empty-heading`), et le lecteur d'écran qui parcourt les titres s'arrête sur un titre muet. `Page` donne le nom, pour toute page : elle seule sait que son
 * titre charge, et aucune page n'a à y penser. Le projet n'a pas axe en jsdom : « aucun titre au nom vide » en tient lieu (`queryAllByRole('heading', { name: '' })`),
 * la même chose que `empty-heading`, et le navigateur passe axe pour de bon (bdesk-38k.53, `proofs`).
 */
describe('Page : le nom du titre d’un squelette', () => {
  const emptyHeadings = () => screen.queryAllByRole('heading', { name: '' });

  it('un titre qui charge est nommé « Chargement… » : le titre n’est pas vide', () => {
    render(<Page title={null} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Chargement…' })).toBeTruthy();
    expect(emptyHeadings()).toEqual([]);
  });

  it('c’est `Page` qui dessine le squelette : son seul contenu, caché aux lecteurs d’écran, sans texte ni nœud de plus', () => {
    render(<Page title={null} />);

    const title = screen.getByRole('heading', { level: 1 });
    expect(title.textContent).toBe('');
    expect(title.children).toHaveLength(1);
    expect(title.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('le titre d’une page, un texte, n’a pour nom que son texte : pas de nom de squelette', () => {
    render(<Page title="Kanban" />);

    const title = screen.getByRole('heading', { level: 1, name: 'Kanban' });
    expect(title.hasAttribute('aria-label')).toBe(false);
    expect(title.querySelector('[aria-hidden="true"]')).toBeNull(); // pas de squelette en plus du texte
    expect(screen.queryByRole('heading', { name: 'Chargement…' })).toBeNull();
  });

  it('le texte arrive à la place du squelette : le titre n’a plus que son texte, ni nom de squelette ni marqueur ni squelette', () => {
    const { rerender } = render(<Page title={null} />);
    const title = screen.getByRole('heading', { level: 1, name: 'Chargement…' });

    rerender(<Page title="Kanban" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Kanban' })).toBe(title); // le même nœud : l'attribut doit partir avec le squelette
    expect(title.hasAttribute('aria-label')).toBe(false);
    expect(title.hasAttribute('data-skeleton')).toBe(false);
    expect(title.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(emptyHeadings()).toEqual([]);
  });

  it('le titre redevient un squelette (la page se recharge) : il reprend son nom', () => {
    const { rerender } = render(<Page title="Kanban" />);

    rerender(<Page title={null} />);

    const title = screen.getByRole('heading', { level: 1, name: 'Chargement…' });
    expect(title.hasAttribute('data-skeleton')).toBe(true);
    expect(title.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('le squelette a la largeur de la page qui charge (`w-40` sans autre précision) : à l’arrivée du texte, le titre ne saute pas', () => {
    const skeleton = () => screen.getByRole('heading', { level: 1 }).firstElementChild;
    const { rerender } = render(<Page title={null} />);
    expect([...(skeleton()?.classList ?? [])]).toEqual(expect.arrayContaining(['h-7', 'w-40']));

    rerender(<Page title={null} loadingWidth="w-2/3" />);

    expect(skeleton()?.classList.contains('w-2/3')).toBe(true);
    expect(skeleton()?.classList.contains('h-7')).toBe(true);
    expect(skeleton()?.classList.contains('w-40')).toBe(false);
  });

  it('le titre n’est pas marqué occupé : l’état de chargement est celui de la région qui le suit, et un lecteur d’écran peut taire ce qui est occupé', () => {
    render(
      <Page title={null}>
        <div role="status" aria-busy="true" aria-label="Chargement du Projet" />
      </Page>,
    );

    expect(screen.getByRole('heading', { level: 1 }).hasAttribute('aria-busy')).toBe(false);
    expect(screen.getByRole('status', { name: 'Chargement du Projet' }).getAttribute('aria-busy')).toBe('true');
  });

  describe('le focus (bdesk-38k.40) ne prend pas ce nom pour un titre', () => {
    const inMain = (title: Parameters<typeof Page>[0]['title']) => {
      render(
        <main>
          <Page title={title} />
        </main>,
      );
      return screen.getByRole('main');
    };

    it('la zone n’a pas de titre à prendre : un squelette nommé reste un squelette', () => {
      const main = inMain(null);

      expect(titleOf(main)).toBeNull();
      expect(showsSkeletonTitle(main)).toBe(true);
    });

    it('le titre d’un texte, lui, est celui que le focus prend', () => {
      const main = inMain('Kanban');

      expect(titleOf(main)).toBe(screen.getByRole('heading', { name: 'Kanban' }));
      expect(showsSkeletonTitle(main)).toBe(false);
    });

    it('le focus va à la zone, pas au titre du squelette, qui n’est pas focalisable', () => {
      const main = inMain(null);
      const title = screen.getByRole('heading', { name: 'Chargement…' });

      expect(focusTitleOf(title)).toBe(true);

      expect(document.activeElement).toBe(main);
      expect(title.hasAttribute('tabindex')).toBe(false);
    });
  });
});

/**
 * Le contrat du titre (bdesk-38k.53) : un texte, ou `null` quand il charge, et rien d'autre. Avec `ReactNode`, tout titre qui n'était pas un texte passait pour un
 * squelette et prenait le nom « Chargement… » (`aria-label` remplace le nom tiré du contenu) : un vrai titre en JSX, un identifiant en `<code>` ou un lien, aurait été
 * renommé en silence pour les lecteurs d'écran. Le type est le garde-fou : `pnpm typecheck` refuse le JSX (les `@ts-expect-error` ci-dessous tombent, « unused »,
 * si le type s'élargit de nouveau), et le rendu garde son sens si un `as` le contourne.
 */
describe('Page : le contrat du titre, un texte ou `null`', () => {
  it('le type du titre est un texte ou `null`, rien d’autre', () => {
    expectTypeOf<Parameters<typeof Page>[0]['title']>().toEqualTypeOf<string | null>();
  });

  it('un titre en JSX est refusé par le type, et rendu tel quel si le type est contourné : son texte pour nom, jamais « Chargement… »', () => {
    // @ts-expect-error `title` est un texte ou `null` : un nœud React est l'un ni l'autre
    render(<Page title={<span>Ma vraie Epic</span>} />);

    const title = screen.getByRole('heading', { level: 1, name: 'Ma vraie Epic' });
    expect(title.hasAttribute('aria-label')).toBe(false);
    expect(title.hasAttribute('data-skeleton')).toBe(false);
    expect(titleOf(document.body)).toBe(title); // et c'est un titre que le focus peut prendre (.40), pas un squelette
    expect(screen.queryByRole('heading', { name: 'Chargement…' })).toBeNull();
  });

  it('un `<Skeleton />` n’est plus un titre : le type le refuse, c’est `null` qui dit « il charge »', () => {
    // @ts-expect-error `Page` dessine elle-même le squelette de son titre : une page n'en passe plus
    render(<Page title={<Skeleton className="h-7 w-40" />} />);

    const title = screen.getByRole('heading', { level: 1 });
    expect(title.hasAttribute('aria-label')).toBe(false); // plus de nom « Chargement… » posé par `Page` sur ce que la page a dessiné
    expect(title.hasAttribute('data-skeleton')).toBe(false);
  });

  it('`undefined` n’est pas un titre qui charge : le type le refuse', () => {
    // @ts-expect-error il faut dire `null` pour dire « il charge »
    render(<Page title={undefined} />);

    expect(screen.queryByRole('heading', { name: 'Chargement…' })).toBeNull();
  });
});

/**
 * Un titre sans texte n'est jamais un titre muet (bdesk-38k.61). `null` est la page qui charge ; un texte est son titre. Mais un texte peut ne rien dire : vide, fait d'espaces, ou de
 * caractères sans largeur (le nom d'un dossier, que le serveur donne pour nom à un Projet : `ProjectGate` le passe tel quel). Le `<h1>` serait alors muet pour un lecteur d'écran, sans
 * que rien le signale quand le nom est un caractère sans largeur (axe ne voit que l'absence de texte). `Page` l'écrit « Sans titre » (`isInvisibleText`), pour que « il n'a pas
 * de titre » ne s'entende pas comme « il charge ».
 */
describe('Page : un titre sans texte s’écrit « Sans titre » (bdesk-38k.61)', () => {
  it.each(INVISIBLE_TEXTS)('un titre %s est écrit « Sans titre » : le titre n’est pas muet', (_kind, blank) => {
    render(<Page title={blank} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Sans titre' }).textContent).toBe('Sans titre');
    expect(screen.queryAllByRole('heading', { name: '' })).toEqual([]);
  });

  it('c’est un vrai titre, pas un squelette : sans marqueur ni nom de chargement, et le focus peut le prendre', () => {
    render(
      <main>
        <Page title="" />
      </main>,
    );

    const title = screen.getByRole('heading', { level: 1, name: 'Sans titre' });
    expect(title.hasAttribute('data-skeleton')).toBe(false);
    expect(title.hasAttribute('aria-label')).toBe(false);
    expect(title.querySelector('[aria-hidden="true"]')).toBeNull(); // pas de bloc de squelette
    expect(screen.queryByRole('heading', { name: 'Chargement…' })).toBeNull();
    expect(titleOf(screen.getByRole('main'))).toBe(title);
    expect(showsSkeletonTitle(screen.getByRole('main'))).toBe(false);
  });

  it('seul `null` dit « il charge » : un texte vide n’est pas un titre qui charge, et le titre qui charge n’est pas « Sans titre »', () => {
    const { rerender } = render(<Page title={null} />);
    const title = screen.getByRole('heading', { level: 1, name: 'Chargement…' });
    expect(screen.queryByRole('heading', { name: 'Sans titre' })).toBeNull();

    rerender(<Page title="" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Sans titre' })).toBe(title); // le même nœud, devenu un titre
    expect(title.hasAttribute('data-skeleton')).toBe(false);
    expect(title.hasAttribute('aria-label')).toBe(false);
    expect(screen.queryByRole('heading', { name: 'Chargement…' })).toBeNull();
  });

  it('le texte arrive après un titre sans texte : le titre prend son texte', () => {
    const { rerender } = render(<Page title="  " />);
    expect(screen.getByRole('heading', { level: 1, name: 'Sans titre' })).toBeTruthy();

    rerender(<Page title="Kanban" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Kanban' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Sans titre' })).toBeNull();
  });

  it('un titre qui a du texte reste le sien : « Sans titre » ne remplace que ce qui ne dit rien', () => {
    const { rerender } = render(<Page title="Kanban" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Kanban' })).toBeTruthy();

    rerender(<Page title="beads-desktop" />);
    expect(screen.getByRole('heading', { level: 1, name: 'beads-desktop' })).toBeTruthy();

    rerender(<Page title={'Kan\u200bban'} />); // un caractère sans largeur au milieu d'un vrai texte : le titre dit quelque chose
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Kan\u200bban');
    expect(screen.queryByRole('heading', { name: 'Sans titre' })).toBeNull();
  });
});

/**
 * Un titre de page n'est pas un titre de ticket (bdesk-38k.61, revue). Ceux d'une page sont le nom du dossier d'un Projet (`ProjectGate`), le nom d'une Epic, le nom d'une page : `Page` les
 * écrit tels qu'ils sont, jusqu'à leurs blancs, sauf quand on n'en verrait rien. Elle ne passe pas par la règle des titres de ticket (`ticketTitle` : `isBlankTitle`, qui peut compter pour vide
 * un séparateur seul, et `collapseSpaces`, qui réécrit les blancs) : un dossier peut s'appeler « - » ou « : », et sa page ne s'appelle pas « Sans titre » pour autant. Le test est là pour que
 * ni la règle des tickets ni sa réécriture ne change un titre de page sans qu'on le voie.
 */
describe('Page : un titre qui se voit est écrit tel quel (bdesk-38k.61)', () => {
  it.each(VISIBLE_TEXTS)('%s : le titre est le texte, sans une lettre de changée', (_kind, text) => {
    render(<Page title={text} />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(text);
    expect(screen.queryByRole('heading', { name: 'Sans titre' })).toBeNull();
  });

  it('un titre de ponctuation seule reste un titre, que le focus peut prendre, et non le titre d’un squelette', () => {
    render(
      <main>
        <Page title=":" />
      </main>,
    );

    const title = screen.getByRole('heading', { level: 1 });
    expect(title.textContent).toBe(':');
    expect(title.hasAttribute('data-skeleton')).toBe(false);
    expect(titleOf(screen.getByRole('main'))).toBe(title);
  });
});
