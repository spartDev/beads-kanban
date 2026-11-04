import { describe, expect, it, vi } from 'vitest';
import { ProjectUnreadableError } from '../projects/service';
import { createWatcherLog } from './log';

/** Un journal qui garde ce qu'on lui écrit. */
function journal() {
  const lines: string[] = [];
  return { lines, log: { warn: (message: string) => void lines.push(message) } };
}

describe('journal du sondage : un message par changement d’état d’un Projet, jamais un par lecture', () => {
  it('ne dit rien tant que rien n’échoue', () => {
    const { lines, log } = journal();

    createWatcherLog(log);

    expect(lines).toEqual([]);
  });

  it('prévient quand un Projet se met à échouer : le Projet et la cause', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('beta', new Error('database is locked'));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('beta');
    expect(lines[0]).toContain('database is locked');
  });

  it('ne répète pas la même panne, quel que soit le nombre de lectures qui échouent', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    for (let i = 0; i < 500; i++) watcherLog.onError('beta', new Error('database is locked'));

    expect(lines).toHaveLength(1);
  });

  it('prévient à nouveau quand la cause change', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('beta', new Error('database is locked'));
    watcherLog.onError('beta', new Error('database is locked'));
    watcherLog.onError('beta', new Error('Dossier introuvable'));
    watcherLog.onError('beta', new Error('Dossier introuvable'));

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Dossier introuvable');
  });

  it('dit une fois que le Projet est rétabli', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);
    watcherLog.onError('beta', new Error('database is locked'));

    watcherLog.onRecover('beta');
    watcherLog.onRecover('beta');

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('beta');
    expect(lines[1]).toMatch(/rétabli/);
  });

  it('ne dit rien d’un rétablissement dont il n’a pas signalé la panne', () => {
    const { lines, log } = journal();

    createWatcherLog(log).onRecover('beta');

    expect(lines).toEqual([]);
  });

  it('une nouvelle panne, même avec la même cause, est un nouveau changement d’état : elle est signalée', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('beta', new Error('database is locked'));
    watcherLog.onRecover('beta');
    watcherLog.onError('beta', new Error('database is locked'));

    expect(lines).toHaveLength(3);
  });

  it('suit chaque Projet à part', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('alpha', new Error('illisible'));
    watcherLog.onError('beta', new Error('illisible'));
    watcherLog.onError('alpha', new Error('illisible'));
    watcherLog.onRecover('alpha');
    watcherLog.onError('beta', new Error('illisible'));

    expect(lines).toHaveLength(3); // alpha en panne, beta en panne, alpha rétabli
    expect(lines.filter((line) => line.includes('alpha'))).toHaveLength(2);
    expect(lines.filter((line) => line.includes('beta'))).toHaveLength(1);
  });

  it('donne la raison d’un Projet illisible sans répéter « Projet illisible »', () => {
    const { lines, log } = journal();

    createWatcherLog(log).onError('beta', new ProjectUnreadableError('beta', 'Dossier introuvable : /x/beta'));

    expect(lines[0]).toContain('Dossier introuvable : /x/beta');
    expect(lines[0]).not.toContain('Projet illisible');
  });

  it('décrit aussi ce qui n’est pas une Error', () => {
    const { lines, log } = journal();

    createWatcherLog(log).onError('beta', 'texte lancé tel quel');

    expect(lines[0]).toContain('texte lancé tel quel');
  });

  it('écrit chaque message à l’avertissement du journal, en un seul texte', () => {
    const warn = vi.fn();
    const watcherLog = createWatcherLog({ warn });

    watcherLog.onError('beta', new Error('Délai dépassé (60000 ms)'));
    watcherLog.onRecover('beta');

    expect(warn).toHaveBeenCalledTimes(2);
    for (const call of warn.mock.calls) {
      expect(call).toHaveLength(1);
      expect(typeof call[0]).toBe('string');
    }
  });
});
