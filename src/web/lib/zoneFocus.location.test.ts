import { afterEach, describe, expect, it } from 'vitest';
import { focusTitleWhenReady } from './zoneFocus';

/**
 * L'attente du titre (`focusTitleWhenReady`) est celle du titre de la page où l'utilisateur a demandé (bdesk-38k.57). La zone dit quelle page elle montre : `data-location`, que le
 * shell écrit sur le contenu principal à chaque navigation, dans le même rendu que la page (voir `AppShell.location.test.tsx`). Le DOM seul, sans React ; `retryFocus.test.tsx`
 * rejoue le cas de l'application entière (« Réessayer » de la porte du Projet sur la page d'une Epic, puis un raccourci).
 */

afterEach(() => {
  document.body.innerHTML = '';
});

const html = (markup: string) => {
  document.body.innerHTML = markup;
  return (selector: string) => document.querySelector<HTMLElement>(selector)!;
};

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Un contenu principal qui montre `location`, sous le titre d'un squelette, et un contrôle hors de lui. */
const LOCATED_PAGE = (location: string) =>
  `<main data-location="${location}"><h1 id="squelette" data-skeleton><span class="sr-only">Chargement…</span></h1></main><button id="ailleurs">Ailleurs</button>`;

/** La page chargée prend la place du squelette, d'un coup (comme React le fait : le nœud du squelette part). */
const arrive = ($: (selector: string) => HTMLElement) => {
  $('#squelette').remove();
  $('main').insertAdjacentHTML('afterbegin', '<h1 id="titre">Epic</h1>');
};

/** Ce que fait la navigation : le shell écrit l'adresse de la nouvelle page, et la page qui la montre prend la place de l'ancienne, d'un coup. */
const navigate = ($: (selector: string) => HTMLElement, location: string) => {
  $('main').setAttribute('data-location', location);
  $('main').replaceChildren();
  $('main').insertAdjacentHTML('afterbegin', '<h1 id="kanban">Kanban</h1>');
};

/** Le contenu principal a le focus, comme après un « Réessayer » : l'attente commence. */
function waiting(location: string) {
  const $ = html(LOCATED_PAGE(location));
  $('main').setAttribute('tabindex', '-1');
  $('main').focus();
  focusTitleWhenReady($('main'));
  return $;
}

