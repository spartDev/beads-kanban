import { afterEach, describe, expect, it } from 'vitest';
import { inertOutside } from './inert';

afterEach(() => {
  document.body.innerHTML = '';
});

function page() {
  document.body.innerHTML = `
    <div id="root">
      <aside id="sidebar"></aside>
      <div id="column">
        <header id="topbar"></header>
        <main id="main">
          <div id="content"></div>
          <div id="panel"><button id="close"></button></div>
        </main>
      </div>
      <nav id="tabs"></nav>
    </div>
    <div id="portal"></div>`;
  const get = (id: string) => document.getElementById(id) as HTMLElement;
  return { get, inert: (id: string) => get(id).hasAttribute('inert') };
}

describe('inertOutside', () => {
  it('rend inertes tous les éléments de la page sauf l’élément et ses ancêtres', () => {
    const { get, inert } = page();

    inertOutside(get('panel'));

    for (const id of ['sidebar', 'topbar', 'content', 'tabs']) expect(inert(id), id).toBe(true);
    for (const id of ['root', 'column', 'main', 'panel', 'close']) expect(inert(id), id).toBe(false);
  });

  it('laisse en paix ce qui est posé directement sur le corps de la page : les boîtes de dialogue (palette, aide) y sont ouvertes', () => {
    const { get, inert } = page();

    inertOutside(get('panel'));

    expect(inert('portal')).toBe(false);
  });

  it('rend la page telle qu’elle était, y compris ce qui était déjà inerte', () => {
    const { get, inert } = page();
    get('tabs').setAttribute('inert', '');

    const restore = inertOutside(get('panel'));
    restore();

    expect(inert('sidebar')).toBe(false);
    expect(inert('topbar')).toBe(false);
    expect(inert('content')).toBe(false);
    expect(inert('tabs')).toBe(true); // elle l'était avant nous, elle le reste
  });
});

describe('inertOutside : ce qui est ajouté après coup', () => {
  /** Les observateurs de mutations préviennent après la modification, en fin de tâche. */
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
  const added = (parent: Element, id: string, before: Element | null = null) => {
    const element = document.createElement('div');
    element.id = id;
    parent.insertBefore(element, before);
    return element;
  };

  it('rend inerte aussi ce qui apparaît hors de l’élément une fois la page rendue inerte : un bandeau, un message', async () => {
    const { get } = page();
    inertOutside(get('panel'));

    const banner = added(get('column'), 'banner', get('main'));
    const note = added(get('main'), 'note');
    const wide = added(get('root'), 'wide');
    await settled();

    for (const element of [banner, note, wide]) expect(element.hasAttribute('inert'), element.id).toBe(true);
  });

  it('ne rend pas inerte ce qui est ajouté dans l’élément lui-même, ni sur le corps de la page (les boîtes de dialogue)', async () => {
    const { get, inert } = page();
    inertOutside(get('panel'));

    const inside = added(get('panel'), 'inside');
    const dialog = added(document.body, 'dialog');
    await settled();

    expect(inside.hasAttribute('inert')).toBe(false);
    expect(dialog.hasAttribute('inert')).toBe(false);
    expect(inert('panel')).toBe(false);
  });

  it('ne rend jamais inerte un élément qui contient l’élément : un parent remplacé ne verrouille pas le panneau', async () => {
    const { get } = page();
    inertOutside(get('panel'));

    const replacement = document.createElement('main');
    replacement.id = 'replacement';
    replacement.append(get('panel'));
    get('column').append(replacement);
    await settled();

    expect(replacement.hasAttribute('inert')).toBe(false);
    expect(get('panel').hasAttribute('inert')).toBe(false);
  });

  it('rend la page telle qu’elle était, ce qui a été ajouté après coup compris, puis ne surveille plus rien', async () => {
    const { get } = page();
    const restore = inertOutside(get('panel'));
    const banner = added(get('column'), 'banner', get('main'));
    await settled();

    restore();
    const later = added(get('column'), 'later');
    await settled();

    expect(banner.hasAttribute('inert')).toBe(false);
    expect(later.hasAttribute('inert')).toBe(false);
  });
});
