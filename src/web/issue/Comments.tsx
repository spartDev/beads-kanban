import type { IssueComment } from '../data/types';
import { useFormat, useT } from '../i18n';
import { Markdown } from '../markdown/Markdown';
import { Section } from './Section';

/** Les commentaires du ticket, du plus ancien au plus récent (l'ordre du serveur), leur texte en Markdown. */
export function Comments({ comments }: { comments: IssueComment[] }) {
  const t = useT();
  const format = useFormat();
  if (comments.length === 0) return null;
  return (
    <Section
      title={
        <>
          {t.kanban.texts.comments} <span className="tnum font-normal text-ink-3">{format.formatCount(comments.length)}</span>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        {comments.map((comment, index) => (
          <article key={index} className="flex flex-col gap-1.5 rounded-lg border border-line p-3">
            <header className="flex flex-wrap items-baseline gap-x-2">
              <span className="min-w-0 wrap-anywhere font-medium text-ink">{comment.author}</span>
              <time dateTime={comment.createdAt} className="tnum text-xs text-ink-3">
                {format.formatInstant(comment.createdAt)}
              </time>
            </header>
            <Markdown source={comment.text} />
          </article>
        ))}
      </div>
    </Section>
  );
}
