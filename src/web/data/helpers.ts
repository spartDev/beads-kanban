import type { Issue, Project } from './types';

export const isReadable = (project: Project): boolean => project.status === 'ok';

export const isEpic = (issue: Issue): boolean => issue.type === 'epic';
