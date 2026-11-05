import { ImageIcon, Square, SquareCheckBig } from 'lucide-react';
import { createContext, type ReactNode, use, useMemo, useRef } from 'react';
import { cx } from '../lib/cx';
import { useScrollFocusable } from '../lib/useOverflow';
import { type Align, type Block, type Inline, parseMarkdown } from './parse';

/**
 * Seules les adresses `http(s):` et `mailto:` sont suivies : ni `javascript:`, ni `data:`, ni un chemin (le lien d'un
 * ticket vers `docs/adr/0001.md` ne mène nulle part depuis cette page). Une autre adresse, le texte du lien reste.
 * L'adresse doit commencer par le schéma, sans espace ni caractère de commande devant : `java\tscript:` n'en est pas un.
 */
export function safeHref(href: string): string | null {
  return /^(?:https?:\/\/\S|mailto:\S)/i.test(href) ? href : null;
}

const CODE = 'rounded bg-well px-1 py-px font-mono text-[0.85em] wrap-anywhere';
const LINK = 'text-accent underline underline-offset-2 hover:text-ink';

function Inlines({ nodes }: { nodes: Inline[] }) {
  return nodes.map((inline, index) => <InlineNode key={index} inline={inline} />);
}

function InlineNode({ inline }: { inline: Inline }): ReactNode {
  switch (inline.type) {
    case 'text':
      return inline.value;
    case 'br':
      return <br />;
    case 'code':
      return <code className={CODE}>{inline.value}</code>;
    case 'em':
      return (
        <em>
          <Inlines nodes={inline.children} />
        </em>
      );
    case 'strong':
      return (
        <strong className="font-semibold">
          <Inlines nodes={inline.children} />
        </strong>
      );
    case 'del':
      return (
        <del className="text-ink-3">
          <Inlines nodes={inline.children} />
        </del>
      );
    case 'link': {
      const href = safeHref(inline.href);
      return href ? (
        <a href={href} title={inline.title} target="_blank" rel="noopener noreferrer" className={cx(LINK, 'wrap-anywhere')}>
          <Inlines nodes={inline.children} />
        </a>
      ) : (
        <Inlines nodes={inline.children} />
      );
    }
    case 'image': {
      // Jamais chargée : une image distante révélerait à son serveur qu'on lit ce ticket. Elle devient un lien.
      const href = safeHref(inline.src);
      const label = inline.alt || inline.src;
      return href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" title="Image distante, non chargée" className={cx(LINK, 'inline-flex items-baseline gap-1 wrap-anywhere')}>
          <ImageIcon size={12} aria-hidden="true" className="shrink-0 self-center" />
          {label}
        </a>
      ) : (
        inline.alt
      );
    }
  }
}

/**
 * Une zone qui défile en largeur (bloc de code, tableau large). Elle n'est atteignable au clavier que lorsqu'elle défile
 * vraiment : sans cela, personne ne pourrait la faire défiler sans souris, et chaque bloc court serait un arrêt de tabulation de plus.
 * Elle garde son `tabindex` tant qu'elle a le focus, même quand le texte raccourcit ou que la fenêtre s'élargit, et qu'elle ne défile plus : le focus ne tombe pas sur le corps de la page (voir `useScrollFocusable`).
 */
function ScrollBox({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const focusable = useScrollFocusable(ref, 'x');
  return (
    <div ref={ref} tabIndex={focusable ? 0 : undefined} className={cx('max-w-full overflow-x-auto', className)}>
      {children}
    </div>
  );
}

const HEADINGS = {
  4: 'text-ui font-semibold text-ink',
  5: 'text-ui font-medium text-ink',
  6: 'text-ui font-medium text-ink-2',
} as const;

type HeadingLevel = keyof typeof HEADINGS;

/**
 * Le niveau de chaque titre du texte. Le titre du ticket est un h2 et ses sections des h3 : le Markdown ne dispose que de h4 à
 * h6, et l'ordre des titres ne saute jamais de niveau (WCAG 1.3.1, axe `heading-order`). Un texte qui commence par « ## », ou
 * qui passe de « ## » à « #### », n'y gagnerait pas : les niveaux sont donc ceux de l'imbrication des titres, pas des dièses.
 * Le premier titre est un h4 ; un titre sous un autre est un niveau de plus ; au-delà de h6, le dernier niveau se répète.
 */
function headingLevels(blocks: Block[]): Map<Block, HeadingLevel> {
  const levels = new Map<Block, HeadingLevel>();
  /** Les « profondeurs » (nombre de dièses) des titres ouverts, de la plus haute à la plus basse. */
  const open: number[] = [];
  const visit = (list: Block[]) => {
    for (const block of list) {
      if (block.type === 'heading') {
        while (open.length > 0 && (open.at(-1) as number) >= block.depth) open.pop();
        open.push(block.depth);
        levels.set(block, Math.min(6, 3 + open.length) as HeadingLevel);
      } else if (block.type === 'quote') visit(block.children);
      else if (block.type === 'list') for (const item of block.items) visit(item.children);
    }
  };
  visit(blocks);
  return levels;
}

const HeadingLevels = createContext<Map<Block, HeadingLevel>>(new Map());

const ALIGN: Record<NonNullable<Align> | 'none', string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
  none: 'text-left',
};

