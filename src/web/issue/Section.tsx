import { useId, type ReactNode } from 'react';

/** Une section du panneau d'un ticket : un intertitre (`h3`, sous le titre du ticket) et son contenu. */
export function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-2.5">
      <h3 id={titleId} className="text-ui font-semibold text-ink">
        {title}
      </h3>
      {children}
    </section>
  );
}
