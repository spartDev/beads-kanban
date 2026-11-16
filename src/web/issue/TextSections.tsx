import type { IssueDetail } from '../data/types';
import { useT } from '../i18n';
import { Markdown } from '../markdown/Markdown';
import { Section } from './Section';

/** Les champs texte d'un ticket beads, dans l'ordre où le panneau les écrit. */
const FIELDS = ['description', 'design', 'acceptanceCriteria', 'notes', 'closeReason'] as const;

/** Description, conception, critères d'acceptation, notes et raison de fermeture, en Markdown : une section par texte renseigné. */
export function TextSections({ issue }: { issue: IssueDetail }) {
  const { texts } = useT().kanban;
  const filled = FIELDS.filter((field) => issue[field].trim() !== '');
  if (filled.length === 0) return <p className="text-ink-3">{texts.empty}</p>;
  return (
    <>
      {filled.map((field) => (
        <Section key={field} title={texts[field]}>
          <Markdown source={issue[field]} />
        </Section>
      ))}
    </>
  );
}