describe('focusTitleWhenReady : la page que la zone montre', () => {
  it('la zone montre encore la même page quand le titre arrive : il prend le focus', async () => {
    const $ = waiting('/p/bdesk/epics?epic=a');

    arrive($);
    await nextTask();

    expect(document.activeElement).toBe($('#titre'));
  });

  it('l’utilisateur va sur une autre page pendant l’attente : le titre de la page qui arrive ne prend pas le focus', async () => {
    const $ = waiting('/p/bdesk/epics?epic=a');
    await nextTask();

    navigate($, '/p/bdesk/kanban');
    await nextTask();

    expect(document.activeElement).toBe($('main')); // le titre de la page qu'il a demandée n'est pas celui-ci
  });

  it('une autre page avec le même chemin mais d’autres paramètres (l’Epic suivante) n’est pas la même page', async () => {
    const $ = waiting('/p/bdesk/epics?epic=a');

    navigate($, '/p/bdesk/epics?epic=b');
    await nextTask();

    expect(document.activeElement).toBe($('main'));
  });

  it('l’attente s’est arrêtée avec la navigation : revenu sur la page demandée (« Retour »), son titre qui arrive ne prend pas le focus', async () => {
    const $ = waiting('/p/bdesk/epics?epic=a');
    navigate($, '/p/bdesk/kanban');
    await nextTask();

    // « Retour » : la page demandée est de nouveau là, sous son squelette, puis son titre arrive. Ce n'est plus le réessai qui l'attendait.
    $('main').setAttribute('data-location', '/p/bdesk/epics?epic=a');
    $('main').replaceChildren();
    $('main').insertAdjacentHTML('afterbegin', '<h1 id="squelette" data-skeleton></h1>');
    await nextTask();
    arrive($);
    await nextTask();

    expect(document.activeElement).toBe($('main'));
  });

  it('une zone qui ne dit pas quelle page elle montre (la barre latérale) attend comme avant', async () => {
    const $ = html('<main><h1 id="squelette" data-skeleton></h1></main>'); // pas de `data-location`
    $('main').setAttribute('tabindex', '-1');
    $('main').focus();
    focusTitleWhenReady($('main'));

    arrive($);
    await nextTask();

    expect(document.activeElement).toBe($('#titre'));
  });

  it('la page est celle d’un ancêtre de la zone : une région du contenu principal suit la page du contenu principal', async () => {
    const $ = html('<main data-location="/a"><section id="zone"><h2 id="squelette" data-skeleton></h2></section></main>');
    $('#zone').setAttribute('tabindex', '-1');
    $('#zone').focus();
    focusTitleWhenReady($('#zone'));

    $('main').setAttribute('data-location', '/b');
    $('#squelette').remove();
    $('#zone').insertAdjacentHTML('afterbegin', '<h2 id="titre">Titre</h2>');
    await nextTask();

    expect(document.activeElement).toBe($('#zone'));
  });

  // La demande de focus est celle de la page où « Réessayer » ou « Reconnecter » a été pressé : l'appelant en retient l'adresse (`locationOf`) et la donne à la fin. Si la zone en montre une
  // autre à ce moment-là, l'utilisateur est allé ailleurs entre l'appui et l'issue : le titre de cette page ne vaut pas ce qu'il a demandé, même s'il existe déjà (bdesk-38k.57).
  describe('la demande a été faite sur une page', () => {
    it('la zone montre une autre page que celle de la demande : le titre, qui existe pourtant, ne prend pas le focus', () => {
      const $ = html('<main data-location="/p/bdesk/kanban"><h1 id="titre">Kanban</h1></main>');
      $('main').setAttribute('tabindex', '-1');
      $('main').focus();

      focusTitleWhenReady($('main'), '/p/bdesk/epics?epic=a');

      expect(document.activeElement).toBe($('main'));
    });

    it('la zone montre une autre page que celle de la demande, sous un squelette : l’attente ne commence pas, le titre qui arrive ne prend pas le focus', async () => {
      const $ = html(LOCATED_PAGE('/p/bdesk/kanban'));
      $('main').setAttribute('tabindex', '-1');
      $('main').focus();

      focusTitleWhenReady($('main'), '/p/bdesk/epics?epic=a');
      arrive($);
      await nextTask();

      expect(document.activeElement).toBe($('main'));
    });

    it('la zone montre la page de la demande : le titre existant prend le focus', () => {
      const $ = html('<main data-location="/p/bdesk/kanban"><h1 id="titre">Kanban</h1></main>');
      $('main').setAttribute('tabindex', '-1');
      $('main').focus();

      focusTitleWhenReady($('main'), '/p/bdesk/kanban');

      expect(document.activeElement).toBe($('#titre'));
    });

    it('la zone montre la page de la demande, sous un squelette : le titre qui arrive prend le focus, et l’attente s’arrête si l’on change de page', async () => {
      const $ = html(LOCATED_PAGE('/p/bdesk/epics?epic=a'));
      $('main').setAttribute('tabindex', '-1');
      $('main').focus();
      focusTitleWhenReady($('main'), '/p/bdesk/epics?epic=a');
      navigate($, '/p/bdesk/kanban');
      await nextTask();

      expect(document.activeElement).toBe($('main'));
    });

    it('une zone qui ne dit pas quelle page elle montre (la barre latérale) : la demande, faite sans page, vaut', () => {
      const $ = html('<main><h1 id="titre">Titre</h1></main>');
      $('main').setAttribute('tabindex', '-1');
      $('main').focus();

      focusTitleWhenReady($('main'), null);

      expect(document.activeElement).toBe($('#titre'));
    });
  });
});