function Blocks({ blocks, tight = false }: { blocks: Block[]; tight?: boolean }) {
  return blocks.map((block, index) => <BlockNode key={index} block={block} tight={tight} />);
}

function BlockNode({ block, tight }: { block: Block; tight: boolean }): ReactNode {
  switch (block.type) {
    case 'paragraph':
      // Dans une liste serrée, le texte d'un item n'est pas un paragraphe à part.
      return tight ? <Inlines nodes={block.children} /> : <p className="wrap-anywhere"><Inlines nodes={block.children} /></p>;
    case 'heading': {
      const level = use(HeadingLevels).get(block) ?? 6;
      const Tag = `h${level}` as const;
      return (
        <Tag className={cx(HEADINGS[level], 'wrap-anywhere pt-1')}>
          <Inlines nodes={block.children} />
        </Tag>
      );
    }
    case 'code':
      return (
        <ScrollBox className="rounded-md border border-line bg-well">
          <pre className="w-max min-w-full p-3 font-mono text-xs leading-5 text-ink">
            <code>{block.value}</code>
          </pre>
        </ScrollBox>
      );
    case 'quote':
      return (
        <blockquote className="flex flex-col gap-2 border-l-2 border-line-strong pl-3 text-ink-2">
          <Blocks blocks={block.children} />
        </blockquote>
      );
    case 'rule':
      return <hr className="my-1 border-line" />;
    case 'list': {
      const tasks = block.items.some((item) => item.checked !== null);
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag
          start={block.ordered && block.start !== 1 ? block.start : undefined}
          className={cx('flex flex-col', block.tight ? 'gap-1' : 'gap-2', tasks ? 'list-none' : block.ordered ? 'list-decimal pl-5' : 'list-disc pl-5')}
        >
          {block.items.map((item, index) => (
            <li key={index} className={cx(item.checked !== null && 'flex items-start gap-1.5', tasks && item.checked === null && 'pl-[1.375rem]')}>
              {item.checked === null ? null : (
                <>
                  {item.checked ? (
                    <SquareCheckBig size={14} aria-hidden="true" className="mt-[3px] shrink-0 text-accent" />
                  ) : (
                    <Square size={14} aria-hidden="true" className="mt-[3px] shrink-0 text-ink-3" />
                  )}
                  <span className="sr-only">{item.checked ? 'Fait :' : 'À faire :'}</span>
                </>
              )}
              {item.checked === null ? (
                <ItemContent blocks={item.children} tight={block.tight} />
              ) : (
                <div className="min-w-0 flex-1">
                  <ItemContent blocks={item.children} tight={block.tight} />
                </div>
              )}
            </li>
          ))}
        </Tag>
      );
    }
    case 'table':
      return (
        <ScrollBox className="rounded-md border border-line">
          <table className="w-full border-collapse text-xs">
            <thead className="bg-well">
              <tr>
                {block.head.map((cell, column) => (
                  <th key={column} className={cx('border-b border-line-strong px-2.5 py-1.5 font-medium text-ink-2', ALIGN[block.align[column] ?? 'none'])}>
                    <Inlines nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                <tr key={index} className="border-b border-line last:border-b-0">
                  {row.map((cell, column) => (
                    <td key={column} className={cx('px-2.5 py-1.5 align-top wrap-anywhere', ALIGN[block.align[column] ?? 'none'])}>
                      <Inlines nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollBox>
      );
  }
}

/** Le contenu d'un item : ses blocs, empilés quand la liste est lâche ou que l'item en a plusieurs. */
function ItemContent({ blocks, tight }: { blocks: Block[]; tight: boolean }) {
  const onlyText = blocks.every((block) => block.type === 'paragraph');
  return tight && onlyText ? (
    <span className="wrap-anywhere">
      <Blocks blocks={blocks} tight />
    </span>
  ) : (
    <div className="flex flex-col gap-1.5">
      {blocks.map((block, index) => (
        <BlockNode key={index} block={block} tight={tight && block.type === 'paragraph'} />
      ))}
    </div>
  );
}

/**
 * Un texte de ticket en Markdown (voir `parse.ts` pour ce qui est lu), dessiné en éléments React et jamais en HTML :
 * rien de ce que l'auteur du texte écrit ne devient une balise, un attribut ou un script.
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const { blocks, levels } = useMemo(() => {
    const parsed = parseMarkdown(source);
    return { blocks: parsed, levels: headingLevels(parsed) };
  }, [source]);
  if (blocks.length === 0) return null;
  return (
    <HeadingLevels value={levels}>
      <div className={cx('flex min-w-0 flex-col gap-2 text-ui text-ink', className)}>
        <Blocks blocks={blocks} />
      </div>
    </HeadingLevels>
  );
}
