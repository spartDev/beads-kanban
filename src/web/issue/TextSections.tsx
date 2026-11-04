import type { IssueDetail } from '../data/types';
import { Markdown } from '../markdown/Markdown';
import { Section } from './Section';

/** Les champs texte d'un ticket beads, dans l'ordre où le panneau les écrit. */
const FIELDS: readonly { title: string; field: 'description' | 'design' | 'acceptanceCriteria' | 'notes' | 'closeReason' }[] = [
  { title: 'Description', field: 'description' },
  { title: 'Conception', field: 'design' },
  { title: 'Critères d’acceptation', field: 'acceptanceCriteria' },
  { title: 'Notes', field: 'notes' },
  { title: 'Raison de fermeture', field: 'closeReason' },
];

/** Description, conception, critères d'acceptation, notes et raison de fermeture, en Markdown : une section par texte renseigné. */
export function TextSections({ issue }: { issue: IssueDetail }) {
  const filled = FIELDS.filter(({ field }) => issue[field].trim() !== '');
  if (filled.length === 0) return <p className="text-ink-3">Aucun texte n’est renseigné pour ce ticket.</p>;
  return (
    <>
      {filled.map(({ title, field }) => (
        <Section key={field} title={title}>
          <Markdown source={issue[field]} />
        </Section>
      ))}
    </>
  );
}
