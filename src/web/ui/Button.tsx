import type { ButtonHTMLAttributes } from 'react';
import { cx } from '../lib/cx';

export function Button({
  variant = 'default',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'ghost' }) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex h-8 items-center justify-center gap-2 rounded-md px-3 text-ui font-medium transition-colors',
        variant === 'default'
          ? 'border border-line-strong bg-panel text-ink hover:bg-hover'
          : 'text-ink-2 hover:bg-hover hover:text-ink',
        className,
      )}
      {...props}
    />
  );
}
