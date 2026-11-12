import { describe, expect, it } from 'vitest';
import { parsePath, paths } from './paths';

describe('paths', () => {
  it('construit les URL de l’application', () => {
    expect(paths.global()).toBe('/');
    expect(paths.kanban('bdesk')).toBe('/p/bdesk/kanban');
    expect(paths.kanban('bdesk', 'bdesk-38k')).toBe('/p/bdesk/kanban?epic=bdesk-38k');
    expect(paths.epics('bdesk')).toBe('/p/bdesk/epics');
    expect(paths.epics('bdesk', 'bdesk-38k')).toBe('/p/bdesk/epics?epic=bdesk-38k');
    expect(paths.metrics('bdesk')).toBe('/p/bdesk/metrics');
    expect(paths.issue('sais', 'beads_sais-udw')).toBe('/p/sais/t/beads_sais-udw');
  });

  it('échappe les identifiants', () => {
    expect(paths.kanban('a b')).toBe('/p/a%20b/kanban');
    expect(paths.kanban('a b', 'epic/1&2')).toBe('/p/a%20b/kanban?epic=epic%2F1%262');
  });
});

describe('parsePath', () => {
  it('lit le Projet, la section et le ticket', () => {
    expect(parsePath('/')).toEqual({});
    expect(parsePath('/p/bdesk')).toEqual({ projectId: 'bdesk' });
    expect(parsePath('/p/bdesk/kanban')).toEqual({ projectId: 'bdesk', section: 'kanban' });
    expect(parsePath('/p/bdesk/metrics/')).toEqual({ projectId: 'bdesk', section: 'metrics' });
    expect(parsePath('/p/bdesk/t/bdesk-38k.6')).toEqual({
      projectId: 'bdesk',
      section: 'issue',
      issueId: 'bdesk-38k.6',
    });
  });

  // Aucune limite de longueur côté interface (bdesk-38k.88) : l'adresse que `paths` écrit est lue à l'identique par `parsePath`, pour un Projet au nom de dossier de 255 caractères et des tickets de
  // 255 caractères, ASCII ou non (« é » : 6 caractères une fois encodé, un émoji : 12).
  it.each([
    ['ASCII', `${'q'.repeat(240)}-38k.7`],
    ['accentué', `é${'à'.repeat(253)}ü`],
    ['émoji', '😀'.repeat(255)],
  ])('relit à l’identique un Projet et un ticket de 255 caractères (%s)', (_kind, issueId) => {
    const projectId = `${'dossier-au-nom-tres-long-'.repeat(11)}x`.slice(0, 255);

    expect(parsePath(paths.issue(projectId, issueId))).toEqual({ projectId, section: 'issue', issueId });
    expect(parsePath(paths.kanban(projectId))).toEqual({ projectId, section: 'kanban' });
    expect(parsePath(paths.metrics(projectId))).toEqual({ projectId, section: 'metrics' });
  });

  it('décode les segments et ignore les adresses inconnues', () => {
    expect(parsePath('/p/a%20b/epics')).toEqual({ projectId: 'a b', section: 'epics' });
    expect(parsePath('/p/%E0%A4%A/kanban')).toEqual({ projectId: '%E0%A4%A', section: 'kanban' });
    expect(parsePath('/autre/chose')).toEqual({});
    expect(parsePath('/p/bdesk/inconnu')).toEqual({ projectId: 'bdesk' });
  });
});
