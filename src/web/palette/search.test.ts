import { describe, expect, it } from 'vitest';
import type { Issue } from '../data/types';
import { issue } from '../test/fixtures';
import { normalize, rank, type Searchable } from './search';

const describeIssue = (i: Issue): Searchable => ({ id: i.id, text: i.title, keywords: [i.type] });

const issues: Issue[] = [
  issue({ id: 'bdesk-38k.6', title: 'Shell UI façon Linear : thèmes, navigation, ⌘K, raccourcis', type: 'feature' }),
  issue({ id: 'bdesk-38k.61', title: 'Raccourcis du kanban', type: 'feature' }),
  issue({ id: 'bdesk-38k.7', title: 'Kanban par Projet (lecture seule)', type: 'feature' }),
  issue({ id: 'bdesk-b7q', title: 'Le graphique du Débit se décale après minuit', type: 'bug' }),
  issue({ id: 'beads_sais-udw', title: 'Écran « détail » : réouverture et œuvre associée', type: 'task' }),
];

const ids = (query: string, limit?: number) => rank(issues, query, describeIssue, limit).items.map((i) => i.id);

describe('normalize', () => {
  it('retire accents, casse et ligatures', () => {
    expect(normalize('Épics ÉCRAN œuvre Æon')).toBe('epics ecran oeuvre aeon');
  });
});

describe('rank', () => {
  it('rend tout, dans l’ordre fourni, quand la requête est vide', () => {
    expect(ids('')).toEqual(issues.map((i) => i.id));
    expect(ids('   ', 2)).toEqual(['bdesk-38k.6', 'bdesk-38k.61']);
    expect(rank(issues, '', describeIssue, 2).total).toBe(issues.length);
  });

  it('retrouve un ticket par son id complet ou par sa partie après le préfixe', () => {
    expect(ids('bdesk-38k.6')[0]).toBe('bdesk-38k.6');
    expect(ids('38k.6')[0]).toBe('bdesk-38k.6');
    expect(ids('udw')).toEqual(['beads_sais-udw']);
  });

  it('classe l’id exact avant l’id qui commence pareil', () => {
    expect(ids('38k.6')).toEqual(['bdesk-38k.6', 'bdesk-38k.61']);
  });

  it('ignore accents et casse, des deux côtés', () => {
    expect(ids('ECRAN')).toEqual(['beads_sais-udw']);
    expect(ids('themes')).toEqual(['bdesk-38k.6']);
    expect(ids('detail')).toEqual(['beads_sais-udw']);
    expect(ids('oeuvre')).toEqual(['beads_sais-udw']);
  });

  it('exige tous les mots, dans n’importe quel ordre', () => {
    expect(ids('kanban projet')).toEqual(['bdesk-38k.7']);
    expect(ids('projet kanban')).toEqual(['bdesk-38k.7']);
    expect(ids('kanban inexistant')).toEqual([]);
  });

  it('place un début de mot avant le milieu d’un mot', () => {
    // « raccourcis » commence le titre du .61 et termine celui du .6 (après « ⌘K, ») : les deux correspondent, le début de titre gagne.
    expect(ids('raccourcis')).toEqual(['bdesk-38k.61', 'bdesk-38k.6']);
  });

  it('cherche aussi dans les mots-clés, derrière le titre', () => {
    expect(ids('bug')).toEqual(['bdesk-b7q']);
    expect(ids('feature')).toEqual(['bdesk-38k.6', 'bdesk-38k.61', 'bdesk-38k.7']);
  });

  it('tolère une abréviation quand rien ne correspond exactement', () => {
    expect(ids('knbn')).toEqual(expect.arrayContaining(['bdesk-38k.7']));
    expect(ids('zzzz')).toEqual([]);
  });

  it('plafonne les résultats mais annonce le total', () => {
    const result = rank(issues, 'bdesk', describeIssue, 2);
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(4);
    expect(result.best).toBeGreaterThan(0);
  });

  it('classe les Projets par préfixe, nom ou identifiant', () => {
    const projects = [
      { id: 'bdesk', name: 'beads-desktop', prefix: 'bdesk' },
      { id: 'mpm', name: 'My-Prompt-Manager', prefix: 'mpm' },
    ];
    const describeProject = (p: (typeof projects)[number]): Searchable => ({ id: p.prefix, text: p.name, keywords: [p.id] });

    expect(rank(projects, 'mpm', describeProject).items.map((p) => p.id)).toEqual(['mpm']);
    expect(rank(projects, 'prompt', describeProject).items.map((p) => p.id)).toEqual(['mpm']);
    expect(rank(projects, 'desk', describeProject).items.map((p) => p.id)).toEqual(['bdesk']);
  });

  it('ne plante pas sur des caractères spéciaux de regex', () => {
    expect(ids('(lecture')).toEqual(['bdesk-38k.7']);
    expect(ids('[')).toEqual([]);
    expect(ids('.*')).toEqual([]);
  });
});
